import { expect } from 'vitest';
import type { newApp } from './helpers.js';

type App = ReturnType<typeof newApp>;

export type Opts = { token?: string; body?: unknown; device?: string; query?: string };

/** 요청 한 번. 응답 본문은 JSON이면 파싱해서 돌려준다. */
export const call = async (app: App, method: string, path: string, { token, body, device }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['x-chagok-device'] = device;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : (JSON.parse(text) as any) };
};

export type Car = { carId: string; carToken: string };
/** 차가 처음 코드를 받아 등록된다(토큰은 이때 한 번만 받는다). */
export const registerCar = async (app: App): Promise<Car> => {
  const res = await call(app, 'POST', '/pair/code', { body: {} });
  expect(res.status).toBe(200);
  return { carId: res.body.carId, carToken: res.body.carToken };
};

/** 차가 새 코드를 받아 폰이 연결한다(새 운전자 자리). */
export const connectPhone = async (app: App, car: Car, name: string, device?: string) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
  expect(issued.status).toBe(200);
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device });
  expect(claimed.status).toBe(200);
  return claimed.body as { seatId: string; name: string; phoneToken: string; pairedAt: string; mode: string };
};

export const event = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  calendarId: 'cal-1',
  title: '팀 회의',
  start: '2026-11-11T14:00:00+09:00',
  end: '2026-11-11T15:00:00+09:00',
  allDay: false,
  locationText: null,
  notes: null,
  attendees: [],
  ...over,
});
