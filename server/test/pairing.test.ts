import { describe, expect, it } from 'vitest';
import { createPairingStore, PAIRING_CODE_TTL_MS } from '../src/routes/pairing.js';
import { newApp } from './helpers.js';

let clockMs = Date.parse('2026-11-14T09:00:00+09:00');
const makeApp = (random?: () => number) => {
  clockMs = Date.parse('2026-11-14T09:00:00+09:00');
  const now = () => new Date(clockMs);
  return newApp({ now, pairing: createPairingStore(now, random) });
};
type App = ReturnType<typeof makeApp>;
const post = (app: App, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const issue = async (app: App, carId = 'car-1') => (await (await post(app, '/pairing/codes', { carId })).json()) as { code: string; expiresAt: string; qr: string };
const status = async (app: App, carId = 'car-1') => (await (await app.request(`/pairing/cars/${carId}`)).json()) as { paired: boolean; pairedAt: string | null; codeActive: boolean };

describe('차–폰 연결', () => {
  it('차가 6자리 코드와 QR 글을 받고, 폰이 그 코드를 보내면 연결된다', async () => {
    const app = makeApp();
    expect(await status(app)).toEqual({ paired: false, pairedAt: null, codeActive: false });
    const issued = await issue(app);
    expect(await status(app)).toEqual({ paired: false, pairedAt: null, codeActive: true });
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.qr).toBe(`chagok://pair?code=${issued.code}`);
    expect(issued.expiresAt).toBe(new Date(clockMs + PAIRING_CODE_TTL_MS).toISOString());

    clockMs += 60_000;
    const claimed = await post(app, '/pairing/claim', { code: issued.code });
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ carId: 'car-1', pairedAt: '2026-11-14T00:01:00.000Z' });
    expect(await status(app)).toEqual({ paired: true, pairedAt: '2026-11-14T00:01:00.000Z', codeActive: false });
    // 쓴 코드는 다시 쓸 수 없다.
    expect((await post(app, '/pairing/claim', { code: issued.code })).status).toBe(404);
  });

  it('만료된 코드와 새 코드를 받아 버려진 코드는 404이고 연결되지 않는다', async () => {
    const app = makeApp();
    const first = await issue(app);
    clockMs += PAIRING_CODE_TTL_MS;
    expect((await status(app)).codeActive).toBe(false);
    expect((await post(app, '/pairing/claim', { code: first.code })).status).toBe(404);
    const second = await issue(app);
    const third = await issue(app);
    expect((await post(app, '/pairing/claim', { code: second.code })).status).toBe(second.code === third.code ? 200 : 404);
    expect((await post(app, '/pairing/claim', { code: third.code })).status).toBe(second.code === third.code ? 404 : 200);
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
    expect(await status(makeApp())).toEqual({ paired: false, pairedAt: null, codeActive: false });
  });
});
