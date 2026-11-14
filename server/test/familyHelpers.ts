import { expect } from 'vitest';
import { createFamilyRequests } from '../src/family/service.js';
import { createNotifications } from '../src/notify/notifier.js';
import { createSeatStore } from '../src/seats.js';
import { newApp } from './helpers.js';

export const T0 = Date.parse('2026-11-15T10:00:00+09:00');
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 기기 id(22~64자)를 이름으로 만든다. */
export const dev = (name: string) => `dev-${name}`.padEnd(24, '0');

export const fresh = (options: { legacyDriverFallback?: boolean } = {}) => {
  const clock = { ms: T0 };
  const now = () => new Date(clock.ms);
  const seats = createSeatStore(now);
  const notifications = createNotifications({ now });
  const familyRequests = createFamilyRequests({ now, seats, notifier: notifications.notifier });
  const app = newApp({ now, seats, notifications, familyRequests, clientAddress: (c) => c.req.header('x-test-ip') ?? 'test', ...options });
  return { app, clock, seats, ...notifications, familyRequests };
};
export type Fresh = ReturnType<typeof fresh>;

export type Opts = { token?: string; body?: unknown; device?: string; ip?: string };
export const call = async (t: Pick<Fresh, 'app'>, method: string, path: string, { token, body, device, ip }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['x-chagok-device'] = device;
  if (ip) headers['x-test-ip'] = ip;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await t.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text === '' ? null : (JSON.parse(text) as any) };
};

/** 차(없으면 새로 만듦)에 폰을 연결한다. device를 주면 그 기기 id로 claim한다. */
export const connect = async (t: Fresh, name: string, o: { device?: string; carToken?: string; ip?: string } = {}) => {
  let carToken = o.carToken;
  let carId: string | undefined;
  if (!carToken) {
    const first = await call(t, 'POST', '/pair/code', { body: {} });
    carToken = first.body.carToken as string;
    carId = first.body.carId as string;
  }
  const issued = await call(t, 'POST', '/pair/code', { token: carToken, body: {} });
  expect(issued.status).toBe(200);
  const claimed = await call(t, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device: o.device, ip: o.ip });
  expect(claimed.status).toBe(200);
  return { carToken, carId, seatId: claimed.body.seatId as string, phoneToken: claimed.body.phoneToken as string };
};

/** 폰(토큰과 기기 id) 호출 모양. */
export const as = (who: { phoneToken?: string; device?: string }) => ({ token: who.phoneToken, device: who.device });

export const inbox = (t: Fresh, seatId: string) => t.outbox.list(seatId);

export const careBody = (recipient: unknown, extra: Record<string, unknown> = {}) => ({ category: 'care', recipient, item: '우산', timing: 'take-along', ...extra });
export const stopBody = (recipient: unknown, extra: Record<string, unknown> = {}) => ({
  category: 'stop', recipient, place: { text: '약국' }, item: '감기약', deadline: { type: 'today' }, ...extra,
});
export const appointmentBody = (recipient: unknown, extra: Record<string, unknown> = {}) => ({
  category: 'appointment', recipient, at: '2026-11-15T18:00:00+09:00', place: { text: '광주 KIA 챔피언스필드', lat: 35.168, lng: 126.889 }, companions: ['동생'], ...extra,
});
export const rideBody = (recipient: unknown, extra: Record<string, unknown> = {}) => ({
  category: 'ride', recipient, who: '민준', pickup: { text: '학원' }, dropoff: { text: '집' }, at: '2026-11-15T21:00:00+09:00', ...extra,
});
export const bodyOf = (category: 'care' | 'stop' | 'appointment' | 'ride', recipient: unknown) =>
  ({ care: careBody, stop: stopBody, appointment: appointmentBody, ride: rideBody })[category](recipient);
