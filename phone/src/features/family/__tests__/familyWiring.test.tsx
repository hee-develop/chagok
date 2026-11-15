/**
 * 가족 API·구성원 비밀값·hono `hc`를 실제 서버 앱(진짜 라우트)에 묶은 통합 테스트(J1의 `clientWiring.test.ts`와 같은 방식).
 * 가족 만들기 → 참여 → 차 연결 → 요청 → 차가 상태를 바꿈 → 보낸 사람의 화면 모델(상태 문구)이 따라가는지, 가족 나가기·모르는 구성원·차 연결 끊기까지 본다.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// 서버 앱은 값으로 가져온다(타입만이 아니라 실제 라우트를 돌린다). 서버 코드의 .js 확장자 import는 jest 설정(moduleNameMapper)이 푼다.
import { createApp } from '../../../../../server/src/app';
import { createNotifications } from '../../../../../server/src/notify/notifier';
import { createSeatStore } from '../../../../../server/src/seats';
import { createSession, type DeviceStorage, type TokenStorage } from '../../../api/session';
import { makePermissions, makeScheduleApi } from '../../../__tests__/support/todaySupport';
import { createFamilyClient } from '../familyClient';
import { createFamilyGroupApi, type FamilyGroupApi } from '../familyGroupApi';
import { FamilyTabScreen } from '../FamilyTabScreen';
import { createMemberSession, type MemberSession, type MemberStorage } from '../memberSecret';
import { buildRequest, emptyForm } from '../requestForm';
import { senderStatusLabel } from '../requestModel';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ navigate: jest.fn(), push: jest.fn() }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

/** 서울 2026-11-06 09:30. 서버와 폰이 같은 시계를 본다. */
const NOW = new Date('2026-11-06T00:30:00Z');

const memoryToken = (initial: string | null = null): TokenStorage => {
  let value = initial;
  return { read: async () => value, write: async (t) => void (value = t), remove: async () => void (value = null) };
};
const memoryMember = (): MemberStorage & { value: () => string | null } => {
  let value: string | null = null;
  return { read: async () => value, write: async (t) => void (value = t), remove: async () => void (value = null), value: () => value };
};
const memoryDevice = (id: string): DeviceStorage => ({ read: async () => id, write: async () => undefined });

const setup = () => {
  const seats = createSeatStore(() => NOW);
  const notifications = createNotifications({ now: () => NOW });
  const app = createApp({
    fixture: { schedules: [] } as never,
    calendars: [],
    places: { places: [], suggestions: [], remembered: [] } as never,
    familyMembers: [],
    seats,
    notifications,
    now: () => NOW,
  });
  const postJson = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
    (await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })).json() as Promise<any>;
  const carCall = async (method: string, path: string, car: { carToken: string; seatId: string }, body?: unknown) =>
    app.request(`${path}${path.includes('?') ? '&' : '?'}driver=${car.seatId}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${car.carToken}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  /** 폰 한 대: 자기 구성원 비밀값 저장소·폰 토큰 저장소·가족 API. */
  const phone = (name: string) => {
    // 기기 id 헤더는 ASCII여야 한다(이름은 한글이라 따로 만든다).
    const deviceId = `device-${name.length}-${Math.random().toString(36).slice(2)}`.padEnd(32, 'x');
    const memberStorage = memoryMember();
    const member: MemberSession = createMemberSession(memberStorage);
    const session = createSession(memoryToken(), memoryDevice(deviceId));
    const client = createFamilyClient({ url: 'http://server.test', member, phone: session, fetch: async (input, init) => app.request(input as string, init) });
    const api: FamilyGroupApi = createFamilyGroupApi({ client, member, phone: session });
    return { name, deviceId, member, memberStorage, session, api };
  };
  /** 이 폰을 새 차(또는 주어진 차)에 연결한다(차 화면의 6자리 코드를 폰이 입력하는 것과 같다). */
  const connect = async (p: ReturnType<typeof phone>, carToken: string | null = null) => {
    const car = carToken ? { carToken } : await postJson('/pair/code', {});
    const issued = await postJson('/pair/code', {}, { authorization: `Bearer ${car.carToken}` });
    const claimed = await postJson('/pair/claim', { code: issued.code, name: p.name }, { 'x-chagok-device': p.deviceId });
    await p.session.setToken(claimed.phoneToken);
    return { carToken: car.carToken as string, seatId: claimed.seatId as string };
  };
  return { app, seats, postJson, carCall, phone, connect };
};

const signal = new AbortController().signal;
const stopForm = (recipientMemberId: string) => {
  const built = buildRequest({ ...emptyForm(), category: 'stop', recipient: { kind: 'member', memberId: recipientMemberId }, place: { text: '다이소 상무점', lat: 35.15, lng: 126.85 }, item: '건전지', memo: '현관 앞에 두기' }, NOW);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.body;
};

describe('가족 만들기 → 참여 → 요청 → 상태 변화(실제 서버 앱)', () => {
  it('만들기·참여가 구성원 비밀값을 저장하고, 가족 목록에 서로가 보인다', async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    expect(await dad.api.fetchFamily(signal)).toBeNull();
    expect(dad.memberStorage.value()).toBeNull();

    const created = await dad.api.invite('아빠', signal);
    expect(created.members.map((m) => m.name)).toEqual(['아빠']);
    expect(created.invite?.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(dad.memberStorage.value()).toMatch(/^[0-9a-f]{64}$/);

    const joined = await mom.api.join(created.invite!.code.toLowerCase(), '엄마', signal);
    expect(joined.members.map((m) => [m.name, m.isMe])).toEqual([['아빠', false], ['엄마', true]]);
    expect(mom.memberStorage.value()).toMatch(/^[0-9a-f]{64}$/);
    expect(mom.memberStorage.value()).not.toBe(dad.memberStorage.value());

    // 두 폰 모두 다음 호출에서 같은 가족을 본다(비밀값이 헤더로 간다)
    expect((await dad.api.fetchFamily(signal))!.members.map((m) => m.name)).toEqual(['아빠', '엄마']);
    expect((await mom.api.fetchFamily(signal))!.me.name).toBe('엄마');
  });

  it('요청의 상태가 바뀔 때마다 보낸 사람의 상태 문구가 따라간다(채비는 수락 없음, 들르기는 수락 → 들렀어요)', async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    const family = await dad.api.invite('아빠', signal);
    const momView = await mom.api.join(family.invite!.code, '엄마', signal);
    const momId = momView.me.memberId;
    const label = async () => {
      const { sent } = await dad.api.fetchRequests(signal);
      expect(sent).toHaveLength(1);
      return senderStatusLabel(sent[0]!);
    };

    // 엄마 폰이 차에 연결되지 않았으면 폰 앱에서만 보인다
    const created = await dad.api.createRequest(stopForm(momId), signal);
    expect(created).toMatchObject({ category: 'stop', status: 'sent', memo: '현관 앞에 두기', place: { text: '다이소 상무점', lat: 35.15, lng: 126.85 }, reachable: false });
    expect(await label()).toBe('폰 앱에서만 볼 수 있어요');
    // 받는 사람 폰에는 같은 요청이 받은 요청으로 보인다
    const received = (await mom.api.fetchRequests(signal)).received;
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: created.id, from: { name: '아빠' }, status: 'sent' });

    // 엄마가 차에 연결하고 (비밀값 + 폰 토큰이 같이 가는) 첫 가족 호출로 자리가 구성원에 묶인다 → 차에 타면 전해요
    const car = await s.connect(mom);
    expect((await mom.api.fetchFamily(signal))!.members.find((m) => m.isMe)).toMatchObject({ connected: true });
    expect(await label()).toBe('차에 타면 전해요');

    const patch = async (status: string) => {
      const res = await s.carCall('PATCH', `/requests/${created.id}`, car, { status });
      expect(res.status).toBe(200);
    };
    await patch('delivered');
    expect(await label()).toBe('전달했어요');
    await patch('accepted');
    expect(await label()).toBe('수락했어요');
    await patch('completed');
    expect(await label()).toBe('들렀어요');
  });

  it("'우리 차'는 가족 폰이 연결된 뒤에야 고를 수 있고, 거절은 '이번엔 어려워요'", async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    const family = await dad.api.invite('아빠', signal);
    await mom.api.join(family.invite!.code, '엄마', signal);
    expect((await dad.api.fetchFamily(signal))!.cars).toEqual([]);

    const car = await s.connect(mom);
    await mom.api.fetchFamily(signal); // 연결 뒤 첫 가족 호출이 자리를 묶는다
    const cars = (await dad.api.fetchFamily(signal))!.cars;
    expect(cars).toHaveLength(1);
    expect(cars[0]!.memberIds).toHaveLength(1);

    const built = buildRequest({ ...emptyForm(), category: 'ride', recipient: { kind: 'car', carRef: cars[0]!.carRef }, who: '지우', pickup: { text: '학원' }, dropoff: { text: '집' }, time: '1830' }, NOW);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const created = await dad.api.createRequest(built.body, signal);
    expect(created.to).toEqual({ kind: 'car', carRef: cars[0]!.carRef });
    // 엄마(그 차에 연결된 가족)는 우리 차로 온 요청을 받은 요청에서 본다
    expect((await mom.api.fetchRequests(signal)).received.map((r) => r.id)).toEqual([created.id]);

    await s.carCall('PATCH', `/requests/${created.id}`, car, { status: 'delivered' });
    await s.carCall('PATCH', `/requests/${created.id}`, car, { status: 'declined' });
    const { sent } = await dad.api.fetchRequests(signal);
    expect(senderStatusLabel(sent[0]!)).toBe('이번엔 어려워요');
  });

  it('도착 예정 공유를 켜면 운전 중·5분 전·도착이 보낸 사람 문구에 나타나고, 끄면 가려진다', async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    const family = await dad.api.invite('아빠', signal);
    const momView = await mom.api.join(family.invite!.code, '엄마', signal);
    const dadId = family.me.memberId;
    const car = await s.connect(mom);
    await mom.api.fetchFamily(signal);
    // 보낸 사람(아빠)도 자기 차에 연결해 알림함이 있다(연결하지 않은 보낸 사람은 알림 없이 목록으로만 본다)
    await s.connect(dad);
    await dad.api.fetchFamily(signal);

    const built = buildRequest({ ...emptyForm(), category: 'ride', recipient: { kind: 'member', memberId: momView.me.memberId }, who: '지우', pickup: { text: '학원' }, dropoff: { text: '집' }, time: '1830' }, NOW);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const created = await dad.api.createRequest(built.body, signal);
    const label = async () => senderStatusLabel((await dad.api.fetchRequests(signal)).sent[0]!);

    // 공유가 꺼져 있으면 주행 중이어도 새지 않는다
    await s.carCall('POST', '/drive-state', car, { driving: true });
    expect(await label()).toBe('차에 타면 전해요');

    // 엄마가 아빠에게 켠다(엄마가 받는 사람이라 엄마가 켠다)
    await mom.api.setShare(dadId, true, signal);
    expect((await mom.api.fetchFamily(signal))!.members.find((m) => m.memberId === dadId)).toMatchObject({ shareWithThem: true });
    expect((await dad.api.fetchFamily(signal))!.members.find((m) => !m.isMe)).toMatchObject({ sharesWithMe: true });
    expect(await label()).toBe('운전 중이라 다음 정차 때 전해요');

    await s.carCall('POST', '/drive-state', car, { driving: false });
    await s.carCall('PATCH', `/requests/${created.id}`, car, { status: 'delivered' });
    await s.carCall('PATCH', `/requests/${created.id}`, car, { status: 'accepted' });
    expect(await label()).toBe('수락했어요');
    const eta = await s.carCall('POST', `/requests/${created.id}/eta`, car, { stage: 'soon', etaAt: '2026-11-06T09:25:00+09:00' });
    expect((await eta.json()) as { notified: boolean }).toEqual({ notified: true });
    expect(await label()).toBe('곧 도착해요');
    // 보낸 사람 알림함의 family-status 알림이 가족 탭의 그 요청을 가리킨다(알림 누름이 여는 requestId)
    const inbox = await s.app.request('/notifications', { headers: { authorization: `Bearer ${await dad.session.getToken()}` } });
    const notes = ((await inbox.json()) as { notifications: { kind: string; data: Record<string, string> }[] }).notifications;
    expect(notes.filter((n) => n.kind === 'family-status').map((n) => n.data)).toContainEqual(expect.objectContaining({ requestId: created.id, stage: 'soon' }));

    await mom.api.setShare(dadId, false, signal);
    expect(await label()).toBe('수락했어요');
  });

  it('가족에서 나가면 그 사람의 요청과 비밀값이 지워지고, 모르는 비밀값은 가족이 없는 상태로 돌아간다', async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    const family = await dad.api.invite('아빠', signal);
    const momView = await mom.api.join(family.invite!.code, '엄마', signal);
    await dad.api.createRequest(stopForm(momView.me.memberId), signal);
    expect((await dad.api.fetchRequests(signal)).sent).toHaveLength(1);

    const momSecret = mom.memberStorage.value()!;
    await mom.api.leave(signal);
    expect(mom.memberStorage.value()).toBeNull();
    expect(await mom.api.fetchFamily(signal)).toBeNull();
    expect((await dad.api.fetchRequests(signal)).sent).toHaveLength(0);
    expect((await dad.api.fetchFamily(signal))!.members.map((m) => m.name)).toEqual(['아빠']);

    // 옛 비밀값이 남아 있는 폰(다른 곳에서 나간 경우)은 401 unknown-member로 알게 되고 비밀값을 버린다
    await mom.member.set(momSecret);
    expect(await mom.api.fetchFamily(signal)).toBeNull();
    expect(await mom.member.get()).toBeNull();
  });

  it('차 연결을 끊어도 구성원 비밀값은 그대로이고 가족을 계속 쓴다(죽은 폰 토큰은 요청 층이 버리고 다시 보낸다)', async () => {
    const s = setup();
    const mom = s.phone('엄마폰');
    const dad = s.phone('아빠폰');
    const family = await dad.api.invite('아빠', signal);
    await mom.api.join(family.invite!.code, '엄마', signal);
    await s.connect(mom);
    expect((await mom.api.fetchFamily(signal))!.members.find((m) => m.isMe)).toMatchObject({ connected: true });
    const secret = mom.memberStorage.value();

    // 폰의 '연결 끊기'(DELETE /pair)는 pairingApi가 하지만, 여기서는 서버에 직접 부르고 폰 토큰만 남겨 둔다(앱이 모르는 사이 끊긴 경우)
    const token = (await mom.session.getToken())!;
    const res = await s.app.request('/pair', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);

    const family2 = await mom.api.fetchFamily(signal);
    expect(family2!.me.name).toBe('엄마');
    expect(family2!.members.find((m) => m.isMe)).toMatchObject({ connected: false });
    expect(await mom.session.getToken()).toBeNull(); // 죽은 폰 토큰은 버렸다
    expect(mom.memberStorage.value()).toBe(secret); // 비밀값은 그대로
  });

  it('한 번 더 참여하려 하면(이미 가족) 409이고, 틀린 코드는 404 invalid로 이유가 전해진다', async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    const family = await dad.api.invite('아빠', signal);
    await expect(mom.api.join('ZZZZ-ZZZZ', undefined, signal)).rejects.toMatchObject({ status: 404, reason: 'invalid' });
    expect(mom.memberStorage.value()).toBeNull();
    await mom.api.join(family.invite!.code, '엄마', signal);
    await expect(mom.api.join(family.invite!.code, '엄마', signal)).rejects.toMatchObject({ status: 409, reason: 'already-in-family' });
  });

  it('4종 요청(채비·들르기·약속 가기·데려다주기·픽업)을 가족 한 사람과 우리 차에 보내면 모두 실제 서버에서 성공하고 항목이 그대로 돌아온다', async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    const family = await dad.api.invite('아빠', signal);
    const momView = await mom.api.join(family.invite!.code, '엄마', signal);
    await s.connect(mom);
    await mom.api.fetchFamily(signal);
    const carRef = (await dad.api.fetchFamily(signal))!.cars[0]!.carRef;
    const toMom = { kind: 'member', memberId: momView.me.memberId } as const;
    const toCar = { kind: 'car', carRef } as const;
    const send = async (form: Partial<Parameters<typeof buildRequest>[0]>) => {
      const built = buildRequest({ ...emptyForm(), ...form }, NOW);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      return dad.api.createRequest(built.body, signal);
    };

    const care = await send({ category: 'care', recipient: toMom, item: '우산', timing: 'bring-back', day: 'tomorrow', memo: '현관 앞에 두기' });
    expect(care).toMatchObject({ category: 'care', item: '우산', timing: 'bring-back', date: '2026-11-07', memo: '현관 앞에 두기', status: 'sent', reachable: true });
    const stop = await send({ category: 'stop', recipient: toCar, place: { text: '다이소 상무점', lat: 35.15, lng: 126.85 }, item: '건전지', deadlineType: 'by', time: '1830' });
    expect(stop).toMatchObject({ category: 'stop', place: { text: '다이소 상무점', lat: 35.15, lng: 126.85 }, item: '건전지', deadline: { type: 'by', time: '18:30' }, to: { kind: 'car', carRef } });
    const appointment = await send({ category: 'appointment', recipient: toMom, time: '1800', place: { text: '챔피언스필드' }, companions: '지우, 하준' });
    expect(appointment).toMatchObject({ category: 'appointment', at: '2026-11-06T09:00:00.000Z', place: { text: '챔피언스필드' }, companions: ['지우', '하준'] });
    const ride = await send({ category: 'ride', recipient: toCar, who: '지우', pickup: { text: '학원', lat: 35.1, lng: 126.8 }, dropoff: { text: '집' }, time: '1830' });
    expect(ride).toMatchObject({ category: 'ride', who: '지우', pickup: { text: '학원', lat: 35.1, lng: 126.8 }, dropoff: { text: '집' }, at: '2026-11-06T09:30:00.000Z' });

    // 보낸 사람 목록: 4개 모두 '차에 타면 전해요', 받은 사람(엄마)은 사람으로 받은 것과 우리 차로 받은 것을 모두 본다
    const lists = await dad.api.fetchRequests(signal);
    expect(lists.sent.map((r) => r.category).sort()).toEqual(['appointment', 'care', 'ride', 'stop']);
    expect(lists.sent.map(senderStatusLabel)).toEqual(['차에 타면 전해요', '차에 타면 전해요', '차에 타면 전해요', '차에 타면 전해요']);
    expect((await mom.api.fetchRequests(signal)).received.map((r) => r.category).sort()).toEqual(['appointment', 'care', 'ride', 'stop']);
  });

  it('서버가 거절하는 요청(지난 시각)은 폰이 먼저 막지만, 서버도 400 bad-request로 거절한다', async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    const family = await dad.api.invite('아빠', signal);
    const momView = await mom.api.join(family.invite!.code, '엄마', signal);
    const past = { category: 'appointment', recipient: { memberId: momView.me.memberId }, at: '2026-11-06T08:00:00+09:00', place: { text: '병원' } } as const;
    await expect(dad.api.createRequest(past, signal)).rejects.toMatchObject({ status: 400, reason: 'bad-request' });
    const built = buildRequest({ ...emptyForm(), category: 'appointment', recipient: { kind: 'member', memberId: momView.me.memberId }, time: '0800', place: { text: '병원' } }, NOW);
    expect(built.ok).toBe(false);
  });
});

describe('가족 탭 화면 + 실제 서버 앱: 상태가 바뀌면 화면 문구가 따라간다', () => {
  const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

  it('보낸 사람 화면이 폴링으로 보냄 → 전달 → 수락 → 완료 문구로 바뀌고, 받는 사람 화면은 받은 요청으로 본다', async () => {
    const s = setup();
    const dad = s.phone('아빠폰');
    const mom = s.phone('엄마폰');
    const family = await dad.api.invite('아빠', signal);
    const momView = await mom.api.join(family.invite!.code, '엄마', signal);
    const car = await s.connect(mom);
    await mom.api.fetchFamily(signal);
    const created = await dad.api.createRequest(stopForm(momView.me.memberId), signal);

    const renderTab = (api: FamilyGroupApi) => render(
      <SafeAreaProvider initialMetrics={insets}>
        <FamilyTabScreen scheduleApi={makeScheduleApi()} permissionsSource={makePermissions()} familyApi={api} now={() => NOW} pollMs={30} shareText={jest.fn()} />
      </SafeAreaProvider>,
    );
    (AppState as unknown as { currentState: string }).currentState = 'active';

    const dadScreen = await renderTab(dad.api);
    const sent = within(await screen.findByTestId('family-sent-requests'));
    expect(await sent.findByText('엄마에게 · 들르기')).toBeOnTheScreen();
    expect(sent.getByText('다이소 상무점 · 건전지 · 오늘 중')).toBeOnTheScreen();
    expect(sent.getByTestId(`family-request-status-${created.id}`)).toHaveTextContent('차에 타면 전해요');

    for (const [status, expected] of [['delivered', '전달했어요'], ['accepted', '수락했어요'], ['completed', '들렀어요']] as const) {
      await act(async () => { await s.carCall('PATCH', `/requests/${created.id}`, car, { status }); });
      await waitFor(() => expect(screen.getByTestId(`family-request-status-${created.id}`)).toHaveTextContent(expected));
    }
    await dadScreen.unmount();

    const momScreen = await renderTab(mom.api);
    const received = within(await screen.findByTestId('family-received-requests'));
    expect(await received.findByText('보낸 사람 아빠 · 들르기')).toBeOnTheScreen();
    expect(received.getByTestId(`family-request-status-${created.id}`)).toHaveTextContent('끝났어요');
    await momScreen.unmount();
    (AppState as unknown as { currentState: string | undefined }).currentState = undefined;
  });
});
