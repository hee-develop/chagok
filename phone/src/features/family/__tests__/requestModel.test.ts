import { NOW, receivedAppointment, receivedCare, sentAppointment, sentCare, sentRide, sentStop } from '../../../__tests__/support/familySupport';
import { normalizeRequest, normalizeRequests, receivedStatusLabel, receivedTitle, requestSummary, senderStatusLabel, sentTitle, type RequestCategory, type RequestStatus } from '../requestModel';

type Flags = { drivingNow?: boolean; reachable?: boolean; etaStage?: 'soon' | null };

describe('보낸 사람 폰 상태 문구(정책서 10.10 표)', () => {
  // [카테고리, 상태, 조건, 문구]
  const CASES: [RequestCategory, RequestStatus, Flags, string][] = [
    // 보냄: 받는 사람이 공유를 켜고 운전 중이면 '운전 중이라…', 폰이 차에 연결되지 않았으면 '폰 앱에서만', 그 밖에는 '차에 타면 전해요'
    ['care', 'sent', {}, '차에 타면 전해요'],
    ['stop', 'sent', {}, '차에 타면 전해요'],
    ['appointment', 'sent', {}, '차에 타면 전해요'],
    ['ride', 'sent', {}, '차에 타면 전해요'],
    ['appointment', 'sent', { drivingNow: true }, '운전 중이라 다음 정차 때 전해요'],
    ['ride', 'sent', { drivingNow: true }, '운전 중이라 다음 정차 때 전해요'],
    ['care', 'sent', { reachable: false }, '폰 앱에서만 볼 수 있어요'],
    ['stop', 'sent', { reachable: false }, '폰 앱에서만 볼 수 있어요'],
    ['appointment', 'sent', { reachable: false }, '폰 앱에서만 볼 수 있어요'],
    ['ride', 'sent', { reachable: false }, '폰 앱에서만 볼 수 있어요'],
    // 전달
    ['care', 'delivered', {}, '전달했어요'],
    ['stop', 'delivered', {}, '전달했어요'],
    ['appointment', 'delivered', {}, '전달했어요'],
    ['ride', 'delivered', {}, '전달했어요'],
    // 수락(채비는 수락이 없다)
    ['stop', 'accepted', {}, '수락했어요'],
    ['appointment', 'accepted', {}, '출발했어요'],
    ['ride', 'accepted', {}, '수락했어요'],
    // 도착 5분 전(도착 예정 공유를 켠 약속·픽업, 전달·수락 상태에서만)
    ['ride', 'accepted', { etaStage: 'soon' }, '곧 도착해요'],
    ['ride', 'delivered', { etaStage: 'soon' }, '곧 도착해요'],
    ['appointment', 'accepted', { etaStage: 'soon' }, '곧 도착해요'],
    ['appointment', 'delivered', { etaStage: 'soon' }, '곧 도착해요'],
    ['stop', 'accepted', { etaStage: 'soon' }, '수락했어요'],
    ['ride', 'sent', { etaStage: 'soon' }, '차에 타면 전해요'],
    ['ride', 'completed', { etaStage: 'soon' }, '도착했어요'],
    // 거절은 '이번엔 어려워요'만(이유·답장 없음)
    ['stop', 'declined', {}, '이번엔 어려워요'],
    ['appointment', 'declined', {}, '이번엔 어려워요'],
    ['ride', 'declined', {}, '이번엔 어려워요'],
    // 완료
    ['care', 'completed', {}, '챙기라고 전했어요'],
    ['stop', 'completed', {}, '들렀어요'],
    ['appointment', 'completed', {}, '도착했어요'],
    ['ride', 'completed', {}, '도착했어요'],
  ];

  it.each(CASES)('%s · %s %j → %s', (category, status, flags, expected) => {
    const base = { category, status, reachable: true, drivingNow: false, etaStage: null as 'soon' | null };
    expect(senderStatusLabel({ ...base, ...flags })).toBe(expected);
  });

  it('운전 중 문구는 받는 사람 폰이 연결되지 않은 경우보다 앞선다(연결이 없으면 서버가 drivingNow를 늘 false로 준다)', () => {
    expect(senderStatusLabel({ category: 'ride', status: 'sent', reachable: false, drivingNow: true, etaStage: null })).toBe('운전 중이라 다음 정차 때 전해요');
  });
});

describe('받는 사람 폰 상태 문구', () => {
  it.each([
    ['sent', true, '차에 타면 전해 드려요'],
    ['sent', false, '차에 연결하면 전해 드려요'],
    ['delivered', true, '차에서 전했어요'],
    ['accepted', true, '수락했어요'],
    ['declined', true, '거절했어요'],
    ['completed', true, '끝났어요'],
  ] as const)('%s reachable=%s → %s', (status, reachable, expected) => {
    expect(receivedStatusLabel({ status, reachable })).toBe(expected);
  });
});

describe('요청 한 줄 요약', () => {
  it('채비: 물건 · 가져갈 때/가져올 때', () => {
    expect(requestSummary(sentCare(), NOW)).toBe('우산 · 가져갈 때');
    expect(requestSummary(receivedCare(), NOW)).toBe('도시락 · 가져올 때');
  });

  it('들르기: 장소 · 물건 · 기한(오늘 중 / 시각까지)', () => {
    expect(requestSummary(sentStop(), NOW)).toBe('다이소 상무점 · 건전지 · 오늘 중');
    expect(requestSummary(sentStop({ deadline: { type: 'by', time: '18:30' } } as never), NOW)).toBe('다이소 상무점 · 건전지 · 18:30까지');
  });

  it('약속 가기: 서울 시각 + 장소 + 함께 가는 사람, 내일이면 날짜를 앞세운다', () => {
    // 2026-11-06T09:00Z = 서울 18:00
    expect(requestSummary(sentAppointment(), NOW)).toBe('18:00 챔피언스필드 · 함께 지우');
    expect(requestSummary(sentAppointment({ at: '2026-11-07T01:00:00.000Z', companions: [] } as never), NOW)).toBe('내일 10:00 챔피언스필드');
  });

  it('데려다주기·픽업: 시각 + 누구 + 어디서 → 어디로', () => {
    expect(requestSummary(sentRide(), NOW)).toBe('18:30 지우 · 학원 → 집');
  });

  it('채비·들르기가 내일 날짜면 내일을 앞세운다', () => {
    expect(requestSummary(sentCare({ date: '2026-11-07' }), NOW)).toBe('내일 우산 · 가져갈 때');
  });
});

describe('목록 줄 제목', () => {
  it('보낸 쪽: 받는 사람(사람 또는 우리 차) · 카테고리', () => {
    expect(sentTitle(sentStop())).toBe('엄마에게 · 들르기');
    expect(sentTitle(sentCare({ to: { kind: 'car', carRef: 'car-1' } }))).toBe('우리 차에 · 채비');
  });

  it('받은 쪽: 보낸 사람 · 카테고리', () => {
    expect(receivedTitle(receivedAppointment())).toBe('보낸 사람 엄마 · 약속 가기');
  });
});

describe('서버 응답 정리(normalizeRequest)', () => {
  const raw = (extra: Record<string, unknown>) => ({
    id: 'x', memo: null, date: '2026-11-06', status: 'sent', createdAt: '2026-11-06T00:00:00Z', from: { memberId: 'a', name: '아빠' },
    to: { kind: 'member', memberId: 'b', name: '엄마' }, reachable: true, drivingNow: false, etaStage: null, ...extra,
  });

  it('카테고리별 항목을 읽고 좌표가 둘 다 있을 때만 좌표를 남긴다', () => {
    const stop = normalizeRequest(raw({ category: 'stop', item: '우유', place: { text: '마트', lat: 1, lng: 2 }, deadline: { type: 'by', time: '19:00' } }));
    expect(stop).toMatchObject({ category: 'stop', place: { text: '마트', lat: 1, lng: 2 }, deadline: { type: 'by', time: '19:00' } });
    const textOnly = normalizeRequest(raw({ category: 'stop', item: '우유', place: { text: '마트', lat: 1 }, deadline: { type: 'today' } }));
    expect(textOnly).toMatchObject({ place: { text: '마트' } });
    expect((textOnly as { place: object }).place).not.toHaveProperty('lat');
  });

  it("'우리 차'로 보낸 요청과 받은 요청(drivingNow·etaStage 없음)을 읽는다", () => {
    expect(normalizeRequest(raw({ category: 'care', item: '우산', timing: 'bring-back', to: { kind: 'car', carRef: 'car-9' } }))).toMatchObject({ to: { kind: 'car', carRef: 'car-9' } });
    const received = { ...raw({ category: 'care', item: '우산', timing: 'bring-back' }) } as Record<string, unknown>;
    delete received.drivingNow;
    delete received.etaStage;
    expect(normalizeRequest(received)).toMatchObject({ drivingNow: false, etaStage: null });
  });

  it('모르는 카테고리·상태나 모자란 항목은 버려 화면이 깨지지 않는다', () => {
    expect(normalizeRequest(raw({ category: 'party' }))).toBeNull();
    expect(normalizeRequest(raw({ category: 'care', item: '우산', timing: 'bring-back', status: 'weird' }))).toBeNull();
    expect(normalizeRequest(raw({ category: 'care', timing: 'bring-back' }))).toBeNull();
    expect(normalizeRequest(raw({ category: 'ride', who: '지우', pickup: { text: '학원' }, at: '2026-11-06T09:00:00Z' }))).toBeNull();
    expect(normalizeRequest(null)).toBeNull();
    expect(normalizeRequests([raw({ category: 'care', item: '우산', timing: 'take-along' }), { broken: true }, 7])).toHaveLength(1);
    expect(normalizeRequests('nope')).toEqual([]);
  });
});
