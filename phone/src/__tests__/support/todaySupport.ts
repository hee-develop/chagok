import type { CarConnectionSource } from '../../features/today/carConnection';
import type { PermissionMap, PermissionName, PermissionsSource, PermissionStatus } from '../../features/today/permissions';
import type { SchedulePlacesApi, SetupSchedule } from '../../features/fill-places/schedulePlacesApi';

/** 서울 2026-11-06 09:30. 서버가 '오늘'로 보는 기준 시각이다. */
export const ANCHOR = '2026-11-06T00:30:00Z';

const base: SetupSchedule = {
  id: 'x', title: 'x', start: '2026-11-06T04:00:00Z', end: '2026-11-06T05:00:00Z', place: null, locationText: null,
  noTravel: false, noTravelReason: null, care: null, suggestion: null, familyRequests: [],
};

/** 오늘 13:00, 장소 없음 */
export const LUNCH: SetupSchedule = { ...base, id: 'lunch', title: '육전집 점심' };
/** 오늘 18:00, 장소 있음 + 채비 */
export const GAME: SetupSchedule = {
  ...base, id: 'game', title: 'KIA 직관', start: '2026-11-06T09:00:00Z', end: '2026-11-06T12:00:00Z',
  place: { name: '챔피언스필드', lat: 35.1, lng: 126.8 }, care: '유니폼·응원봉',
  familyRequests: [{ memberId: 'mom', name: '엄마', status: 'delivered', sentAt: '2026-11-06T01:00:00Z' }] as SetupSchedule['familyRequests'],
};
/** 오늘 15:00, 온라인 회의라 저절로 이동 없음 */
export const ONLINE: SetupSchedule = { ...base, id: 'online', title: '주간 회의', start: '2026-11-06T06:00:00Z', end: '2026-11-06T07:00:00Z', noTravel: true, noTravelReason: 'online' };
/** 이틀 뒤 10:00, 장소 없음 + 기억한 장소 후보 */
export const DENTIST: SetupSchedule = {
  ...base, id: 'dentist', title: '치과', start: '2026-11-08T01:00:00Z', end: '2026-11-08T02:00:00Z', suggestion: { placeId: 'mock-dental', name: '예시치과의원' },
};

export const makeScheduleApi = (schedules: SetupSchedule[] = [LUNCH, ONLINE, GAME, DENTIST], overrides: Partial<SchedulePlacesApi> = {}) => ({
  fetchSchedules: jest.fn().mockResolvedValue({ anchor: ANCHOR, schedules }),
  savePlace: jest.fn().mockResolvedValue({ id: LUNCH.id, place: null, locationText: null, noTravel: true, noTravelReason: null }),
  saveCare: jest.fn().mockResolvedValue({ id: LUNCH.id, care: null }),
  ...overrides,
});

export const GRANTED: PermissionMap = { calendar: 'granted', camera: 'granted', notifications: 'granted' };

type PermissionsMock = { read: jest.Mock<Promise<PermissionMap>, []>; request: jest.Mock<Promise<PermissionStatus>, [PermissionName]>; openSettings: jest.Mock };

export const makePermissions = (map: Partial<PermissionMap> = {}, overrides: Partial<PermissionsSource> = {}): PermissionsMock & PermissionsSource => {
  let current: PermissionMap = { ...GRANTED, ...map };
  return {
    read: jest.fn(async () => current),
    request: jest.fn(async (name: PermissionName) => { current = { ...current, [name]: 'granted' as const }; return 'granted' as const; }),
    openSettings: jest.fn(),
    ...overrides,
  } as PermissionsMock & PermissionsSource;
};

/** 연결됨이면 자리 이름·연결 시각, 연결 안 됨이면 null, Error면 던진다(`GET /pair`의 200·401·오류). */
export const SEAT = { name: 'Pixel 9', pairedAt: '2026-11-06T00:30:00Z' } as const;
export const makeConnection = (connected: boolean | Error = true): CarConnectionSource & { status: jest.Mock } => ({
  status: jest.fn(async () => { if (connected instanceof Error) throw connected; return connected ? SEAT : null; }),
});
