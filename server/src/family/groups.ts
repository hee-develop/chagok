import type { SeatEvent } from '../seats.js';
import { createAttemptGuard } from './attempts.js';
import {
  DEFAULT_MEMBER_NAME,
  DEVICE_MEMBER_TTL_MS,
  FAMILY_CREATE_WINDOW_MS,
  FAMILY_INVITE_TTL_MS,
  MAX_FAMILIES,
  MAX_FAMILY_CREATES_PER_SOURCE,
  MAX_FAMILY_MEMBERS,
  MAX_MEMBER_NAME_LENGTH,
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

/** 구성원 식별 키: 연결된 자리 `s:<seatId>`, 폰의 기기 id `d:<deviceId>`. 폰은 연결 전에는 기기 id로, 연결 뒤에는 둘 다로 알아본다. */
export const seatKey = (seatId: string) => `s:${seatId}`;
export const deviceKey = (deviceId: string) => `d:${deviceId}`;

export type Member = {
  memberId: string;
  familyId: string;
  /** 부르는 이름(예: 엄마). 한 가족 안에서 겹치면 ' 2'를 붙인다. */
  name: string;
  keys: Set<string>;
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

/** 가족을 나가거나 쫓겨난(자리가 사라져 식별할 방법이 없어진) 구성원을 요청 저장소가 알아 그 사람의 요청을 지운다. */
export type MemberLeft = (memberId: string, familyId: string) => void;

const cleanName = (raw: string | undefined) => {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_MEMBER_NAME_LENGTH).trim();
  return name === '' ? DEFAULT_MEMBER_NAME : name;
};

/**
 * 가족(가족 id, 구성원 폰/자리, 부르는 이름, 도착 예정 공유)을 메모리에 둔다(서버를 다시 켜면 사라진다). 가족은 차와 따로 묶는다.
 * 구성원은 사람 하나이고 식별 키는 여럿일 수 있다(자리 키와 기기 id 키): 폰이 차에 연결해도 같은 구성원으로 이어지고,
 * 차 연결을 끊어도(자리가 사라져도) 기기 id로 계속 가족에 남는다.
 */
export function createFamilyGroups({ now, onLeft }: { now: () => Date; onLeft: MemberLeft }) {
  const t = () => now().getTime();
  const families = new Map<string, Family>();
  const members = new Map<string, Member>();
  const byKey = new Map<string, string>(); // 식별 키 → memberId
  const inviteIndex = new Map<string, string>(); // 정규화한 코드 → familyId
  /** 도착 예정 공유: 주인 구성원 → 그 주인이 도착 예정을 보여 주기로 한 구성원들. 기본은 아무에게도 안 보임. */
  const shares = new Map<string, Set<string>>();
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
  const addMember = (family: Family, keys: string[], name: string): Member => {
    const at = t();
    const member: Member = {
      memberId: newId(),
      familyId: family.familyId,
      name: uniqueName(family, cleanName(name), null),
      keys: new Set(keys.filter((k) => !byKey.has(k))),
      joinedAt: at,
      lastActiveAt: at,
    };
    members.set(member.memberId, member);
    family.memberIds.push(member.memberId);
    for (const k of member.keys) byKey.set(k, member.memberId);
    return member;
  };
  const leave = (memberId: string) => {
    const member = members.get(memberId);
    if (!member) return false;
    for (const k of member.keys) byKey.delete(k);
    members.delete(memberId);
    // 그 사람의 공유 설정(내가 켠 것, 남이 나에게 켠 것)을 모두 지운다.
    shares.delete(memberId);
    for (const [owner, viewers] of shares) {
      viewers.delete(memberId);
      if (viewers.size === 0) shares.delete(owner);
    }
    const family = families.get(member.familyId);
    if (family) {
      family.memberIds = family.memberIds.filter((id) => id !== memberId);
      if (family.memberIds.length === 0) {
        if (family.invite) inviteIndex.delete(family.invite.code);
        families.delete(family.familyId);
      }
    }
    onLeft(memberId, member.familyId);
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

  return {
    /**
     * 식별 키로 구성원을 찾는다(자리 키가 먼저). 하나라도 찾으면 아직 어느 구성원도 안 가진 나머지 키를 그 구성원에게 이어 붙인다
     * (차에 연결한 뒤에도 같은 구성원). 두 키가 서로 다른 구성원을 가리키면 앞의 키가 이기고 합치지 않는다.
     */
    resolve: (keys: string[]): Member | null => {
      let found: Member | null = null;
      for (const k of keys) {
        const id = byKey.get(k);
        if (id !== undefined) {
          found = members.get(id) ?? null;
          break;
        }
      }
      if (found === null) return null;
      for (const k of keys) {
        if (!byKey.has(k)) {
          found.keys.add(k);
          byKey.set(k, found.memberId);
        }
      }
      found.lastActiveAt = t();
      return found;
    },
    member: (memberId: string) => members.get(memberId) ?? null,
    family: (familyId: string) => families.get(familyId) ?? null,
    membersOf: (familyId: string): Member[] => (families.get(familyId)?.memberIds ?? []).map((id) => members.get(id)!),
    memberBySeat: (seatId: string): Member | null => {
      const id = byKey.get(seatKey(seatId));
      return id === undefined ? null : members.get(id) ?? null;
    },
    familyCount: () => families.size,

    /**
     * 초대 코드를 만든다. 아직 가족이 없으면 가족을 새로 만들고 부른 사람이 첫 구성원이 된다(`name`은 그 사람의 부르는 이름).
     * 이미 가족이면 그 가족의 새 코드로 바꾼다(이전 코드는 버림). 코드는 24시간 동안 인원이 찰 때까지 여럿이 쓸 수 있다.
     */
    invite: (member: Member | null, keys: string[], name: string | undefined, source: string): InviteResult => {
      dropExpiredInvites();
      if (member === null) {
        const at = t();
        const recent = (familyCreates.get(source) ?? []).filter((s) => s > at - FAMILY_CREATE_WINDOW_MS);
        if (recent.length >= MAX_FAMILY_CREATES_PER_SOURCE) return { ok: false, reason: 'rate-limited' };
        if (families.size >= MAX_FAMILIES) return { ok: false, reason: 'too-many-families' };
        familyCreates.set(source, [...recent, at]);
        const family: Family = { familyId: newId(), createdAt: at, memberIds: [], invite: null };
        families.set(family.familyId, family);
        const first = addMember(family, keys, name ?? '');
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
    join: (existing: Member | null, keys: string[], rawCode: string, name: string | undefined, source: string): JoinResult => {
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
      return { ok: true, family, member: addMember(family, keys, name ?? '') };
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
     * 자리 이벤트를 따라간다.
     * - 새 자리(`created`): 그 요청의 기기 id가 이미 구성원이면 그 구성원에게 자리 키를 이어 붙인다(연결해도 같은 구성원).
     * - 폰 바꾸기(`replaced`): 자리의 구성원은 그대로이고 옛 폰의 기기 id 키는 뗀다(옛 폰이 계속 가족으로 보이지 않게). 새 폰의 기기 id가 아직 누구의 키도 아니면 붙인다.
     * - 자리 삭제(`removed`: 연결 끊기·차 초기화): 자리 키를 뗀다. 기기 id 키가 남아 있으면 가족에는 그대로 남고, 식별할 키가 하나도 없으면 가족에서 나간다.
     */
    onSeatEvent: (event: SeatEvent) => {
      const sKey = seatKey(event.seatId);
      if (event.type === 'created') {
        if (event.deviceId === null) return;
        const memberId = byKey.get(deviceKey(event.deviceId));
        const member = memberId === undefined ? undefined : members.get(memberId);
        if (member && !byKey.has(sKey)) {
          member.keys.add(sKey);
          byKey.set(sKey, member.memberId);
        }
        return;
      }
      const memberId = byKey.get(sKey);
      const member = memberId === undefined ? undefined : members.get(memberId);
      if (!member) return;
      if (event.type === 'replaced') {
        for (const k of [...member.keys]) {
          if (k.startsWith('d:')) {
            member.keys.delete(k);
            byKey.delete(k);
          }
        }
        if (event.deviceId !== null && !byKey.has(deviceKey(event.deviceId))) {
          member.keys.add(deviceKey(event.deviceId));
          byKey.set(deviceKey(event.deviceId), member.memberId);
        }
        return;
      }
      member.keys.delete(sKey);
      byKey.delete(sKey);
      if (member.keys.size === 0) leave(member.memberId);
    },

    /** 만료된 초대 코드를 버리고, 오래 쓰지 않은 '기기 id만' 구성원(자리 키 없음)을 가족에서 내보낸다. 나간 구성원 수. */
    purge: (at: Date): number => {
      dropExpiredInvites();
      let left = 0;
      for (const member of [...members.values()]) {
        const hasSeat = [...member.keys].some((k) => k.startsWith('s:'));
        if (!hasSeat && member.lastActiveAt + DEVICE_MEMBER_TTL_MS <= at.getTime() && leave(member.memberId)) left += 1;
      }
      return left;
    },
  };
}

export type FamilyGroups = ReturnType<typeof createFamilyGroups>;
