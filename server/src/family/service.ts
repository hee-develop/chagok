import type { Notifier } from '../notify/notifier.js';
import type { SeatStore } from '../seats.js';
import { formatSeoulDate, parseSeoulDate, seoulDay } from '../time.js';
import { createFamilyGroups, displayInviteCode, newId, type Member, type PhoneIdentity } from './groups.js';
import { ETA_NOTIFICATION_TTL_MS, MAX_FAMILIES, MAX_FAMILY_MEMBERS, MAX_REQUESTS_PER_FAMILY, MAX_REQUESTS_PER_MEMBER } from './limits.js';
import { soonBody, statusBody, statusTitle } from './phrases.js';
import {
  canTransition,
  createRequestStore,
  isTerminal,
  type Category,
  type CreateBody,
  type Fields,
  type PatchableStatus,
  type RequestRecord,
  type Status,
} from './requests.js';

export type { PhoneIdentity };

type Recipient = { kind: 'member'; memberId: string; name: string } | { kind: 'car'; carRef: string };
type FieldsOut = Omit<Fields, 'category'>;

const withoutCategory = (fields: Fields): FieldsOut => {
  const { category: _category, ...rest } = fields;
  return rest;
};

/** 도착 예정(주행 중·5분 전·도착)을 다루는 카테고리: 약속 가기·데려다주기·픽업(정책서 10.10 '도착 예정 공유'). */
const isEtaCategory = (category: Category) => category === 'appointment' || category === 'ride';

type CreateFailureReason = 'not-in-family' | 'unknown-recipient' | 'self' | 'unknown-car' | 'too-many-requests';
const failed = (reason: CreateFailureReason) => ({ ok: false as const, reason });

export function createFamilyRequests({
  now,
  seats,
  notifier,
  maxFamilies = MAX_FAMILIES,
}: {
  now: () => Date;
  seats: SeatStore;
  notifier: Notifier;
  /** 테스트가 가족 수 상한을 줄여 쓴다. */
  maxFamilies?: number;
}) {
  const t = () => now().getTime();
  const store = createRequestStore();

  /** '우리 차' 가리킴값: 서버 안의 차 id 대신 폰에 주는 불투명한 값. **가족별로 다르다**(같은 차라도 가족이 다르면 다른 값이라 가족 사이에 차를 맞춰 볼 수 없다). */
  const refByKey = new Map<string, string>(); // `${familyId}|${carId}` → carRef
  const targetByRef = new Map<string, { familyId: string; carId: string }>();
  const refFor = (familyId: string, carId: string) => {
    const key = `${familyId}|${carId}`;
    let ref = refByKey.get(key);
    if (ref === undefined) {
      ref = `car-${newId()}`;
      refByKey.set(key, ref);
      targetByRef.set(ref, { familyId, carId });
    }
    return ref;
  };
  /** 가족의 가리킴값을 지운다(carId를 주면 그 차의 것만). 차 자리가 사라지거나 가족이 사라질 때 불린다. */
  const dropRefs = (familyId: string, carId?: string) => {
    for (const [ref, target] of targetByRef) {
      if (target.familyId === familyId && (carId === undefined || target.carId === carId)) {
        targetByRef.delete(ref);
        refByKey.delete(`${target.familyId}|${target.carId}`);
      }
    }
  };

  /** 요청을 지우고 그 요청에 대한 `family-status` 알림도 알림함에서 지운다(요청 id 기준). 지운 수. */
  const removeRequests = (predicate: (r: RequestRecord) => boolean) => {
    const ids = store.removeWhere(predicate);
    if (ids.length > 0) {
      const gone = new Set(ids);
      notifier.retract('family-status', (n) => gone.has(n.data.requestId ?? ''));
    }
    return ids.length;
  };

  const groups = createFamilyGroups({
    now,
    maxFamilies,
    hooks: {
      // 가족에서 나가면 그 사람이 보낸·받은 요청이 지워진다(받은 '우리 차' 요청은 사람이 받는 게 아니라 남는다. 그 차에 가족 자리가 안 남으면 아래 onCarLost가 지운다).
      onLeft: (memberId) => void removeRequests((r) => r.senderId === memberId || (r.recipient.kind === 'member' && r.recipient.memberId === memberId)),
      onFamilyGone: (familyId) => {
        removeRequests((r) => r.familyId === familyId);
        dropRefs(familyId);
      },
      // 그 차에 이 가족의 자리가 하나도 없으면 그 차로 보낸 '우리 차' 요청은 지금 그 차를 타는 낯선 사람이 받을 수 있으므로 지운다.
      onCarLost: (familyId, carId) => {
        removeRequests((r) => r.familyId === familyId && r.recipient.kind === 'car' && r.recipient.carId === carId);
        dropRefs(familyId, carId);
      },
      hasRequests: (familyId) => store.countOfFamily(familyId) > 0,
    },
  });
  /** 자리별 주행 중·정차와 바뀐 시각(마지막 값만, 그날까지). 위치는 없다. */
  const driveStates = new Map<string, { driving: boolean; changedAt: number }>();

  seats.subscribe((event) => {
    groups.onSeatEvent(event);
    // 자리가 지워지거나 폰이 바뀌면 그 자리의 주행 상태는 버린다(새 폰이 이어받지 않는다).
    if (event.type !== 'created') driveStates.delete(event.seatId);
  });

  const today = () => seoulDay(t());
  const dayOf = (r: RequestRecord) => parseSeoulDate(r.date) as number;
  /**
   * '우리 차' 요청은 **지금 그 차에 그 가족 구성원의 자리가 하나 이상 있을 때만** 유효하다. 그 가족의 연결이 사라진 차(끊기·차곡 초기화 뒤 다른 사람이 연결한 차)에
   * 남은 요청을 낯선 사람이 보지 못하게 하는 읽기 쪽 방어선이고, 자리가 지워질 때 요청을 지우는 것(`onCarLost`)이 저장 쪽이다.
   */
  const carValid = (r: RequestRecord) => r.recipient.kind !== 'car' || groups.familyHasSeatOnCar(r.familyId, r.recipient.carId);
  /** 날짜가 안 지났고(서울) '우리 차'가 유효한가. 읽기·쓰기는 이 판정으로 보이는 것만 다루고 `purge`가 실제로 지운다. */
  const alive = (r: RequestRecord) => dayOf(r) >= today() && carValid(r);
  const aliveById = (id: string) => {
    const r = store.get(id);
    return r !== null && alive(r) ? r : null;
  };

  const driving = (seatId: string | null) => {
    if (seatId === null) return false;
    const s = driveStates.get(seatId);
    return s !== undefined && s.driving && seoulDay(s.changedAt) >= today();
  };
  /** 가족 폰이 연결된 차들: carRef → 그 차에 연결된 구성원 id들. '우리 차'로 고를 수 있는 목록. */
  const familyCars = (familyId: string) => {
    const out = new Map<string, string[]>();
    for (const m of groups.membersOf(familyId)) {
      if (m.seat === null) continue;
      const ref = refFor(familyId, m.seat.carId);
      out.set(ref, [...(out.get(ref) ?? []), m.memberId]);
    }
    return out;
  };

  const recipientOf = (r: RequestRecord): Recipient =>
    r.recipient.kind === 'member'
      ? { kind: 'member', memberId: r.recipient.memberId, name: groups.member(r.recipient.memberId)?.name ?? '' }
      : { kind: 'car', carRef: refFor(r.familyId, r.recipient.carId) };

  /** 받는 사람(사람이든 차든)에게 요청이 닿을 곳이 있는가: 사람이면 폰이 어느 차에 연결돼 있는가, 차면 그 차에 이 가족의 자리가 있는가. 없으면 그 사람 폰 앱에만 보인다. */
  const reachable = (r: RequestRecord) => (r.recipient.kind === 'car' ? carValid(r) : groups.member(r.recipient.memberId)?.seat != null);

  /**
   * 보낸 사람·받는 사람 폰이 보는 공통 모양. 정밀한 전이 시각(바뀐 시각)은 주지 않는다: 만든 시각(`createdAt`)만 있고 상태는 코드뿐이다
   * (받는 사람이 언제 수락·완료했는지 보낸 사람이 시각으로 알 수 없게).
   */
  const baseView = (r: RequestRecord) => ({
    id: r.id,
    category: r.fields.category,
    ...withoutCategory(r.fields),
    memo: r.memo,
    date: r.date,
    status: r.status,
    createdAt: r.createdAt,
    from: { memberId: r.senderId, name: groups.member(r.senderId)?.name ?? '' },
    to: recipientOf(r),
    reachable: reachable(r),
  });

  /** 도착 예정 공유가 켜져 있는가: 받는 사람(사람)이 보낸 사람에게 켰는가. '우리 차'는 사람이 아니라 공유 설정이 없다. */
  const sharedWithSender = (r: RequestRecord) => r.recipient.kind === 'member' && groups.shares(r.recipient.memberId, r.senderId);

  /**
   * 보낸 사람이 보는 모양. 도착 예정 관련 정보는 **약속 가기·데려다주기·픽업이고 받는 사람이 도착 예정 공유를 켠 요청에서만** 준다(그 밖은 늘 false·null):
   * `drivingNow`는 '보냄' 상태이고 지금 받는 사람 자리가 주행 중일 때만 참이고, `etaStage`는 도착 5분 전을 공유해 보냈고 아직 끝나지 않았을 때만 'soon'이다(시각은 없다).
   */
  const senderView = (r: RequestRecord) => {
    const shared = sharedWithSender(r) && isEtaCategory(r.fields.category);
    const recipientSeat = r.recipient.kind === 'member' ? groups.member(r.recipient.memberId)?.seat?.seatId ?? null : null;
    return {
      ...baseView(r),
      drivingNow: r.status === 'sent' && shared && driving(recipientSeat),
      etaStage: r.etaSoon && shared && !isTerminal(r.status) ? ('soon' as const) : (null as 'soon' | null),
    };
  };
  const newestFirst = (a: RequestRecord, b: RequestRecord) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

  const carVisible = (r: RequestRecord, carId: string, seatId: string) => {
    if (r.recipient.kind === 'car') return r.recipient.carId === carId && carValid(r);
    return groups.member(r.recipient.memberId)?.seat?.seatId === seatId;
  };
  const carView = (r: RequestRecord) => ({
    id: r.id,
    category: r.fields.category,
    ...withoutCategory(r.fields),
    memo: r.memo,
    date: r.date,
    status: r.status,
    /** 서버가 요청을 받은 시각. 주행 중에 온 요청을 말하지 않는 판단은 차가 이 시각과 자기 주행 상태로 한다. */
    createdAt: r.createdAt,
    from: { memberId: r.senderId, name: groups.member(r.senderId)?.name ?? '' },
    via: r.recipient.kind === 'car' ? ('car' as const) : ('seat' as const),
  });

  /**
   * 보낸 사람 폰 알림함에 요청 상태 알림을 넣는다(받는 사람 폰에는 보내지 않는다). 연결된 자리가 없는 보낸 사람은 알림함이 없어 건너뛴다.
   * `ttlMs`를 주면 그 시간 뒤에 알림함에서 사라진다(도착 예정 알림).
   */
  const notifySender = (r: RequestRecord, body: string, dedupe: string, extra: Record<string, string> = {}, ttlMs?: number) => {
    const seatId = groups.member(r.senderId)?.seat?.seatId ?? null;
    if (seatId === null) return false;
    const to = r.recipient.kind === 'member' ? { kind: 'member' as const, name: groups.member(r.recipient.memberId)?.name ?? '가족' } : { kind: 'car' as const };
    return notifier.notify(seatId, {
      kind: 'family-status',
      title: statusTitle(r.fields.category, to),
      body,
      data: { requestId: r.id, category: r.fields.category, status: r.status, ...extra },
      dedupeKey: `family-status:${r.id}:${dedupe}`,
      ...(ttlMs === undefined ? {} : { ttlMs }),
    }).ok;
  };

  /** 신원으로 구성원을 찾는다(가드가 모르는 비밀값은 이미 401로 걸렀다). */
  const memberOf = (identity: PhoneIdentity): Member | null => {
    const found = groups.resolve(identity);
    return found === 'unknown-member' ? null : found;
  };

  const familyViewOf = (me: Member) => {
    const family = groups.family(me.familyId)!;
    const invite = family.invite !== null && family.invite.expiresAt > t() ? family.invite : null;
    return {
      familyId: family.familyId,
      createdAt: new Date(family.createdAt).toISOString(),
      maxMembers: MAX_FAMILY_MEMBERS,
      invite: invite === null ? null : { code: displayInviteCode(invite.code), expiresAt: new Date(invite.expiresAt).toISOString() },
      me: { memberId: me.memberId, name: me.name },
      members: groups.membersOf(family.familyId).map((m) => ({
        memberId: m.memberId,
        name: m.name,
        isMe: m.memberId === me.memberId,
        /** 이 사람의 폰이 차에 연결돼 있는가(연결 안 됐으면 요청은 그 사람 폰 앱에만 보인다). */
        connected: m.seat !== null,
        /** 내가 이 사람에게 내 도착 예정을 보여 주는가(기본 꺼짐). */
        shareWithThem: groups.shares(me.memberId, m.memberId),
        /** 이 사람이 나에게 도착 예정을 보여 주는가. */
        sharesWithMe: groups.shares(m.memberId, me.memberId),
      })),
      cars: [...familyCars(family.familyId)].map(([carRef, memberIds]) => ({ carRef, memberIds })),
    };
  };

  return {
    /** 가드가 모르는 구성원 비밀값을 401로 거르는 데 쓴다. */
    knowsMember: (token: string) => groups.knowsToken(token),

    // ---- 가족 묶기 ----
    /**
     * 초대 코드 만들기. 구성원이 아니면(비밀값 없음·폰 토큰이 묶인 구성원 없음) 새 가족과 새 구성원을 만들고 **구성원 비밀값을 이때 한 번 준다**(`memberToken`).
     * 폰 토큰을 같이 보냈으면 그 자리가 새 구성원에게 바로 묶인다. 이미 구성원이면 그 가족의 새 코드이고 `memberToken`은 null이다.
     */
    invite: (identity: PhoneIdentity, name: string | undefined, source: string) => {
      const result = groups.invite(memberOf(identity), identity.seat, name, source);
      if (!result.ok) return result;
      return {
        ok: true as const,
        created: result.created,
        code: result.code,
        expiresAt: result.expiresAt,
        memberToken: result.created ? result.member.token : null,
        family: familyViewOf(result.member),
      };
    },
    /** 코드로 참여. 새 구성원이 되고 **구성원 비밀값을 이때 한 번 준다**. 이미 구성원이면 `already-in-family`. */
    join: (identity: PhoneIdentity, code: string, name: string | undefined, source: string) => {
      const result = groups.join(memberOf(identity), identity.seat, code, name, source);
      if (!result.ok) return result;
      return { ok: true as const, memberToken: result.member.token, family: familyViewOf(result.member) };
    },
    rename: (identity: PhoneIdentity, name: string) => {
      const member = memberOf(identity);
      return member === null ? null : groups.rename(member, name);
    },
    leave: (identity: PhoneIdentity) => {
      const member = memberOf(identity);
      return member === null ? false : groups.leave(member.memberId);
    },
    setShare: (identity: PhoneIdentity, targetId: string, enabled: boolean) => {
      const owner = memberOf(identity);
      if (owner === null) return { ok: false as const, reason: 'not-in-family' as const };
      return groups.setShare(owner, targetId, enabled);
    },
    /** 내 가족과 구성원(부르는 이름, 연결 여부, 도착 예정 공유), 초대 코드, '우리 차'로 고를 수 있는 차 목록. 가족이 없으면 null. */
    familyView: (identity: PhoneIdentity) => {
      const me = memberOf(identity);
      return me === null ? null : familyViewOf(me);
    },

    // ---- 요청 ----
    create: (identity: PhoneIdentity, body: CreateBody) => {
      const sender = memberOf(identity);
      if (sender === null) return failed('not-in-family');
      let recipient: RequestRecord['recipient'];
      if ('memberId' in body.recipient) {
        if (body.recipient.memberId === sender.memberId) return failed('self');
        const target = groups.member(body.recipient.memberId);
        if (target === null || target.familyId !== sender.familyId) return failed('unknown-recipient');
        recipient = { kind: 'member', memberId: target.memberId };
      } else {
        const target = targetByRef.get(body.recipient.carRef);
        if (target === undefined || target.familyId !== sender.familyId || !groups.familyHasSeatOnCar(sender.familyId, target.carId)) return failed('unknown-car');
        recipient = { kind: 'car', carId: target.carId };
      }
      const live = store.all().filter(alive);
      if (live.filter((r) => r.senderId === sender.memberId).length >= MAX_REQUESTS_PER_MEMBER
        || live.filter((r) => r.familyId === sender.familyId).length >= MAX_REQUESTS_PER_FAMILY) {
        return failed('too-many-requests');
      }
      const at = now().toISOString();
      const record: RequestRecord = {
        id: newId(),
        familyId: sender.familyId,
        senderId: sender.memberId,
        recipient,
        fields: body.fields,
        memo: body.memo,
        date: body.date,
        status: 'sent',
        etaSoon: false,
        createdAt: at,
      };
      store.add(record);
      return { ok: true as const, request: senderView(record) };
    },
    /** 폰: 내가 보낸 것과 받은 것(사람으로 받은 것, 내 폰이 연결된 차가 '우리 차'로 받은 것). 최근에 만든 것부터. date를 주면 그 날짜만. */
    listForPhone: (identity: PhoneIdentity, date?: string) => {
      const me = memberOf(identity);
      if (me === null) return null;
      const myCar = me.seat?.carId ?? null;
      const live = store.all().filter((r) => alive(r) && r.familyId === me.familyId && (date === undefined || r.date === date)).sort(newestFirst);
      return {
        sent: live.filter((r) => r.senderId === me.memberId).map(senderView),
        received: live
          .filter((r) => r.senderId !== me.memberId && (r.recipient.kind === 'member' ? r.recipient.memberId === me.memberId : myCar !== null && r.recipient.carId === myCar))
          .map(baseView),
      };
    },
    /** 차: 그 자리로 온 요청과 '우리 차'로 온 요청 중 그날 아직 끝나지 않은 것(보냄·전달·수락). 거절·완료는 차가 더 할 일이 없어 주지 않는다. */
    listForCar: (carId: string, seatId: string, date: string) => {
      groups.touchSeat(seatId);
      return store.all().filter((r) => alive(r) && r.date === date && !isTerminal(r.status) && carVisible(r, carId, seatId)).sort(newestFirst).map(carView);
    },
    /**
     * 차: 요청 상태를 바꾼다(전달·수락·거절·완료). 그 자리로 왔거나 이 차의 '우리 차' 요청만 다룬다(그 밖은 없는 요청과 같은 `not-found`).
     * 표에 없는 전이는 `invalid-transition`, 같은 상태는 `changed: false`로 아무것도 하지 않는다. 바뀌면 보낸 사람 폰 알림함에 `family-status`를 넣는다.
     */
    patch: (carId: string, seatId: string, id: string, to: PatchableStatus) => {
      groups.touchSeat(seatId);
      const r = aliveById(id);
      if (r === null || !carVisible(r, carId, seatId)) return { ok: false, reason: 'not-found' } as const;
      if (r.status === to) return { ok: true, changed: false, request: carView(r) } as const;
      if (!canTransition(r.fields.category, r.status, to)) return { ok: false, reason: 'invalid-transition', from: r.status, to } as const;
      r.status = to;
      notifySender(r, statusBody(r.fields.category, to), to);
      return { ok: true, changed: true, request: carView(r) } as const;
    },
    /**
     * 차: 도착 5분 전(`soon`)·도착(`arrived`). 약속·픽업만, 아직 끝나지 않은(전달·수락) 요청만 받는다. 받는 사람이 보낸 사람에게
     * 도착 예정 공유를 켠 경우에만 보낸 사람 알림함에 알림을 넣고 `notified: true`다(안 켰으면 아무것도 안 하고 false).
     * 도착 예정 시각(`etaAt`)은 **요청에는 저장하지 않고** 알림 `data`로만 전달한다. 알림은 보낸 사람 알림함에 `ETA_NOTIFICATION_TTL_MS`(1시간) 동안만 머물고
     * 폰이 읽어 가(ack) 지우면 즉시 사라진다(서버 메모리뿐). `arrived`는 상태를 바꾸지 않고(완료는 PATCH), 완료 알림과 같은 중복 억제 키를 써서 두 번 울리지 않는다.
     */
    eta: (carId: string, seatId: string, id: string, stage: 'soon' | 'arrived', etaAt: string | null) => {
      groups.touchSeat(seatId);
      const r = aliveById(id);
      if (r === null || !carVisible(r, carId, seatId)) return { ok: false, reason: 'not-found' } as const;
      if (!isEtaCategory(r.fields.category)) return { ok: false, reason: 'not-eta-category' } as const;
      if (r.status !== 'delivered' && r.status !== 'accepted') return { ok: false, reason: 'not-in-progress' } as const;
      if (!sharedWithSender(r)) return { ok: true, notified: false } as const;
      if (stage === 'soon') {
        r.etaSoon = true;
        const notified = notifySender(r, soonBody(r.fields.category), 'soon', { stage: 'soon', ...(etaAt === null ? {} : { etaAt }) }, ETA_NOTIFICATION_TTL_MS);
        return { ok: true, notified } as const;
      }
      return { ok: true, notified: notifySender(r, statusBody(r.fields.category, 'completed'), 'completed', { stage: 'arrived' }, ETA_NOTIFICATION_TTL_MS) } as const;
    },

    // ---- 주행 상태 ----
    /** 차: 이 자리의 주행 시작·멈춤(위치 없음). 값이 바뀔 때만 바뀐 시각을 새로 한다. 보낸 사람 폰의 '운전 중이라 다음 정차 때 전해요' 문구에만 쓴다. */
    setDriveState: (seatId: string, isDriving: boolean) => {
      groups.touchSeat(seatId);
      const at = t();
      const prev = driveStates.get(seatId);
      if (prev === undefined || prev.driving !== isDriving || seoulDay(prev.changedAt) < today()) driveStates.set(seatId, { driving: isDriving, changedAt: at });
      const s = driveStates.get(seatId)!;
      return { seatId, driving: s.driving, changedAt: new Date(s.changedAt).toISOString() };
    },

    // ---- 정기 작업 ----
    /**
     * 날짜가 지난 요청(서울 날짜), 날짜가 지난 주행 상태, 만료된 초대 코드, 30일 쓰지 않은 구성원, 24시간 쓰지 않은 '혼자뿐인 빈 가족'을 지운다
     * (정책서 11장 '매일 새벽 … 날짜가 지난 가족 요청 삭제'). 자주 불려도 안전하다. 지운 요청 수와 나간 구성원 수.
     */
    purge: (at: Date = now()) => {
      const day = seoulDay(at.getTime());
      const requests = removeRequests((r) => dayOf(r) < day || !carValid(r));
      for (const [seatId, s] of driveStates) if (seoulDay(s.changedAt) < day) driveStates.delete(seatId);
      return { requests, members: groups.purge(at) };
    },
    /** 테스트용: 저장된 요청 수(보이지 않는 것 포함). */
    storedRequests: () => store.size(),
    /** 테스트용: 서버가 아는 가족 수·'우리 차' 가리킴값 수·가족 만들기 기록을 가진 주소 수. */
    familyCount: () => groups.familyCount(),
    refCount: () => targetByRef.size,
    trackedCreateSources: () => groups.trackedCreateSources(),
    todayString: () => formatSeoulDate(today()),
  };
}

export type FamilyRequests = ReturnType<typeof createFamilyRequests>;
export type { Category, Status };
