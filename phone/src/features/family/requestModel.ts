import { strings } from '../../i18n/ko';
import { formatScheduleTime } from '../fill-places/scheduleFormat';
import { seoulDay } from '../calendar-sync/seoulTime';

/** 요청 카테고리: 채비·들르기·약속 가기·데려다주기·픽업(정책서 10.10 표). */
export type RequestCategory = 'care' | 'stop' | 'appointment' | 'ride';
export const CATEGORIES: readonly RequestCategory[] = ['care', 'stop', 'appointment', 'ride'];

/** 요청 상태 코드: 보냄 → 전달 → 수락·거절 → 완료. 문구는 이 파일이 카테고리별로 정한다(서버는 코드만 준다). */
export type RequestStatus = 'sent' | 'delivered' | 'accepted' | 'declined' | 'completed';
const STATUSES: readonly RequestStatus[] = ['sent', 'delivered', 'accepted', 'declined', 'completed'];

/** 장소 칸: 글자와 선택적 좌표(둘 다 있거나 둘 다 없음). */
export type PlaceInput = { text: string; lat?: number; lng?: number };
export type Deadline = { type: 'today' } | { type: 'by'; time: string };

export type RequestFields =
  | { category: 'care'; item: string; timing: 'take-along' | 'bring-back' }
  | { category: 'stop'; place: PlaceInput; item: string; deadline: Deadline }
  | { category: 'appointment'; at: string; place: PlaceInput; companions: string[] }
  | { category: 'ride'; who: string; pickup: PlaceInput; dropoff: PlaceInput; at: string };

type Person = { memberId: string; name: string };
type Common = {
  id: string;
  memo: string | null;
  date: string;
  status: RequestStatus;
  createdAt: string;
  from: Person;
  to: ({ kind: 'member' } & Person) | { kind: 'car'; carRef: string };
  /** 받는 사람에게 닿을 곳이 있는가(사람: 폰이 어느 차에 연결돼 있는가, 차: 그 차에 이 가족의 자리가 있는가). 거짓이면 그 사람 폰 앱에만 보인다. */
  reachable: boolean;
};

/** 받은 사람 폰이 보는 요청. */
export type ReceivedRequest = Common & RequestFields;
/** 보낸 사람 폰이 보는 요청. `drivingNow`·`etaStage`는 받는 사람이 도착 예정 공유를 켠 약속·픽업에서만 의미가 있다. */
export type SentRequest = ReceivedRequest & { drivingNow: boolean; etaStage: 'soon' | null };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

const placeOf = (v: unknown): PlaceInput | null => {
  if (!isObject(v) || !isString(v.text)) return null;
  const hasCoords = typeof v.lat === 'number' && typeof v.lng === 'number';
  return hasCoords ? { text: v.text, lat: v.lat as number, lng: v.lng as number } : { text: v.text };
};
const personOf = (v: unknown): Person | null => (isObject(v) && isString(v.memberId) && isString(v.name) ? { memberId: v.memberId, name: v.name } : null);

/**
 * 서버 응답 한 건을 화면 모델로 바꾼다. 서버 타입은 카테고리별 항목을 담지 못하므로(`Omit`된 합집합) 모양을 직접 확인하고,
 * 모르는 카테고리·상태나 모자란 항목이 있으면 null로 버려 화면이 깨지지 않게 한다.
 */
export function normalizeRequest(raw: unknown): SentRequest | null {
  if (!isObject(raw) || !isString(raw.id) || !isString(raw.date) || !isString(raw.createdAt)) return null;
  const status = raw.status as RequestStatus;
  if (!STATUSES.includes(status)) return null;
  const from = personOf(raw.from);
  if (from === null || !isObject(raw.to)) return null;
  let to: Common['to'];
  if (raw.to.kind === 'member' && personOf(raw.to) !== null) to = { kind: 'member', ...(personOf(raw.to) as Person) };
  else if (raw.to.kind === 'car' && isString(raw.to.carRef)) to = { kind: 'car', carRef: raw.to.carRef };
  else return null;
  const common: Common = { id: raw.id, memo: isString(raw.memo) ? raw.memo : null, date: raw.date, status, createdAt: raw.createdAt, from, to, reachable: raw.reachable !== false };
  const extra = { drivingNow: raw.drivingNow === true, etaStage: raw.etaStage === 'soon' ? ('soon' as const) : null };

  switch (raw.category) {
    case 'care':
      if (!isString(raw.item) || (raw.timing !== 'take-along' && raw.timing !== 'bring-back')) return null;
      return { ...common, ...extra, category: 'care', item: raw.item, timing: raw.timing };
    case 'stop': {
      const place = placeOf(raw.place);
      const dl = raw.deadline;
      let deadline: Deadline | null = null;
      if (isObject(dl) && dl.type === 'today') deadline = { type: 'today' };
      else if (isObject(dl) && dl.type === 'by' && isString(dl.time)) deadline = { type: 'by', time: dl.time };
      if (place === null || !isString(raw.item) || deadline === null) return null;
      return { ...common, ...extra, category: 'stop', place, item: raw.item, deadline };
    }
    case 'appointment': {
      const place = placeOf(raw.place);
      if (place === null || !isString(raw.at)) return null;
      const companions = Array.isArray(raw.companions) ? raw.companions.filter(isString) : [];
      return { ...common, ...extra, category: 'appointment', at: raw.at, place, companions };
    }
    case 'ride': {
      const pickup = placeOf(raw.pickup);
      const dropoff = placeOf(raw.dropoff);
      if (pickup === null || dropoff === null || !isString(raw.who) || !isString(raw.at)) return null;
      return { ...common, ...extra, category: 'ride', who: raw.who, pickup, dropoff, at: raw.at };
    }
    default:
      return null;
  }
}

export const normalizeRequests = (raw: unknown): SentRequest[] => (Array.isArray(raw) ? raw.map(normalizeRequest).filter((r): r is SentRequest => r !== null) : []);

/**
 * 보낸 사람 폰의 상태 문구(정책서 10.10 '보낸 사람 폰' 열 + docs/family-requests.md 상태 코드 표).
 *
 * | 카테고리 | 보냄 | 전달 | 수락 | 완료 |
 * | --- | --- | --- | --- | --- |
 * | 채비 | 차에 타면 전해요 | 전달했어요 | (없음) | 챙기라고 전했어요 |
 * | 들르기 | 〃 | 전달했어요 | 수락했어요 | 들렀어요 |
 * | 약속 가기 | 〃 | 전달했어요 | 출발했어요 (5분 전 공유: 곧 도착해요) | 도착했어요 |
 * | 데려다주기·픽업 | 〃 | 전달했어요 | 수락했어요 (5분 전 공유: 곧 도착해요) | 도착했어요 |
 * | 거절(들르기·약속·픽업) | 이번엔 어려워요 |
 *
 * 보냄은 받는 사람이 도착 예정 공유를 켠 약속·픽업이고 지금 운전 중이면(`drivingNow`) '운전 중이라 다음 정차 때 전해요', 받는 사람 폰이 어느 차에도 연결되지 않았으면(`reachable` 거짓)
 * '폰 앱에서만 볼 수 있어요', 그 밖에는 '차에 타면 전해요'다. `etaStage: 'soon'`은 전달·수락 상태에서 도착 5분 전 문구로 바꾼다.
 */
export function senderStatusLabel(request: Pick<SentRequest, 'category' | 'status' | 'reachable' | 'drivingNow' | 'etaStage'>): string {
  const t = strings.family.status;
  const { category, status } = request;
  const soon = request.etaStage === 'soon' && (category === 'appointment' || category === 'ride') && (status === 'delivered' || status === 'accepted');
  if (soon) return category === 'ride' ? t.rideSoon : t.appointmentSoon;
  switch (status) {
    case 'sent':
      if (request.drivingNow) return t.sentDriving;
      return request.reachable ? t.sentRiding : t.sentPhoneOnly;
    case 'delivered':
      return t.delivered;
    case 'accepted':
      return category === 'appointment' ? t.appointmentAccepted : category === 'ride' ? t.rideAccepted : t.stopAccepted;
    case 'declined':
      return t.declined;
    case 'completed':
      return category === 'care' ? t.careDone : category === 'stop' ? t.stopDone : t.arrived;
  }
}

/** 받는 사람 폰의 상태 문구. 받는 사람에게는 알림이 없고(정책서 10.6) 목록에서만 보이므로 차가 어디까지 했는지만 짧게 적는다. */
export function receivedStatusLabel(request: Pick<ReceivedRequest, 'status' | 'reachable'>): string {
  const t = strings.family.receivedStatus;
  switch (request.status) {
    case 'sent':
      return request.reachable ? t.sent : t.sentPhoneOnly;
    case 'delivered':
      return t.delivered;
    case 'accepted':
      return t.accepted;
    case 'declined':
      return t.declined;
    case 'completed':
      return t.done;
  }
}

/** 시각에 날짜를 앞세운다: 오늘이면 `18:30`, 내일이면 `내일 18:30`. */
function whenLabel(iso: string, now: Date): string {
  const time = formatScheduleTime(iso);
  const offset = seoulDay(new Date(iso).getTime()) - seoulDay(now.getTime());
  return offset >= 1 ? `${strings.family.day.tomorrow} ${time}` : time;
}

/** 요청 날짜(`YYYY-MM-DD`, 서울)가 오늘보다 뒤인가. 시각이 없는 채비·들르기가 '내일'임을 알린다. */
const isTomorrowDate = (date: string, now: Date) => {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return day > seoulDay(now.getTime());
};

/** 요청 한 줄 요약: 카테고리별 항목(물건·장소·시각·사람)을 짧게 이어 붙인다. */
export function requestSummary(request: ReceivedRequest, now: Date = new Date()): string {
  const s = strings.family.summary;
  const f = strings.family;
  switch (request.category) {
    case 'care': {
      const base = s.care(request.item, f.timing[request.timing]);
      return isTomorrowDate(request.date, now) ? `${f.day.tomorrow} ${base}` : base;
    }
    case 'stop': {
      const deadline = request.deadline.type === 'today' ? f.deadline.today : f.deadline.by(request.deadline.time);
      const base = s.stop(request.place.text, request.item, deadline);
      return isTomorrowDate(request.date, now) ? `${f.day.tomorrow} ${base}` : base;
    }
    case 'appointment':
      return s.appointment(whenLabel(request.at, now), request.place.text, request.companions.length > 0 ? s.appointmentCompanions(request.companions.join(', ')) : '');
    case 'ride':
      return s.ride(whenLabel(request.at, now), request.who, request.pickup.text, request.dropoff.text);
  }
}

/** 목록 줄의 제목: 보낸 쪽은 '엄마에게 · 들르기', 받은 쪽은 '엄마가 보낸 · 들르기'. */
export function sentTitle(request: ReceivedRequest): string {
  const f = strings.family;
  const target = request.to.kind === 'member' ? f.to(request.to.name) : f.toCar;
  return f.toLine(target, f.category[request.category]);
}
export const receivedTitle = (request: ReceivedRequest): string => strings.family.toLine(strings.family.fromLabel(request.from.name), strings.family.category[request.category]);
