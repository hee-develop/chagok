/**
 * `withSessionReset`과 hono `hc`를 실제로 묶어 서버 앱(진짜 라우트)에 붙인 테스트다. 요청 층이 만드는 init(헤더·본문)이
 * 정말 우리가 가정한 모양인지, 401로 토큰을 버린 뒤 같은 요청이 기기 id만으로 다시 가는지를 본다.
 */
import { hc } from 'hono/client';

import type { AppType } from '@chagok/server';
// 서버 앱은 값으로 가져온다(타입만이 아니라 실제 라우트를 돌린다). 서버 코드의 .js 확장자 import는 jest 설정(moduleNameMapper)이 푼다.
import { createApp } from '../../../../server/src/app';
import { authHeaders, createSession, DEVICE_HEADER, withSessionReset, type DeviceStorage, type TokenStorage } from '../session';

const memoryToken = (initial: string | null = null): TokenStorage => {
  let value = initial;
  return {
    read: async () => value,
    write: async (token) => {
      value = token;
    },
    remove: async () => {
      value = null;
    },
  };
};
type EventList = { events: { id: string }[] };
const eventIds = async (res: { json: () => Promise<unknown> }) => ((await res.json()) as EventList).events.map((e) => e.id);
const memoryDevice = (id: string): DeviceStorage => ({ read: async () => id, write: async () => undefined });

const DEVICE = 'd'.repeat(32);
const EVENT = {
  id: 'e1',
  calendarId: 'cal-1',
  title: '팀 회의',
  start: new Date(Date.now() + 3_600_000).toISOString(),
  end: new Date(Date.now() + 7_200_000).toISOString(),
  allDay: false,
  locationText: null,
  notes: null,
  contacts: [],
};

const setup = (tokenAtStart: string | null = null) => {
  const app = createApp({
    fixture: { schedules: [] } as never,
    calendars: [],
    places: { places: [], suggestions: [], remembered: [] } as never,
    familyMembers: [],
  });
  const session = createSession(memoryToken(tokenAtStart), memoryDevice(DEVICE));
  const requests: { method: string; auth: string | null; device: string | null }[] = [];
  const appFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ method: init?.method ?? 'GET', auth: headers.get('authorization'), device: headers.get(DEVICE_HEADER) });
    return app.request(input as string, init);
  };
  const api = hc<AppType>('http://server.test', { headers: authHeaders(session), fetch: withSessionReset(session, appFetch) });
  return { api, session, requests };
};

describe('hc + withSessionReset + 서버 앱', () => {
  it('모든 요청에 기기 id가 붙고, 토큰이 없으면 그 기기의 연결 전 버킷에 쓰고 읽는다', async () => {
    const { api, requests } = setup();
    expect((await api.events.$put({ json: { events: [EVENT] } })).status).toBe(200);
    const read = await api.events.$get({ query: { date: undefined } });
    expect(read.status).toBe(200);
    expect(await eventIds(read)).toEqual(['e1']);
    expect(requests.map((r) => [r.auth, r.device])).toEqual([[null, DEVICE], [null, DEVICE]]);
  });

  it('서버가 모르는 토큰(바뀜·끊김)으로 401을 받으면 토큰을 버리고 같은 요청을 기기 id만으로 다시 보내 성공한다', async () => {
    const { api, session, requests } = setup('s'.repeat(64));
    const res = await api.events.$put({ json: { events: [EVENT] } });
    expect(res.status).toBe(200);
    expect(await session.getToken()).toBeNull();
    expect(requests.map((r) => [r.method, r.auth === null ? 'no-token' : 'token', r.device])).toEqual([
      ['PUT', 'token', DEVICE],
      ['PUT', 'no-token', DEVICE],
    ]);
    // 다시 보낸 본문이 버킷에 실제로 저장됐다.
    const read = await api.events.$get({ query: { date: undefined } });
    expect(await eventIds(read)).toEqual(['e1']);
    // 이후 요청은 처음부터 토큰이 없다.
    expect(requests.at(-1)?.auth).toBeNull();
  });

  it('토큰이 필요한 GET /pair는 다시 보내도 401이라 그대로 401을 돌려준다(연결 안 됨)', async () => {
    const { api, session, requests } = setup('s'.repeat(64));
    const res = await api.pair.$get();
    expect(res.status).toBe(401);
    expect(await session.getToken()).toBeNull();
    expect(requests).toHaveLength(2);
  });
});
