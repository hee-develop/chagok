import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  EVENTS_STALE_AFTER_MS,
  EVENTS_STALE_BODY,
  EVENTS_STALE_TITLE,
  EVENTS_STALE_WINDOW_MS,
  inEventsStaleWindow,
  runEventsStaleCheck,
} from '../src/notify/eventsStale.js';
import {
  buildFcmRequest,
  createFcmSender,
  createPushTokenRegistry,
  createServiceAccountTokenProvider,
  FCM_ANDROID_CHANNEL_ID,
  loadFcmConfigFromEnv,
} from '../src/notify/fcm.js';
import { createNotifications } from '../src/notify/notifier.js';
import { createNotificationRuntime } from '../src/notify/setup.js';
import type { AppNotification } from '../src/notify/types.js';
import { createScheduler } from '../src/scheduler.js';
import { createSeatStore } from '../src/seats.js';
import { newApp } from './helpers.js';

const seoul = (s: string) => Date.parse(`${s}+09:00`);
let clockMs = seoul('2026-11-11T09:00:00');
const now = () => new Date(clockMs);
const at = (s: string) => {
  clockMs = seoul(s);
};

/** 자리 하나를 연결해 둔 앱(서울 2026-11-11 09:00). 일정은 PUT /events로 보낸다. */
const setup = async () => {
  at('2026-11-11T09:00:00');
  const seats = createSeatStore(now);
  const notifications = createNotifications({ now });
  const app = newApp({ now, seats, notifications });
  const json = async (res: Response) => (await res.json()) as any;
  const code = await json(await app.request('/pair/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  const issued = await json(await app.request('/pair/code', { method: 'POST', headers: { authorization: `Bearer ${code.carToken}`, 'content-type': 'application/json' }, body: '{}' }));
  const claimed = await json(await app.request('/pair/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: issued.code, name: '폰' }) }));
  const connectAnother = async (name: string) => {
    const again = await json(await app.request('/pair/code', { method: 'POST', headers: { authorization: `Bearer ${code.carToken}`, 'content-type': 'application/json' }, body: '{}' }));
    return json(await app.request('/pair/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: again.code, name }) }));
  };
  const check = () => runEventsStaleCheck({ seats, notifier: notifications.notifier, now: now() });
  const sendEvents = async () => {
    const res = await app.request('/events', { method: 'PUT', headers: { authorization: `Bearer ${claimed.phoneToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ events: [] }) });
    expect(res.status).toBe(200);
  };
  const inbox = async () => ((await json(await app.request('/notifications', { headers: { authorization: `Bearer ${claimed.phoneToken}` } }))).notifications as AppNotification[]);
  return { seats, notifications, app, seatId: claimed.seatId as string, phoneToken: claimed.phoneToken as string, check, sendEvents, inbox, connectAnother };
};

describe('events-stale 판정', () => {
  it('24시간 경계: 23시간 59분 59초 전이면 넣지 않고 24시간이면 넣는다(저녁 8시 창 안에서)', async () => {
    const s = await setup();
    await s.sendEvents(); // 11-11 09:00:00 수신
    at('2026-11-12T08:59:59');
    expect(inEventsStaleWindow(now())).toBe(false);
    // 창 안에서 경계를 보려면 수신 시각을 바꿔야 한다: 11-12 20:00 기준 24시간 전 = 11-11 20:00
    at('2026-11-11T20:00:00');
    await s.sendEvents();
    at('2026-11-12T19:59:59');
    expect(s.check()).toEqual([]);
    at('2026-11-12T20:00:00');
    expect(s.check()).toEqual([s.seatId]);
    expect(EVENTS_STALE_AFTER_MS).toBe(24 * 3600_000);
  });

  it('23시간 59분 59초 지난 자리는 창 안(20:00)이어도 넣지 않는다', async () => {
    const s = await setup();
    at('2026-11-11T20:00:01');
    await s.sendEvents();
    at('2026-11-12T20:00:00'); // 23:59:59 경과
    expect(s.check()).toEqual([]);
    at('2026-11-12T20:00:01'); // 정확히 24시간
    expect(s.check()).toEqual([s.seatId]);
  });

  it('20시 경계: 19:59:59에는 넣지 않고 20:00:00에 넣고, 창(2시간)이 닫히면 넣지 않는다', async () => {
    const s = await setup();
    at('2026-11-14T19:59:59');
    expect(s.check()).toEqual([]);
    at('2026-11-14T20:00:00');
    expect(s.check()).toEqual([s.seatId]);
    const next = await setup();
    at('2026-11-14T21:59:59');
    expect(next.check()).toEqual([next.seatId]);
    const closed = await setup();
    at('2026-11-14T22:00:00');
    expect(closed.check()).toEqual([]);
    expect(EVENTS_STALE_WINDOW_MS).toBe(2 * 3600_000);
  });

  it('서울 시각 기준이다: UTC로는 20시가 아닌 시각에 판정하고, UTC 20시(서울 05시)에는 넣지 않는다', async () => {
    const s = await setup();
    clockMs = Date.parse('2026-11-14T11:00:00Z'); // 서울 20:00
    expect(s.check()).toEqual([s.seatId]);
    const n = await setup();
    clockMs = Date.parse('2026-11-14T20:00:00Z'); // 서울 05:00(다음 날)
    expect(n.check()).toEqual([]);
  });

  it('하루 한 번이다: 같은 날 창 안에서 여러 번 불려도 한 번, 다음 날 저녁에 다시 한 번', async () => {
    const s = await setup();
    at('2026-11-14T20:00:00');
    expect(s.check()).toEqual([s.seatId]);
    at('2026-11-14T20:05:00');
    expect(s.check()).toEqual([]);
    at('2026-11-14T21:30:00');
    expect(s.check()).toEqual([]);
    expect(await s.inbox()).toHaveLength(1);
    at('2026-11-15T20:00:00');
    expect(s.check()).toEqual([s.seatId]);
    expect(await s.inbox()).toHaveLength(2);
  });

  it('읽어 가서 지운 뒤에도 같은 날 다시 넣지 않는다', async () => {
    const s = await setup();
    at('2026-11-14T20:00:00');
    s.check();
    const [first] = await s.inbox();
    s.notifications.outbox.ack(s.seatId, [first?.id as string]);
    at('2026-11-14T20:10:00');
    expect(s.check()).toEqual([]);
  });

  it('일정을 다시 받으면 멈춘다(받은 시각이 바뀌어 24시간이 안 된다)', async () => {
    const s = await setup();
    at('2026-11-14T20:00:00');
    expect(s.check()).toEqual([s.seatId]);
    at('2026-11-14T20:30:00');
    await s.sendEvents();
    at('2026-11-15T20:00:00'); // 마지막 수신 후 23.5시간
    expect(s.check()).toEqual([]);
    at('2026-11-15T20:30:00'); // 24시간
    expect(s.check()).toEqual([s.seatId]);
  });

  it('그 자리가 일정을 받으면(PUT /events 성공) 아직 안 읽어 간 events-stale은 알림함에서 지워지고, 같은 날 다시 만들지 않는다', async () => {
    const s = await setup();
    const other = await s.connectAnother('폰B');
    at('2026-11-14T20:00:00');
    expect(s.check().sort()).toEqual([s.seatId, other.seatId].sort());
    s.notifications.notifier.notify(s.seatId, { kind: 'late-sms', title: '다른 종류', body: '' });
    expect((await s.inbox()).map((n) => n.kind)).toEqual(['events-stale', 'late-sms']);
    at('2026-11-14T20:05:00');
    await s.sendEvents();
    // 일정을 보낸 자리의 events-stale만 지워진다(다른 종류·다른 자리의 것은 그대로).
    expect((await s.inbox()).map((n) => n.kind)).toEqual(['late-sms']);
    expect(s.notifications.outbox.size(other.seatId)).toBe(1);
    // 그날의 중복 억제 키는 남아 있다.
    at('2026-11-14T20:10:00');
    expect(s.check()).toEqual([]);
  });

  it('일정 저장이 거절되면(본문 오류) events-stale을 지우지 않는다', async () => {
    const s = await setup();
    at('2026-11-14T20:00:00');
    s.check();
    const res = await s.app.request('/events', { method: 'PUT', headers: { authorization: `Bearer ${s.phoneToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ events: 'x' }) });
    expect(res.status).toBe(400);
    expect((await s.inbox()).map((n) => n.kind)).toEqual(['events-stale']);
  });

  it('연결한 지 24시간이 안 된 자리(일정을 한 번도 못 받음)에는 넣지 않는다', async () => {
    const s = await setup(); // 11-11 09:00 연결
    at('2026-11-11T20:00:00');
    expect(s.check()).toEqual([]);
    at('2026-11-12T20:00:00');
    expect(s.check()).toEqual([s.seatId]);
  });

  it('여러 자리 중 24시간이 지난 자리에만 넣는다', async () => {
    const s = await setup(); // 11-11 09:00 연결(첫 자리)
    at('2026-11-14T12:00:00');
    const second = await s.connectAnother('둘째 폰'); // 11-14 12:00 연결
    at('2026-11-14T20:00:00');
    expect(s.check()).toEqual([s.seatId]);
    expect(s.seats.allSeats().map((seat) => seat.seatId)).toContain(second.seatId);
  });

  it('알림 내용: 종류·제목·본문·data, 중복 억제 키는 서울 날짜', async () => {
    const s = await setup();
    at('2026-11-14T20:00:00');
    s.check();
    const [n] = await s.inbox();
    expect(n).toMatchObject({ kind: 'events-stale', title: EVENTS_STALE_TITLE, body: EVENTS_STALE_BODY, data: { action: 'resend-events' } });
    // 중복 억제 키는 서울 날짜(`events-stale:2026-11-14`)라 같은 날 같은 키는 막힌다.
    expect(s.notifications.notifier.notify(s.seatId, { kind: 'events-stale', title: 'x', body: '', dedupeKey: 'events-stale:2026-11-14' })).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('스케줄러', () => {
  it('등록한 작업을 차례로 부르고, 한 작업이 던져도 다음 작업은 돈다', async () => {
    const calls: string[] = [];
    const errors: string[] = [];
    const scheduler = createScheduler({ now, onError: (name) => errors.push(name) });
    scheduler.register({ name: 'a', run: () => void calls.push('a') });
    scheduler.register({ name: 'boom', run: () => { throw new Error('x'); } });
    scheduler.register({ name: 'c', run: async () => void calls.push('c') });
    await scheduler.tick();
    expect(calls).toEqual(['a', 'c']);
    expect(errors).toEqual(['boom']);
    expect(scheduler.jobNames()).toEqual(['a', 'boom', 'c']);
  });

  it('같은 이름을 다시 등록하면 바꾸고, 작업은 지금 시각을 받는다', async () => {
    const seen: number[] = [];
    const scheduler = createScheduler({ now });
    scheduler.register({ name: 'a', run: () => {} });
    scheduler.register({ name: 'a', run: (t) => void seen.push(t.getTime()) });
    at('2026-11-14T20:00:00');
    await scheduler.tick();
    expect(scheduler.jobNames()).toEqual(['a']);
    expect(seen).toEqual([clockMs]);
  });

  it('도는 중에 tick이 또 불려도 겹쳐 돌지 않는다', async () => {
    let release: () => void = () => {};
    const run = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
      .mockResolvedValue(undefined);
    const scheduler = createScheduler({ now });
    scheduler.register({ name: 'slow', run });
    const first = scheduler.tick();
    const second = scheduler.tick();
    release();
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(1);
    await scheduler.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('start는 setInterval 하나를 켜고 stop이 끈다(가짜 타이머)', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      const scheduler = createScheduler({ now, intervalMs: 1000 });
      scheduler.register({ name: 'a', run });
      scheduler.start();
      scheduler.start();
      expect(scheduler.running()).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(run).toHaveBeenCalledTimes(3);
      scheduler.stop();
      expect(scheduler.running()).toBe(false);
      await vi.advanceTimersByTimeAsync(3000);
      expect(run).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('createApp·createNotificationRuntime은 타이머를 켜지 않는다(서버 프로세스가 start한다)', () => {
    const seats = createSeatStore(now);
    const runtime = createNotificationRuntime({ seats, now, env: {} });
    newApp({ now, seats, notifications: runtime.notifications });
    expect(runtime.scheduler.running()).toBe(false);
    expect(runtime.scheduler.jobNames()).toEqual(['events-stale']);
    expect(runtime.fcmEnabled).toBe(false);
  });
});

describe('FCM 어댑터(네트워크 없음)', () => {
  const sample: AppNotification = { id: '1790000000000000', kind: 'events-stale', title: '제목', body: '본문', data: { action: 'resend-events' }, createdAt: '2026-11-14T11:00:00.000Z' };
  const SECRET_ACCESS = 'ya29.SECRET-ACCESS-TOKEN';
  const DEVICE = 'device-token-xyz';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

  it('요청 조립: v1 주소, Bearer 헤더, message(token·notification·data·android)', () => {
    const req = buildFcmRequest({ projectId: 'my-proj', accessToken: SECRET_ACCESS, deviceToken: DEVICE, notification: sample });
    expect(req.url).toBe('https://fcm.googleapis.com/v1/projects/my-proj/messages:send');
    expect(req.init.method).toBe('POST');
    expect(req.init.headers.authorization).toBe(`Bearer ${SECRET_ACCESS}`);
    expect(req.init.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(req.init.body)).toEqual({
      message: {
        token: DEVICE,
        notification: { title: '제목', body: '본문' },
        data: { action: 'resend-events', id: sample.id, kind: 'events-stale' },
        android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: FCM_ANDROID_CHANNEL_ID } },
      },
    });
    // data 값은 모두 문자열이어야 한다.
    expect(Object.values(JSON.parse(req.init.body).message.data).every((v) => typeof v === 'string')).toBe(true);
    expect(req.init.body).not.toContain(SECRET_ACCESS); // 접근 토큰은 헤더에만 있고 본문에는 없다
  });

  it('프로젝트 id는 주소에 인코딩해 넣는다', () => {
    expect(buildFcmRequest({ projectId: 'a/b', accessToken: 't', deviceToken: 'd', notification: sample }).url).toBe('https://fcm.googleapis.com/v1/projects/a%2Fb/messages:send');
  });

  it('기기 푸시 토큰이 있는 자리에만 보낸다(Expo Go 폰은 건너뜀)', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
    const tokens = createPushTokenRegistry();
    const sender = createFcmSender({ projectId: 'p', getAccessToken: async () => SECRET_ACCESS, tokens, fetch });
    await sender.send('seat-1', sample);
    expect(fetch).not.toHaveBeenCalled();
    tokens.set('seat-1', DEVICE);
    await sender.send('seat-1', sample);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://fcm.googleapis.com/v1/projects/p/messages:send');
  });

  it('실패 로그에는 상태 코드와 오류 이름만 남고 접근 토큰·기기 토큰·알림 내용은 없다', async () => {
    const logs: string[] = [];
    const tokens = createPushTokenRegistry();
    tokens.set('s', DEVICE);
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: `bad token ${DEVICE} ${SECRET_ACCESS}` } }),
    });
    const sender = createFcmSender({ projectId: 'p', getAccessToken: async () => SECRET_ACCESS, tokens, fetch, log: (m) => logs.push(m) });
    await sender.send('s', sample);
    expect(logs).toEqual(['FCM 전송 실패: HTTP 400 INVALID_ARGUMENT']);
    for (const secret of [SECRET_ACCESS, DEVICE, sample.title, sample.body]) expect(logs.join('\n')).not.toContain(secret);
  });

  it('네트워크 예외·접근 토큰 실패도 던지지 않고 이름만 남긴다. UNREGISTERED면 토큰을 버린다', async () => {
    const logs: string[] = [];
    const tokens = createPushTokenRegistry();
    tokens.set('s', DEVICE);
    const boom = createFcmSender({ projectId: 'p', getAccessToken: async () => { throw new Error(`키 ${privateKey}`); }, tokens, fetch: vi.fn(), log: (m) => logs.push(m) });
    await expect(boom.send('s', sample)).resolves.toBeUndefined();
    expect(logs).toEqual(['FCM 전송 실패: Error']);
    expect(logs.join('')).not.toContain('PRIVATE KEY');
    const gone = createFcmSender({
      projectId: 'p',
      getAccessToken: async () => SECRET_ACCESS,
      tokens,
      fetch: vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => JSON.stringify({ error: { status: 'UNREGISTERED' } }) }),
      log: (m) => logs.push(m),
    });
    await gone.send('s', sample);
    expect(tokens.get('s')).toBeNull();
    expect(logs.at(-1)).toBe('FCM 전송 실패: HTTP 404 UNREGISTERED');
  });

  it('자리가 지워지거나 폰이 바뀌면(forget) 푸시 토큰을 버린다 — 알림 묶음에 붙였을 때', async () => {
    const tokens = createPushTokenRegistry();
    tokens.set('s', DEVICE);
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
    const { notifier } = createNotifications({ now, extraSenders: [createFcmSender({ projectId: 'p', getAccessToken: async () => 'a', tokens, fetch })] });
    notifier.notify('s', { kind: 'events-stale', title: 't', body: 'b' });
    await Promise.resolve();
    notifier.forget('s');
    expect(tokens.get('s')).toBeNull();
  });

  it('서비스 계정 접근 토큰: JWT(RS256) 조립·서명, token 주소로 form POST, 만료 전 재사용', async () => {
    let calls = 0;
    const seen: { url: string; body: string }[] = [];
    const fetch = vi.fn(async (url: string, init: { body: string }) => {
      calls++;
      seen.push({ url, body: init.body });
      return { ok: true, status: 200, json: async () => ({ access_token: `tok-${calls}`, expires_in: 3600 }), text: async () => '' };
    });
    at('2026-11-14T20:00:00');
    const provider = createServiceAccountTokenProvider({ account: { clientEmail: 'svc@p.iam.gserviceaccount.com', privateKey }, fetch, now });
    expect(await provider()).toBe('tok-1');
    expect(await provider()).toBe('tok-1');
    expect(calls).toBe(1);
    expect(seen[0]?.url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(seen[0]?.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, c, sig] = (form.get('assertion') as string).split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(claims).toEqual({ iss: 'svc@p.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: Math.floor(clockMs / 1000), exp: Math.floor(clockMs / 1000) + 3600 });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
    expect(seen[0]?.body).not.toContain('PRIVATE KEY');
    clockMs += 3600_000 - 61_000;
    expect(await provider()).toBe('tok-1');
    clockMs += 2_000; // 만료 1분 전 안쪽
    expect(await provider()).toBe('tok-2');
  });

  it('접근 토큰 요청이 실패하면 상태 코드만 담은 오류(키 미노출)', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}), text: async () => `invalid ${privateKey}` });
    const provider = createServiceAccountTokenProvider({ account: { clientEmail: 'e@x', privateKey }, fetch, now });
    await expect(provider()).rejects.toThrow('HTTP 401');
    await provider().catch((e: Error) => expect(e.message).not.toContain('PRIVATE KEY'));
  });

  it('접근 토큰 요청이 실패하면 기다린 뒤에만 다시 요청한다(30초에서 시작해 두 배씩, 최대 10분). 성공하면 처음으로 돌아간다', async () => {
    at('2026-11-14T20:00:00');
    let fail = true;
    const fetch = vi.fn(async () =>
      fail
        ? { ok: false, status: 503, json: async () => ({}), text: async () => '' }
        : { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }), text: async () => '' },
    );
    const provider = createServiceAccountTokenProvider({ account: { clientEmail: 'e@x', privateKey }, fetch, now, retryInitialMs: 30_000, retryMaxMs: 100_000 });
    await expect(provider()).rejects.toThrow('HTTP 503');
    expect(fetch).toHaveBeenCalledTimes(1);
    // 기다리는 동안은 요청하지 않고 같은 오류를 던진다.
    await expect(provider()).rejects.toThrow('HTTP 503');
    clockMs += 29_000;
    await expect(provider()).rejects.toThrow('HTTP 503');
    expect(fetch).toHaveBeenCalledTimes(1);
    clockMs += 1_000; // 30초
    await expect(provider()).rejects.toThrow('HTTP 503');
    expect(fetch).toHaveBeenCalledTimes(2);
    clockMs += 59_000; // 두 번째는 60초를 기다린다
    await expect(provider()).rejects.toThrow('HTTP 503');
    expect(fetch).toHaveBeenCalledTimes(2);
    clockMs += 1_000;
    await expect(provider()).rejects.toThrow('HTTP 503');
    expect(fetch).toHaveBeenCalledTimes(3);
    clockMs += 99_000; // 세 번째는 120초가 아니라 상한 100초
    await expect(provider()).rejects.toThrow('HTTP 503');
    expect(fetch).toHaveBeenCalledTimes(3);
    clockMs += 1_000;
    fail = false;
    expect(await provider()).toBe('tok');
    expect(fetch).toHaveBeenCalledTimes(4);
    // 성공하면 대기 상태가 풀려, 이후 실패는 다시 30초에서 시작한다.
    clockMs += 3600_000;
    fail = true;
    await expect(provider()).rejects.toThrow('HTTP 503');
    clockMs += 30_000;
    await expect(provider()).rejects.toThrow('HTTP 503');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('환경 변수: 없으면 꺼짐(null), 파일이 있으면 켜지고 키는 로그·오류에 없다', () => {
    expect(loadFcmConfigFromEnv({})).toBeNull();
    expect(loadFcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_FILE: '' })).toBeNull();
    const file = JSON.stringify({ client_email: 'svc@p.iam', private_key: privateKey, project_id: 'proj-a' });
    expect(loadFcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_FILE: '/k.json' }, () => file)?.projectId).toBe('proj-a');
    expect(loadFcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_FILE: '/k.json', FCM_PROJECT_ID: 'override' }, () => file)?.projectId).toBe('override');
    let message = '';
    try {
      loadFcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_FILE: '/k.json' }, () => JSON.stringify({ client_email: 'x', private_key: privateKey }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('/k.json');
    expect(message).not.toContain('PRIVATE KEY');
    expect(() => loadFcmConfigFromEnv({ FCM_SERVICE_ACCOUNT_FILE: '/k.json' }, () => 'not json')).toThrow('/k.json');
  });

  it('createNotificationRuntime: 환경 변수가 있으면 FCM 보내는 곳이 붙는다', async () => {
    const file = JSON.stringify({ client_email: 'svc@p.iam', private_key: privateKey, project_id: 'proj-a' });
    const runtime = createNotificationRuntime({ seats: createSeatStore(now), now, env: { FCM_SERVICE_ACCOUNT_FILE: '/k.json' }, readFile: () => file });
    expect(runtime.fcmEnabled).toBe(true);
    runtime.notifications.notifier.notify('s', { kind: 'events-stale', title: 't', body: 'b' });
    expect(runtime.notifications.outbox.size('s')).toBe(1); // 알림함은 늘 함께 쌓인다
  });
});
