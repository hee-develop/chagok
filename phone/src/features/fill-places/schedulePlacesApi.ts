import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import { appCorrectedPlaces, type CorrectedPlaces } from '../calendar-sync/correctedPlaces';
import type { PlaceSnapshot } from '../places/placesApi';
import { appSkipMemory, type SkipMemory } from '../skips/skipMemory';

export type SchedulePlaces = InferResponseType<typeof api.schedules.places.$get, 200>;
export type SetupSchedule = SchedulePlaces['schedules'][number];
export type SchedulePlaceChange = { placeId: string | null } | { place: PlaceSnapshot } | { noTravel: true };
export type SavedSchedulePlace = Pick<SetupSchedule, 'id' | 'place' | 'locationText' | 'noTravel' | 'noTravelReason'>;
export type SavedCare = InferResponseType<(typeof api.schedules)[':id']['care']['$put'], 200>;
export type SchedulePlacesApi = {
  fetchSchedules: (signal: AbortSignal) => Promise<SchedulePlaces>;
  savePlace: (id: string, change: SchedulePlaceChange, signal: AbortSignal) => Promise<SavedSchedulePlace>;
  /** 일정 하나의 채비 한 줄을 저장한다. null이면 지운다. 캘린더에는 쓰지 않는다. */
  saveCare: (id: string, care: string | null, signal: AbortSignal) => Promise<SavedCare>;
  /**
   * 3단계에서 방금 누른 '이동 없음'을 되돌린다: 일정별 보정을 지우고(`placeId: null`) 이름 기억도 되돌린다. 누르기 전부터 기억하던 이름(`keepName`)이면 기억은 그대로 둔다.
   * 일정별 되돌리기가 성공해야 기억을 건드린다.
   */
  undoNoTravel: (id: string, title: string, keepName: boolean, signal: AbortSignal) => Promise<SavedSchedulePlace>;
};

/**
 * 일정에 '이동 없음'을 고르면 그 일정만이 아니라 같은 이름(공백·대소문자 무시)의 일정이 다음부터 저절로 이동 없음이 되도록 이름을 기억한다(정책서 10.3 4번, `PUT /skips`).
 * 기억은 폰에 먼저 남고(오프라인이어도 잃지 않음) 서버에는 기다리지 않고 올린다(저장 응답이 늦어지지 않게). 올리지 못하면 다음 일정 동기화 때 다시 올린다.
 */
export const rememberNoTravelName = async (title: string, skips: Pick<SkipMemory, 'add' | 'sync'> = appSkipMemory) => {
  try {
    await skips.add(title);
    void skips.sync().catch(() => undefined);
  } catch {
    // 일정별 저장은 끝났다. 이름 기억은 폰에 남아 다음 동기화에서 다시 올린다.
  }
};

/**
 * 일정에 장소를 넣으면(보정) 같은 이름의 '이동 없음' 기억을 지운다: 가장 최근 선택이 이긴다. 기억이 남으면 폰이 다음 동기화에서 그 일정을 이름으로 거르고,
 * 서버는 일정과 함께 방금 넣은 보정을 잃는다. 이 일정의 제목은 이미 서버가 아는 일정이라 지우기를 올려도 새로 나가는 정보가 없다(거른 일정의 제목이 아니다).
 */
export const forgetNoTravelName = async (title: string, skips: Pick<SkipMemory, 'remove' | 'sync'> = appSkipMemory) => {
  try {
    await skips.remove(title);
    void skips.sync().catch(() => undefined);
  } catch {
    // 일정별 저장은 끝났다. 기억 지우기는 폰에 남아 다음 동기화에서 다시 올린다.
  }
};

/** 저장 응답의 보정 여부를 일정 동기화가 보는 목록에 반영한다. */
const recordCorrected = (saved: { id: string; corrected?: boolean }, corrected: Pick<CorrectedPlaces, 'set'> = appCorrectedPlaces) => {
  corrected.set(saved.id, saved.corrected === true);
};

export type SchedulePlacesDeps = {
  /** 서버 클라이언트(기본은 앱의 Hono RPC 클라이언트). */
  client?: Pick<typeof api, 'schedules'>;
  /** '이동 없음' 기억. */
  skips?: Pick<SkipMemory, 'add' | 'remove' | 'sync'>;
  /** 장소를 넣어 보정한 일정 id를 일정 동기화에 알린다. */
  corrected?: Pick<CorrectedPlaces, 'set' | 'replace'>;
};

export const createSchedulePlacesApi = ({ client = api, skips = appSkipMemory, corrected = appCorrectedPlaces }: SchedulePlacesDeps = {}): SchedulePlacesApi => ({
  fetchSchedules: async (signal) => {
    const res = await client.schedules.places.$get({ query: {} }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `GET /schedules/places ${res.status}`);
    const data = await res.json();
    // 장소를 넣어 보정한 일정은 이름 기억으로 거르지 않으므로, 일정 동기화가 알 수 있게 id를 남긴다.
    corrected.replace(data.schedules.filter((s) => s.corrected).map((s) => s.id));
    return data;
  },
  savePlace: async (id, change, signal) => {
    const res = await client.schedules[':id'].place.$put({ param: { id }, json: change }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `PUT /schedules/:id/place ${res.status}`);
    const saved = await res.json();
    recordCorrected(saved, corrected);
    // 저장 성공을 먼저 알리고 이름 기억은 뒤에서 올린다(기다리지 않는다. 올리지 못하면 다음 동기화가 올린다).
    if ('noTravel' in change) void rememberNoTravelName(saved.title, skips);
    // 장소를 넣는 모든 저장(목 장소 id·검색 결과 스냅숏 `{ place }`·'여기 맞아요')은 같은 이름의 기억을 지운다. 보정 지우기(`placeId: null`)는 지우지 않는다.
    else if ('place' in change || change.placeId !== null) void forgetNoTravelName(saved.title, skips);
    return saved;
  },
  undoNoTravel: async (id, title, keepName, signal) => {
    const res = await client.schedules[':id'].place.$put({ param: { id }, json: { placeId: null } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `PUT /schedules/:id/place ${res.status}`);
    const saved = await res.json();
    recordCorrected(saved, corrected);
    if (!keepName) void forgetNoTravelName(title, skips);
    // 서버는 이 응답을 만들 때 아직 이름을 기억하고 있어(기억 지우기는 뒤에서 올라간다) 보정을 지운 일정을 '이동 없음으로 기억'으로 내린다.
    // 이름 기억을 되돌리는 중이므로 줄은 다시 '장소 없음'으로 보인다(전부터 기억하던 이름이면 서버 응답 그대로).
    if (!keepName && saved.noTravelReason === 'skipped') return { ...saved, noTravel: false, noTravelReason: null };
    return saved;
  },
  saveCare: async (id, care, signal) => {
    const res = await client.schedules[':id'].care.$put({ param: { id }, json: { care } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `PUT /schedules/:id/care ${res.status}`);
    return res.json();
  },
});

export const schedulePlacesApi: SchedulePlacesApi = createSchedulePlacesApi();
