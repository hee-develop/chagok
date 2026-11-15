import type { FamilyGroupApi, FamilyMemberView, FamilyView, RequestLists } from '../../features/family/familyGroupApi';
import type { ReceivedRequest, SentRequest } from '../../features/family/requestModel';

/** 서울 2026-11-06 09:30. 가족 화면 테스트가 '지금'으로 쓰는 시각(오늘 탭 테스트의 `ANCHOR`와 같다). */
export const NOW = new Date('2026-11-06T00:30:00Z');

export const ME: FamilyMemberView = { memberId: 'me1', name: '아빠', isMe: true, connected: false, shareWithThem: false, sharesWithMe: false };
export const MOM: FamilyMemberView = { memberId: 'mom1', name: '엄마', isMe: false, connected: true, shareWithThem: false, sharesWithMe: true };
export const KID: FamilyMemberView = { memberId: 'kid1', name: '지우', isMe: false, connected: false, shareWithThem: true, sharesWithMe: false };

/** 나·엄마(차 연결됨)·지우(차 연결 안 됨), 초대 코드 하나, 엄마가 연결된 차 하나가 있는 가족. */
export const FAMILY: FamilyView = {
  familyId: 'fam1',
  createdAt: '2026-11-06T00:00:00.000Z',
  maxMembers: 6,
  invite: { code: 'ABCD-EFGH', expiresAt: '2026-11-07T00:00:00.000Z' },
  me: { memberId: 'me1', name: '아빠' },
  members: [ME, MOM, KID],
  cars: [{ carRef: 'car-1', memberIds: ['mom1'] }],
};

export const withFamily = (change: Partial<FamilyView>): FamilyView => ({ ...FAMILY, ...change });

const common = {
  memo: null,
  date: '2026-11-06',
  status: 'sent' as const,
  createdAt: '2026-11-06T00:10:00.000Z',
  from: { memberId: 'me1', name: '아빠' },
  to: { kind: 'member' as const, memberId: 'mom1', name: '엄마' },
  reachable: true,
  drivingNow: false,
  etaStage: null,
};

/** 보낸 요청 샘플(엄마에게 보낸 요청, 보냄 상태). */
export const sentCare = (change: Partial<SentRequest> = {}): SentRequest => ({ ...common, id: 'r-care', category: 'care', item: '우산', timing: 'take-along', ...change }) as SentRequest;
export const sentStop = (change: Partial<SentRequest> = {}): SentRequest => ({ ...common, id: 'r-stop', category: 'stop', place: { text: '다이소 상무점', lat: 35.15, lng: 126.85 }, item: '건전지', deadline: { type: 'today' }, ...change }) as SentRequest;
export const sentAppointment = (change: Partial<SentRequest> = {}): SentRequest => ({ ...common, id: 'r-appt', category: 'appointment', at: '2026-11-06T09:00:00.000Z', place: { text: '챔피언스필드' }, companions: ['지우'], ...change }) as SentRequest;
export const sentRide = (change: Partial<SentRequest> = {}): SentRequest => ({ ...common, id: 'r-ride', category: 'ride', who: '지우', pickup: { text: '학원' }, dropoff: { text: '집' }, at: '2026-11-06T09:30:00.000Z', ...change }) as SentRequest;

/** 받은 요청 샘플(엄마가 보낸 약속 가기). */
export const receivedAppointment = (change: Partial<ReceivedRequest> = {}): ReceivedRequest => ({
  id: 'in-appt', category: 'appointment', at: '2026-11-06T08:00:00.000Z', place: { text: '치과' }, companions: [], memo: null, date: '2026-11-06', status: 'sent', createdAt: '2026-11-06T00:05:00.000Z',
  from: { memberId: 'mom1', name: '엄마' }, to: { kind: 'member', memberId: 'me1', name: '아빠' }, reachable: false, ...change,
}) as ReceivedRequest;
export const receivedCare = (change: Partial<ReceivedRequest> = {}): ReceivedRequest => ({
  id: 'in-care', category: 'care', item: '도시락', timing: 'bring-back', memo: null, date: '2026-11-06', status: 'delivered', createdAt: '2026-11-06T00:06:00.000Z',
  from: { memberId: 'mom1', name: '엄마' }, to: { kind: 'member', memberId: 'me1', name: '아빠' }, reachable: true, ...change,
}) as ReceivedRequest;

export type FamilyApiMock = { [K in keyof FamilyGroupApi]: jest.Mock };

/**
 * 가족 묶기·요청 API 가짜. 기본은 가족이 있고(`FAMILY`) 요청 목록이 비어 있으며, 호출별 동작은 overrides로 바꾼다.
 * 모든 호출은 jest.fn이라 인자(signal 포함)를 볼 수 있다.
 */
export function makeFamilyApi(overrides: Partial<FamilyGroupApi> = {}): FamilyApiMock {
  const lists: RequestLists = { sent: [], received: [] };
  return {
    fetchFamily: jest.fn().mockResolvedValue(FAMILY),
    invite: jest.fn().mockResolvedValue(FAMILY),
    join: jest.fn().mockResolvedValue(FAMILY),
    rename: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    setShare: jest.fn().mockResolvedValue(undefined),
    fetchRequests: jest.fn().mockResolvedValue(lists),
    createRequest: jest.fn().mockResolvedValue(sentCare({ id: 'new-1' })),
    ...overrides,
  } as FamilyApiMock;
}
