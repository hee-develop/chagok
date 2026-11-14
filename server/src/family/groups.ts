import type { SeatEvent } from '../seats.js';
import { createAttemptGuard } from './attempts.js';
import {
  DEFAULT_MEMBER_NAME,
  FAMILY_CREATE_DAY_WINDOW_MS,
  FAMILY_CREATE_WINDOW_MS,
  FAMILY_INVITE_TTL_MS,
  MAX_FAMILIES,
  MAX_FAMILY_CREATES_PER_SOURCE,
  MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY,
  MAX_FAMILY_MEMBERS,
  MAX_MEMBER_NAME_LENGTH,
  MAX_TRACKED_CREATE_SOURCES,
  MEMBER_INACTIVE_TTL_MS,
  SOLO_FAMILY_TTL_MS,
} from './limits.js';

// 암호학적 난수는 WebCrypto(Node 20+의 전역 crypto)를 쓴다. 폰 쪽 타입 검사가 이 파일을 함께 읽어 node:crypto를 import하지 않는다.
declare const crypto: { getRandomValues<T extends Uint8Array | Uint32Array>(array: T): T };

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
/** 공개해도 되는 64비트 식별자(구성원 id·가족 id). */
export const newId = () => hex(8);

/**
 * 초대 코드 글자: 헷갈리는 0·1·I·L·O를 뺀 31자. 8자리면 8.5×10¹¹가지다. 차 연결 코드(6자리 숫자, 5분)와 달리 24시간 살아 있고 여럿이 쓰므로,
 * 서버 전체 시도 제한(분당 120번)만으로 무차별 대입을 막을 수 있게 길게 한다.
 */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

const newInviteCode = (): string => {
  let out = '';
  while (out.length < INVITE_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // 31의 배수 아래의 값만 써서 글자 쏠림을 없앤다.
      if (byte < INVITE_ALPHABET.length * 8 && out.length < INVITE_CODE_LENGTH) out += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
    }
  }
  return out;
};

/** 사람이 보는 모양 `ABCD-EFGH`. */
export const displayInviteCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** 입력(대소문자·공백·하이픈 무시)을 코드로 정규화한다. 모양이 틀리면 null. */
export const normalizeInviteCode = (raw: string): string | null => {
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return code.length === INVITE_CODE_LENGTH && [...code].every((ch) => INVITE_ALPHABET.includes(ch)) ? code : null;
};

/**
 * 구성원 비밀값(member token): 가족을 만들거나 참여할 때 서버가 한 번만 주는 256비트 난수(64자 16진수). 폰이 보관하고 `X-Chagok-Member` 헤더로 보내
 * '이 사람이 이 구성원'임을 증명한다. **기기 id는 가족 신원으로 쓰지 않는다**(기기 id는 연결 전 일정 버킷용이고 다른 곳에 알려지거나 추측되기 쉬움).
 */
const newMemberToken = () => hex(32);
export const MEMBER_HEADER = 'x-chagok-member';
export const MEMBER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** 구성원이 묶인 폰의 자리와 그 자리가 속한 차(차 id는 서버 안에서만 쓴다). 구성원당 자리 하나. */
export type MemberSeat = { seatId: string; carId: string };

export type Member = {
  memberId: string;
  familyId: string;
  /** 부르는 이름(예: 엄마). 한 가족 안에서 겹치면 ' 2'를 붙인다. */
  name: string;
  /** 구성원 비밀값. 응답·로그에 나가지 않는다(만들 때 한 번만 본인에게 준다). */
  token: string;
  /** 묶인 폰 자리. 연결 끊기·차곡 초기화로 자리가 사라지면 null이 되지만 구성원은 비밀값으로 가족에 남는다. */
  seat: MemberSeat | null;
  joinedAt: number;
  lastActiveAt: number;
};

export type Family = {
  familyId: string;
  createdAt: number;
  /** 들어온 순서. */
  memberIds: string[];
  invite: { code: string; expiresAt: number } | null;
};

export type InviteResult =
  | { ok: true; family: Family; member: Member; code: string; expiresAt: number; created: boolean }
  | { ok: false; reason: 'family-full' | 'too-many-families' | 'rate-limited' };

export type JoinResult =
  | { ok: true; family: Family; member: Member }
  | { ok: false; reason: 'invalid' | 'already-in-family' | 'family-full' }
  | { ok: false; reason: 'locked'; retryAfterMs: number };

export type ShareResult = { ok: true } | { ok: false; reason: 'unknown-member' | 'self' };

/** 폰이 누구인지의 증거: 구성원 비밀값(있으면)과 폰 토큰이 가리키는 자리(있으면). 가드가 만든다. */
export type PhoneIdentity = { memberToken: string | null; seat: MemberSeat | null };

export type GroupHooks = {
  /** 구성원이 가족에서 나갔다(나가기·정리·밀려남): 그 사람이 보낸·받은 요청을 지운다. */
  onLeft: (memberId: string, familyId: string) => void;
  /** 가족이 사라졌다(마지막 구성원이 나감): 그 가족의 요청·'우리 차' 가리킴값을 지운다. */
  onFamilyGone: (familyId: string) => void;
  /** 그 차에 이 가족의 자리가 하나도 남지 않았다(끊기·차곡 초기화·자리 정리·가족 나가기): 그 차로 보낸 '우리 차' 요청을 지운다. */
  onCarLost: (familyId: string, carId: string) => void;
  /** 가족이 요청을 하나라도 가지고 있는가(혼자뿐인 빈 가족을 가려내는 데 쓴다). */
  hasRequests: (familyId: string) => boolean;
};

const cleanName = (raw: string | undefined) => {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_MEMBER_NAME_LENGTH).trim();
  return name === '' ? DEFAULT_MEMBER_NAME : name;
};

/**
 * 가족(가족 id, 구성원, 부르는 이름, 도착 예정 공유)을 메모리에 둔다(서버를 다시 켜면 사라진다). 가족은 차와 따로 묶는다.
 *
 * 구성원 신분은 **구성원 비밀값**이다. 가족을 만들거나 참여할 때 비밀값을 한 번 준다. 폰 신원은 ① 비밀값(`X-Chagok-Member`) 또는 ② 이미 구성원에게
 * 묶인 자리의 폰 토큰이다. 자리와 구성원을 묶는 것은 같은 요청에 비밀값과 폰 토큰이 함께 온 경우뿐이다(둘 다 가졌음의 증명, 구성원당 자리 1개).
 * 연결을 끊거나 차곡을 초기화해 자리가 사라지면 묶음만 풀리고 구성원은 비밀값으로 가족에 남는다. 폰 바꾸기는 자리가 그대로라 구성원도 이어진다.
 */
export function createFamilyGroups({
  now,
  hooks,
  maxFamilies = MAX_FAMILIES,
}: {
  now: () => Date;
  hooks: GroupHooks;
  maxFamilies?: number;
}) {
  const t = () => now().getTime();
  const families = new Map<string, Family>();
  const members = new Map<string, Member>();
  const byToken = new Map<string, string>(); // 구성원 비밀값 → memberId
  const bySeat = new Map<string, string>(); // 자리 id → memberId
  const inviteIndex = new Map<string, string>(); // 정규화한 코드 → familyId
  /** 도착 예정 공유: 주인 구성원 → 그 주인이 도착 예정을 보여 주기로 한 구성원들. 기본은 아무에게도 안 보임. */
  const shares = new Map<string, Set<string>>();
  /** 요청 주소별 가족을 만든 시각들(하루 창 안의 것만 둔다). */
  const familyCreates = new Map<string, number[]>();
  const attempts = createAttemptGuard(now);

  const dropExpiredInvites = () => {
    const at = t();
    for (const family of families.values()) {
      if (family.invite !== null && family.invite.expiresAt <= at) {
        inviteIndex.delete(family.invite.code);
        family.invite = null;
      }
    }
  };
  const uniqueName = (family: Family, wanted: string, selfId: string | null) => {
    const taken = new Set(family.memberIds.filter((id) => id !== selfId).map((id) => members.get(id)!.name));
    if (!taken.has(wanted)) return wanted;
    for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
  };
  /** 이 가족의 구성원 중 이 차에 묶인 자리를 가진 사람이 있는가. */
  const familyHasSeatOnCar = (familyId: string, carId: string) => {
    const family = families.get(familyId);
    return family !== undefined && family.memberIds.some((id) => members.get(id)?.seat?.carId === carId);
  };
  /** 구성원의 묶인 자리를 바꾼다(null이면 풀기). 옛 자리가 있던 차에 이 가족의 자리가 하나도 안 남으면 알린다. */
  const setSeat = (member: Member, next: MemberSeat | null) => {
    const old = member.seat;
    if (old !== null) bySeat.delete(old.seatId);
    member.seat = next;
    if (next !== null) bySeat.set(next.seatId, member.memberId);
    if (old !== null && !familyHasSeatOnCar(member.familyId, old.carId)) hooks.onCarLost(member.familyId, old.carId);
  };
  const addMember = (family: Family, name: string, seat: MemberSeat | null): Member => {
    const at = t();
    const member: Member = {
      memberId: newId(),
      familyId: family.familyId,
      name: uniqueName(family, cleanName(name), null),
      token: newMemberToken(),
      seat: null,
      joinedAt: at,
      lastActiveAt: at,
    };
    members.set(member.memberId, member);
    byToken.set(member.token, member.memberId);
    family.memberIds.push(member.memberId);
    // 새 구성원이 폰 토큰을 같이 보냈고 그 자리가 아직 아무도 안 가졌으면 바로 묶는다(만든 사람이 곧 그 폰의 주인).
    if (seat !== null && !bySeat.has(seat.seatId)) setSeat(member, seat);
    return member;
  };
  const leave = (memberId: string) => {
    const member = members.get(memberId);
    if (!member) return false;
    byToken.delete(member.token);
    members.delete(memberId);
    // 그 사람의 공유 설정(내가 켠 것, 남이 나에게 켠 것)을 모두 지운다.
    shares.delete(memberId);
    for (const [owner, viewers] of shares) {
      viewers.delete(memberId);
      if (viewers.size === 0) shares.delete(owner);
    }
    const family = families.get(member.familyId);
    const seat = member.seat;
    if (seat !== null) bySeat.delete(seat.seatId);
    if (family) {
      family.memberIds = family.memberIds.filter((id) => id !== memberId);
      if (family.memberIds.length === 0) {
        if (family.invite) inviteIndex.delete(family.invite.code);
        families.delete(family.familyId);
      }
    }
    hooks.onLeft(memberId, member.familyId);
    if (!families.has(member.familyId)) hooks.onFamilyGone(member.familyId);
    else if (seat !== null && !familyHasSeatOnCar(member.familyId, seat.carId)) hooks.onCarLost(member.familyId, seat.carId);
    return true;
  };
  const issueInvite = (family: Family) => {
    if (family.invite) inviteIndex.delete(family.invite.code);
    let code: string;
    do code = newInviteCode();
    while (inviteIndex.has(code));
    family.invite = { code, expiresAt: t() + FAMILY_INVITE_TTL_MS };
    inviteIndex.set(code, family.familyId);
    return family.invite;
  };
  /** 혼자뿐이고 요청이 없는 가족의 그 구성원(밀어내기·정리 후보). */
  const soloEmpty = (family: Family): Member | null => {
    if (family.memberIds.length !== 1) return null;
    const only = members.get(family.memberIds[0] as string);
    return only !== undefined && !hooks.hasRequests(family.familyId) ? only : null;
  };
  const pruneCreates = (at: number) => {
    for (const [source, list] of familyCreates) {
      const recent = list.filter((s) => s > at - FAMILY_CREATE_DAY_WINDOW_MS);
      if (recent.length === 0) familyCreates.delete(source);
      else if (recent.length !== list.length) familyCreates.set(source, recent);
    }
  };

  return {
    /**
     * 폰 신원으로 구성원을 찾는다. 비밀값이 있으면 그 구성원(없는 비밀값이면 `unknown-member`), 없으면 폰 토큰의 자리에 묶인 구성원(없으면 null).
     * 비밀값과 자리가 같이 오면 자리를 그 구성원에게 묶는다: 그 자리가 아직 아무에게도 안 묶였을 때만이고(다른 구성원에게 묶인 자리는 건드리지 않음),
     * 구성원이 다른 자리에 묶여 있었으면 이 자리로 옮긴다(폰이 다른 차에 다시 연결한 경우). 찾으면 마지막으로 쓴 시각을 갱신한다.
     */
    resolve: (identity: PhoneIdentity): Member | null | 'unknown-member' => {
      let found: Member | null = null;
      if (identity.memberToken !== null) {
        const id = byToken.get(identity.memberToken);
        found = id === undefined ? null : members.get(id) ?? null;
        if (found === null) return 'unknown-member';
        if (identity.seat !== null && !bySeat.has(identity.seat.seatId)) setSeat(found, identity.seat);
      } else if (identity.seat !== null) {
        const id = bySeat.get(identity.seat.seatId);
        found = id === undefined ? null : members.get(id) ?? null;
      }
      if (found !== null) found.lastActiveAt = t();
      return found;
    },
    /** 비밀값이 가리키는 구성원이 있는가(가드가 모르는 비밀값을 401로 거른다). */
    knowsToken: (token: string) => byToken.has(token),
    member: (memberId: string) => members.get(memberId) ?? null,
    family: (familyId: string) => families.get(familyId) ?? null,
    membersOf: (familyId: string): Member[] => (families.get(familyId)?.memberIds ?? []).map((id) => members.get(id)!),
    memberBySeat: (seatId: string): Member | null => {
      const id = bySeat.get(seatId);
      return id === undefined ? null : members.get(id) ?? null;
    },
    /** 차가 그 자리 이름으로 부를 때 그 자리의 구성원이 가족 API를 쓴 것으로 센다(차만 쓰는 사람이 30일 비활동으로 내보내지지 않게). */
    touchSeat: (seatId: string) => {
      const id = bySeat.get(seatId);
      const member = id === undefined ? undefined : members.get(id);
      if (member) member.lastActiveAt = t();
    },
    familyHasSeatOnCar,
    familyCount: () => families.size,

    /**
     * 초대 코드를 만든다. 아직 가족이 없으면 가족을 새로 만들고 부른 사람이 첫 구성원이 된다(`name`은 그 사람의 부르는 이름, `seat`는 같이 온 폰 토큰의 자리).
     * 이미 가족이면 그 가족의 새 코드로 바꾼다(이전 코드는 버림). 코드는 24시간 동안 인원이 찰 때까지 여럿이 쓸 수 있다.
     * 가족 수가 상한이면 혼자뿐이고 요청 없는 가장 오래 쓰지 않은 가족을 밀어내고 만들고, 밀어낼 가족이 없을 때만 `too-many-families`다.
     */
    invite: (member: Member | null, seat: MemberSeat | null, name: string | undefined, source: string): InviteResult => {
      dropExpiredInvites();
      if (member === null) {
        const at = t();
        pruneCreates(at);
        const history = familyCreates.get(source) ?? [];
        const recent = history.filter((s) => s > at - FAMILY_CREATE_WINDOW_MS);
        if (recent.length >= MAX_FAMILY_CREATES_PER_SOURCE || history.length >= MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY) return { ok: false, reason: 'rate-limited' };
        if (!familyCreates.has(source) && familyCreates.size >= MAX_TRACKED_CREATE_SOURCES) return { ok: false, reason: 'rate-limited' };
        if (families.size >= maxFamilies) {
          let evict: Member | null = null;
          for (const family of families.values()) {
            const only = soloEmpty(family);
            if (only !== null && (evict === null || only.lastActiveAt < evict.lastActiveAt)) evict = only;
          }
          if (evict === null) return { ok: false, reason: 'too-many-families' };
          leave(evict.memberId);
        }
        familyCreates.set(source, [...history, at]);
        const family: Family = { familyId: newId(), createdAt: at, memberIds: [], invite: null };
        families.set(family.familyId, family);
        const first = addMember(family, name ?? '', seat);
        const invite = issueInvite(family);
        return { ok: true, family, member: first, code: invite.code, expiresAt: invite.expiresAt, created: true };
      }
      const family = families.get(member.familyId)!;
      if (family.memberIds.length >= MAX_FAMILY_MEMBERS) return { ok: false, reason: 'family-full' };
      const invite = issueInvite(family);
      return { ok: true, family, member, code: invite.code, expiresAt: invite.expiresAt, created: false };
    },

    /**
     * 코드로 가족에 든다. 시도 제한은 차 연결 코드와 같다(틀린 코드 5번/60초 → 잠금). 없는·만료된 코드는 같은 `invalid`다.
     * 이미 어느 가족이든 구성원이면 `already-in-family`(같은 가족에 다시 넣어도 마찬가지). 인원이 차 있으면 `family-full`.
     */
    join: (existing: Member | null, seat: MemberSeat | null, rawCode: string, name: string | undefined, source: string): JoinResult => {
      const blocked = attempts.blockedFor(source);
      if (blocked !== null) return { ok: false, reason: 'locked', retryAfterMs: blocked };
      dropExpiredInvites();
      const code = normalizeInviteCode(rawCode);
      const familyId = code === null ? undefined : inviteIndex.get(code);
      const family = familyId === undefined ? undefined : families.get(familyId);
      if (!family) {
        attempts.fail(source);
        return { ok: false, reason: 'invalid' };
      }
      attempts.succeed(source);
      if (existing !== null) return { ok: false, reason: 'already-in-family' };
      if (family.memberIds.length >= MAX_FAMILY_MEMBERS) return { ok: false, reason: 'family-full' };
      return { ok: true, family, member: addMember(family, name ?? '', seat) };
    },

    rename: (member: Member, name: string) => {
      const family = families.get(member.familyId)!;
      member.name = uniqueName(family, cleanName(name), member.memberId);
      return member;
    },

    /** 가족 나가기. 이 구성원이 보낸·받은 요청(`onLeft`)과 공유 설정을 지운다. 마지막 구성원이면 가족도 지운다. */
    leave,

    setShare: (owner: Member, targetId: string, enabled: boolean): ShareResult => {
      if (targetId === owner.memberId) return { ok: false, reason: 'self' };
      const target = members.get(targetId);
      if (!target || target.familyId !== owner.familyId) return { ok: false, reason: 'unknown-member' };
      const viewers = shares.get(owner.memberId) ?? new Set<string>();
      if (enabled) viewers.add(targetId);
      else viewers.delete(targetId);
      if (viewers.size === 0) shares.delete(owner.memberId);
      else shares.set(owner.memberId, viewers);
      return { ok: true };
    },
    /** owner가 viewer에게 도착 예정을 보여 주기로 했는가. */
    shares: (ownerId: string, viewerId: string) => shares.get(ownerId)?.has(viewerId) ?? false,

    /**
     * 자리 이벤트를 따라간다. 자리가 지워지면(`removed`: 연결 끊기·차곡 초기화·자리 정리) 그 자리의 묶음만 푼다: 구성원은 비밀값으로 가족에 남고,
     * 그 차에 이 가족의 자리가 하나도 안 남으면 그 차로 보낸 '우리 차' 요청이 지워진다(`onCarLost`). 새 자리(`created`)와 폰 바꾸기(`replaced`)는
     * 묶음을 바꾸지 않는다: 새 자리는 구성원 비밀값과 폰 토큰이 같이 오는 첫 요청에서 묶이고, 폰 바꾸기는 자리가 그대로라 구성원도 그대로다.
     */
    onSeatEvent: (event: SeatEvent) => {
      if (event.type !== 'removed') return;
      const id = bySeat.get(event.seatId);
      const member = id === undefined ? undefined : members.get(id);
      if (member) setSeat(member, null);
    },

    /**
     * 정기 정리: 만료된 초대 코드를 버리고, 하루가 지난 가족 만들기 기록을 비우고, 30일 쓰지 않은 구성원과 24시간 쓰지 않은 '혼자뿐인 빈 가족'을 내보낸다.
     * 나간 구성원 수.
     */
    purge: (at: Date): number => {
      dropExpiredInvites();
      pruneCreates(at.getTime());
      let left = 0;
      for (const member of [...members.values()]) {
        if (!members.has(member.memberId)) continue;
        if (member.lastActiveAt + MEMBER_INACTIVE_TTL_MS <= at.getTime() && leave(member.memberId)) left += 1;
      }
      for (const family of [...families.values()]) {
        const only = soloEmpty(family);
        if (only !== null && only.lastActiveAt + SOLO_FAMILY_TTL_MS <= at.getTime() && leave(only.memberId)) left += 1;
      }
      return left;
    },
    /** 테스트용: 가족 만들기 기록을 가진 주소 수. */
    trackedCreateSources: () => familyCreates.size,
  };
}

export type FamilyGroups = ReturnType<typeof createFamilyGroups>;
