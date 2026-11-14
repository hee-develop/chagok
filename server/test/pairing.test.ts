import { describe, expect, it } from 'vitest';
import { CODE_TTL_MS, SEATLESS_CAR_TTL_MS, createSeatStore } from '../src/seats.js';
import { newApp } from './helpers.js';

let clockMs = Date.parse('2026-11-14T09:00:00+09:00');
const makeApp = (random?: () => number) => {
  clockMs = Date.parse('2026-11-14T09:00:00+09:00');
  const now = () => new Date(clockMs);
  return newApp({ now, seats: createSeatStore(now, random), isLoopback: () => true });
};
type App = ReturnType<typeof makeApp>;
const post = (app: App, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const issue = async (app: App, carId = 'car-1') => (await (await post(app, '/pairing/codes', { carId })).json()) as { code: string; expiresAt: string; qr: string };
const status = async (app: App, carId = 'car-1') => (await (await app.request(`/pairing/cars/${carId}`)).json()) as { paired: boolean; pairedAt: string | null; codeActive: boolean };

describe('차–폰 연결(옛 /pairing 경로, 차 id만으로)', () => {
  it('차가 6자리 코드와 QR 글을 받고, 폰이 그 코드를 보내면 연결된다', async () => {
    const app = makeApp();
    const issued = await issue(app);
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.qr).toBe(`chagok://pair?code=${issued.code}`);
    expect(issued.expiresAt).toBe(new Date(clockMs + CODE_TTL_MS).toISOString());

    clockMs += 60_000;
    const claimed = await post(app, '/pairing/claim', { code: issued.code });
    expect(claimed.status).toBe(200);
    // 옛 필드 pairedAt은 그대로이고 자리·토큰 필드가 더해졌다. 폰에는 차 id(carId)를 주지 않는다.
    expect(await claimed.json()).toEqual({
      pairedAt: '2026-11-14T00:01:00.000Z', seatId: expect.any(String), name: '내 폰', phoneToken: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await status(app)).toEqual({ paired: true, pairedAt: '2026-11-14T00:01:00.000Z', codeActive: false });
    // 쓴 코드는 다시 쓸 수 없다.
    expect((await post(app, '/pairing/claim', { code: issued.code })).status).toBe(404);
  });

  it('코드는 5분 동안만 산다', async () => {
    const app = makeApp();
    const { code, expiresAt } = await issue(app);
    expect(CODE_TTL_MS).toBe(5 * 60_000);
    expect(expiresAt).toBe(new Date(clockMs + 5 * 60_000).toISOString());
    clockMs += 5 * 60_000 - 1;
    expect((await status(app)).codeActive).toBe(true);
    clockMs += 1;
    expect((await status(app)).codeActive).toBe(false);
    expect((await post(app, '/pairing/claim', { code })).status).toBe(404);
  });

  it('만료된 코드와 새 코드를 받아 버려진 코드는 404이고 연결되지 않는다', async () => {
    const codes = [0.111111, 0.222222, 0.333333];
    const app = makeApp(() => codes.shift() ?? 0.5);
    const first = await issue(app);
    clockMs += CODE_TTL_MS;
    expect((await status(app)).codeActive).toBe(false);
    expect((await post(app, '/pairing/claim', { code: first.code })).status).toBe(404);
    const second = await issue(app);
    const third = await issue(app);
    expect(second.code).not.toBe(third.code);
    expect((await post(app, '/pairing/claim', { code: second.code })).status).toBe(404);
    expect((await post(app, '/pairing/claim', { code: third.code })).status).toBe(200);
  });

  it('살아 있는 다른 차의 코드와 겹치지 않게 낸다', async () => {
    const values = [0.123456, 0.123456, 0.654321];
    const app = makeApp(() => values.shift() ?? 0.5);
    const a = await issue(app, 'car-a');
    const b = await issue(app, 'car-b');
    expect(a.code).toBe('123456');
    expect(b.code).toBe('654321');
  });

  it('연결을 풀 수 있다(데모 초기화)', async () => {
    const app = makeApp();
    const { code } = await issue(app);
    await post(app, '/pairing/claim', { code });
    expect((await status(app)).paired).toBe(true);
    const res = await app.request('/pairing/cars/car-1', { method: 'DELETE' });
    expect(await res.json()).toEqual({ paired: false, pairedAt: null, codeActive: false });
    expect(await status(app)).toEqual({ paired: false, pairedAt: null, codeActive: false });
  });

  it.each([null, {}, { carId: '' }, { carId: 1 }, { carId: 'x'.repeat(101) }, { carId: 'car', extra: 1 }])('잘못된 코드 요청 %j는 400', async (body) => {
    expect((await post(makeApp(), '/pairing/codes', body)).status).toBe(400);
  });

  it.each([null, {}, { code: '12345' }, { code: '1234567' }, { code: 'abcdef' }, { code: 123456 }, { code: '123456', extra: 1 }])('잘못된 연결 요청 %j는 400', async (body) => {
    expect((await post(makeApp(), '/pairing/claim', body)).status).toBe(400);
  });

  it('앱 인스턴스마다 따로 가진다', async () => {
    const app = makeApp();
    const { code } = await issue(app);
    await post(app, '/pairing/claim', { code });
    expect((await app.request('/pairing/cars/car-1')).status).toBe(200);
    expect((await makeApp().request('/pairing/cars/car-1')).status).toBe(404);
  });

  // 차 앱은 앱이 앞으로 올 때 이 경로로 '해제'를 판단한다: 200 paired:false만 해제, 404(서버가 이 차를 모름)는 서버를 다시 켠 것일 수 있어 해제가 아니다.
  describe('GET /pairing/cars/:carId: 모르는 차와 자리 없는 아는 차', () => {
    it('서버가 모르는 차는 404 unknown-car다(서버를 다시 켠 뒤·한 번도 코드를 받지 않은 차)', async () => {
      const app = makeApp();
      const res = await app.request('/pairing/cars/never-seen');
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ reason: 'unknown-car' });
      expect((await app.request(`/pairing/cars/${'x'.repeat(101)}`)).status).toBe(400);
    });

    it('코드를 받은 뒤 자리가 없는 아는 차는 200 paired:false다', async () => {
      const app = makeApp();
      await issue(app);
      const res = await app.request('/pairing/cars/car-1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ paired: false, pairedAt: null, codeActive: true });
    });

    it('연결됐다가 폰이 해제하면(자리 0개) 200 paired:false다: 진짜 해제', async () => {
      const app = makeApp();
      const { code } = await issue(app);
      const claimed = (await (await post(app, '/pairing/claim', { code })).json()) as { phoneToken: string };
      expect((await status(app)).paired).toBe(true);
      const released = await app.request('/pair', { method: 'DELETE', headers: { authorization: `Bearer ${claimed.phoneToken}` } });
      expect(released.status).toBe(200);
      const res = await app.request('/pairing/cars/car-1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ paired: false, pairedAt: null, codeActive: false });
    });

    it('자리 없는 차는 TTL 동안 알고 있다가(200) 지난 뒤에는 모른다(404)', async () => {
      const app = makeApp();
      await issue(app);
      clockMs += CODE_TTL_MS + SEATLESS_CAR_TTL_MS - 1;
      expect((await app.request('/pairing/cars/car-1')).status).toBe(200);
      clockMs += 1;
      expect((await app.request('/pairing/cars/car-1')).status).toBe(404);
    });

    it('404 뒤에 차가 새 코드를 받으면 서버가 차를 다시 만들어 200이 된다(차 앱의 재발급 경로)', async () => {
      const app = makeApp();
      expect((await app.request('/pairing/cars/car-1')).status).toBe(404);
      await issue(app);
      expect((await app.request('/pairing/cars/car-1')).status).toBe(200);
    });
  });
});
