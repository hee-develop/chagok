import { parseAt, parseSeoulDate, seoulDay } from '../time.js';
import {
  MAX_COMPANIONS,
  MAX_REQUEST_DAYS_AHEAD,
  MAX_REQUEST_ITEM_LENGTH,
  MAX_REQUEST_MEMO_LENGTH,
  MAX_REQUEST_PERSON_LENGTH,
  MAX_REQUEST_PLACE_LENGTH,
} from './limits.js';

export const CATEGORIES = ['care', 'stop', 'appointment', 'ride'] as const;
/** care 채비 · stop 들르기 · appointment 약속 가기 · ride 데려다주기·픽업(정책서 10.10 표). */
export type Category = (typeof CATEGORIES)[number];

/** 요청 상태. `sent` 보냄 → `delivered` 전달 → `accepted` 수락 | `declined` 거절 → `completed` 완료. 문구는 카테고리별로 폰이 정한다. */
export const STATUSES = ['sent', 'delivered', 'accepted', 'declined', 'completed'] as const;
export type Status = (typeof STATUSES)[number];
/** 차가 PATCH로 바꿀 수 있는 상태(보냄은 만들 때의 상태라 차가 되돌릴 수 없다). */
export const PATCHABLE_STATUSES = ['delivered', 'accepted', 'declined', 'completed'] as const;
export type PatchableStatus = (typeof PATCHABLE_STATUSES)[number];
/** 더는 바뀌지 않는 상태(거절·완료). */
export const isTerminal = (status: Status) => status === 'declined' || status === 'completed';

/**
 * 상태 전이 표(차가 PATCH로 부른다). 표에 없는 전이는 409 `invalid-transition`이고, 같은 상태로 다시 보내면 아무것도 바꾸지 않고 200이다(차의 재시도).
 *
 * | 카테고리 | 보냄 | 전달 | 수락 | 거절 | 완료 |
 * | --- | --- | --- | --- | --- | --- |
 * | 채비 | → 전달 | → 완료 | — | — | — |
 * | 들르기·약속 가기·데려다주기·픽업 | → 전달 | → 수락·거절·완료 | → 완료 | — | — |
 *
 * 채비는 묻지 않고 말만 하므로 수락·거절이 없다. 나머지는 전달 → 완료도 된다(그 장소에 도착했는데 '응'을 안 했거나 무응답이었던 경우).
 */
export const TRANSITIONS: Record<Category, Record<Status, readonly PatchableStatus[]>> = {
  care: { sent: ['delivered'], delivered: ['completed'], accepted: [], declined: [], completed: [] },
  stop: { sent: ['delivered'], delivered: ['accepted', 'declined', 'completed'], accepted: ['completed'], declined: [], completed: [] },
  appointment: { sent: ['delivered'], delivered: ['accepted', 'declined', 'completed'], accepted: ['completed'], declined: [], completed: [] },
  ride: { sent: ['delivered'], delivered: ['accepted', 'declined', 'completed'], accepted: ['completed'], declined: [], completed: [] },
};
export const canTransition = (category: Category, from: Status, to: PatchableStatus) => TRANSITIONS[category][from].includes(to);

/** 장소 칸: 글자와 선택적 좌표(둘 다 있거나 둘 다 없음). 해석은 차·다른 묶음의 몫이라 서버는 받은 대로 담는다. */
export type PlaceField = { text: string; lat?: number; lng?: number };
export type Deadline = { type: 'today' } | { type: 'by'; time: string };

/** 카테고리별로 폰에서 적는 것(정책서 10.10 표). 요청과 응답이 같은 모양이다. */
export type Fields =
  | { category: 'care'; item: string; timing: 'take-along' | 'bring-back' }
  | { category: 'stop'; place: PlaceField; item: string; deadline: Deadline }
  | { category: 'appointment'; at: string; place: PlaceField; companions: string[] }
  | { category: 'ride'; who: string; pickup: PlaceField; dropoff: PlaceField; at: string };

export type Recipient = { memberId: string } | { carRef: string };

export type CreateBody = {
  fields: Fields;
  recipient: Recipient;
  memo: string | null;
  /** 요청이 속한 서울 날짜(`YYYY-MM-DD`). 약속·픽업은 시각(`at`)의 날짜, 나머지는 `date`(없으면 오늘). 날짜가 지나면 지운다. */
  date: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 앞뒤 공백을 자르고 줄바꿈·연속 공백을 공백 하나로 줄인다(한 줄). */
const oneLine = (v: string) => v.trim().replace(/\s+/g, ' ');

const textOf = (v: unknown, max: number, label: string): string | { error: string } => {
  if (typeof v !== 'string') return { error: `${label}는 문자열이어야 합니다` };
  const text = oneLine(v);
  if (text === '') return { error: `${label}가 비어 있습니다` };
  if (text.length > max) return { error: `${label}는 ${max}자 이하여야 합니다` };
  return text;
};

const placeOf = (v: unknown, label: string): PlaceField | { error: string } => {
  if (!isObject(v)) return { error: `${label}는 { text, lat?, lng? } 객체여야 합니다` };
  if (Object.keys(v).some((k) => k !== 'text' && k !== 'lat' && k !== 'lng')) return { error: `${label}에 알 수 없는 항목이 있습니다` };
  const text = textOf(v.text, MAX_REQUEST_PLACE_LENGTH, `${label}.text`);
  if (typeof text !== 'string') return text;
  const hasLat = v.lat !== undefined;
  const hasLng = v.lng !== undefined;
  if (hasLat !== hasLng) return { error: `${label}의 lat과 lng는 함께 있어야 합니다` };
  if (!hasLat) return { text };
  if (typeof v.lat !== 'number' || typeof v.lng !== 'number' || !Number.isFinite(v.lat) || !Number.isFinite(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) {
    return { error: `${label}의 좌표가 올바르지 않습니다` };
  }
  return { text, lat: v.lat, lng: v.lng };
};

const ALLOWED_KEYS: Record<Category, readonly string[]> = {
  care: ['category', 'recipient', 'memo', 'date', 'item', 'timing'],
  stop: ['category', 'recipient', 'memo', 'date', 'place', 'item', 'deadline'],
  appointment: ['category', 'recipient', 'memo', 'at', 'place', 'companions'],
  ride: ['category', 'recipient', 'memo', 'who', 'pickup', 'dropoff', 'at'],
};

/** 요청이 속할 수 있는 서울 날짜 번호 범위(오늘~내일). */
export const dayWindow = (at: Date) => ({ first: seoulDay(at.getTime()), last: seoulDay(at.getTime()) + MAX_REQUEST_DAYS_AHEAD });

const formatDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

/**
 * `POST /requests` 본문을 검증한다. 모양이 틀리면 한국어 오류 문구(400), 맞으면 정리한 값.
 * - `category`: care | stop | appointment | ride. 카테고리마다 쓸 수 있는 항목이 정해져 있고 그 밖의 항목은 거절한다.
 * - `recipient`: `{ memberId }`(가족 한 사람) 또는 `{ carRef }`('우리 차').
 * - 날짜: care·stop은 `date`(`YYYY-MM-DD`, 생략하면 오늘), appointment·ride는 `at`(오프셋이 있는 ISO8601)의 서울 날짜. 오늘·내일만 받는다.
 */
export function parseCreateBody(raw: unknown, now: Date): CreateBody | { error: string } {
  if (!isObject(raw)) return { error: '본문은 객체여야 합니다' };
  const category = raw.category;
  if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) {
    return { error: "category는 'care'·'stop'·'appointment'·'ride' 중 하나여야 합니다" };
  }
  const cat = category as Category;
  const unknown = Object.keys(raw).find((k) => !ALLOWED_KEYS[cat].includes(k));
  if (unknown !== undefined) return { error: `${cat} 요청에는 ${unknown} 항목을 쓸 수 없습니다` };

  const r = raw.recipient;
  if (!isObject(r) || Object.keys(r).length !== 1) return { error: 'recipient는 { memberId } 또는 { carRef } 하나여야 합니다' };
  let recipient: Recipient;
  if (typeof r.memberId === 'string' && r.memberId.length > 0 && r.memberId.length <= 100) recipient = { memberId: r.memberId };
  else if (typeof r.carRef === 'string' && r.carRef.length > 0 && r.carRef.length <= 100) recipient = { carRef: r.carRef };
  else return { error: 'recipient는 { memberId } 또는 { carRef } 하나여야 합니다' };

  let memo: string | null = null;
  if (raw.memo !== undefined && raw.memo !== null) {
    if (typeof raw.memo !== 'string') return { error: 'memo는 문자열 또는 null이어야 합니다' };
    const text = oneLine(raw.memo);
    if (text.length > MAX_REQUEST_MEMO_LENGTH) return { error: `memo는 ${MAX_REQUEST_MEMO_LENGTH}자 이하여야 합니다` };
    memo = text === '' ? null : text;
  }

  const { first, last } = dayWindow(now);
  const dayOfDate = (): number | { error: string } => {
    if (raw.date === undefined) return first;
    if (typeof raw.date !== 'string') return { error: 'date는 YYYY-MM-DD 문자열이어야 합니다' };
    const day = parseSeoulDate(raw.date);
    if (day === null) return { error: 'date는 YYYY-MM-DD 형식의 실제 날짜여야 합니다' };
    return day;
  };
  const dayOfAt = (value: unknown): { at: string; day: number } | { error: string } => {
    if (typeof value !== 'string') return { error: 'at은 오프셋이 있는 ISO8601 시각 문자열이어야 합니다' };
    const parsed = parseAt(value);
    if (parsed === null) return { error: 'at은 오프셋이 있는 ISO8601 시각이어야 합니다' };
    return { at: parsed.toISOString(), day: seoulDay(parsed.getTime()) };
  };

  let fields: Fields;
  let day: number;
  if (cat === 'care') {
    const item = textOf(raw.item, MAX_REQUEST_ITEM_LENGTH, 'item');
    if (typeof item !== 'string') return item;
    if (raw.timing !== 'take-along' && raw.timing !== 'bring-back') return { error: "timing은 'take-along'(가져갈 때) 또는 'bring-back'(가져올 때)이어야 합니다" };
    const d = dayOfDate();
    if (typeof d !== 'number') return d;
    day = d;
    fields = { category: 'care', item, timing: raw.timing };
  } else if (cat === 'stop') {
    const place = placeOf(raw.place, 'place');
    if ('error' in place) return place;
    const item = textOf(raw.item, MAX_REQUEST_ITEM_LENGTH, 'item');
    if (typeof item !== 'string') return item;
    const dl = raw.deadline;
    let deadline: Deadline;
    if (isObject(dl) && dl.type === 'today' && Object.keys(dl).length === 1) deadline = { type: 'today' };
    else if (isObject(dl) && dl.type === 'by' && Object.keys(dl).length === 2 && typeof dl.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(dl.time)) {
      deadline = { type: 'by', time: dl.time };
    } else return { error: "deadline은 { type: 'today' } 또는 { type: 'by', time: 'HH:MM' }이어야 합니다" };
    const d = dayOfDate();
    if (typeof d !== 'number') return d;
    day = d;
    fields = { category: 'stop', place, item, deadline };
  } else if (cat === 'appointment') {
    const at = dayOfAt(raw.at);
    if ('error' in at) return at;
    const place = placeOf(raw.place, 'place');
    if ('error' in place) return place;
    const companionsRaw = raw.companions ?? [];
    if (!Array.isArray(companionsRaw) || companionsRaw.length > MAX_COMPANIONS) return { error: `companions는 이름 ${MAX_COMPANIONS}개 이하의 배열이어야 합니다` };
    const companions: string[] = [];
    for (const c of companionsRaw) {
      const name = textOf(c, MAX_REQUEST_PERSON_LENGTH, 'companions의 이름');
      if (typeof name !== 'string') return name;
      companions.push(name);
    }
    day = at.day;
    fields = { category: 'appointment', at: at.at, place, companions };
  } else {
    const who = textOf(raw.who, MAX_REQUEST_PERSON_LENGTH, 'who');
    if (typeof who !== 'string') return who;
    const pickup = placeOf(raw.pickup, 'pickup');
    if ('error' in pickup) return pickup;
    const dropoff = placeOf(raw.dropoff, 'dropoff');
    if ('error' in dropoff) return dropoff;
    const at = dayOfAt(raw.at);
    if ('error' in at) return at;
    day = at.day;
    fields = { category: 'ride', who, pickup, dropoff, at: at.at };
  }
  if (day < first || day > last) return { error: '요청은 오늘·내일(서울 날짜)로만 보낼 수 있습니다' };
  return { fields, recipient, memo, date: formatDay(day) };
}

/** 서버가 저장하는 요청. 보낸 사람·받는 사람은 구성원 id이고, '우리 차'는 서버 안의 차 id다(폰에는 `carRef`만 준다). */
export type RequestRecord = {
  id: string;
  familyId: string;
  senderId: string;
  recipient: { kind: 'member'; memberId: string } | { kind: 'car'; carId: string };
  fields: Fields;
  memo: string | null;
  date: string;
  status: Status;
  /** 도착 5분 전을 공유해 보냈는가(도착 예정 공유가 켜져 있을 때만 참). 시각은 저장하지 않는다. */
  etaSoon: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

/** 요청 저장소(메모리). 날짜가 지난 요청과 완료 보관 시간이 지난 요청은 `alive`가 아니라 읽기에서 보이지 않고 `purge`가 지운다. */
export function createRequestStore() {
  const records = new Map<string, RequestRecord>();
  return {
    add: (record: RequestRecord) => void records.set(record.id, record),
    get: (id: string) => records.get(id) ?? null,
    all: () => [...records.values()],
    remove: (id: string) => records.delete(id),
    removeWhere: (predicate: (record: RequestRecord) => boolean) => {
      let removed = 0;
      for (const [id, record] of records) {
        if (predicate(record)) {
          records.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
    size: () => records.size,
  };
}
export type RequestStore = ReturnType<typeof createRequestStore>;
