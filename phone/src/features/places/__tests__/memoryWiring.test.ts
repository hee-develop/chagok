/**
 * 폰의 `placeMemoryApi`를 실제 hono `hc`로 서버 앱(진짜 라우트)에 묶어 돌린 테스트다(`api/__tests__/clientWiring.test.ts` 방식).
 * 클라이언트 함수가 만드는 요청 모양(경로·쿼리 인코딩)이 서버가 받는 모양과 정말 맞는지를 본다. 이름에 `/`·`#`·`?`·`%`가 있어도 지워져야 한다.
 */
// 서버 앱은 값으로 가져온다(타입만이 아니라 실제 라우트를 돌린다). 서버 코드의 .js 확장자 import는 jest 설정(moduleNameMapper)이 푼다.
import { createApp } from '../../../../../server/src/app';
import { placeMemoryApi } from '../memoryApi';

type Server = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
const mockServer: { app: Server | null } = { app: null };

jest.mock('../../../api/client', () => {
  const { hc } = jest.requireActual('hono/client');
  return {
    api: hc('http://server.test', {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => mockServer.app!.request(typeof input === 'string' ? input : (input as Request).url, init),
    }),
  };
});

const { signal } = new AbortController();
const NAMES = ['스타벅스 상무점', '헬스장/수영장', 'A동#2', '카페?', '50% 할인점', 'a&b=c', '  공백   이름 '];

beforeEach(() => {
  mockServer.app = createApp({
    fixture: { schedules: [] } as never,
    calendars: [],
    places: { places: [], suggestions: [], remembered: [] } as never,
    familyMembers: [],
  });
});

const save = (name: string) =>
  mockServer.app!.request('/places/memory', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, place: { name: '장소', lat: 35.1, lng: 126.8 }, ambiguous: false }),
  });

describe('placeMemoryApi + hc + 서버 앱', () => {
  it.each(NAMES)('deleteMemory(%j)는 슬래시·#·?·%가 든 이름도 실제로 지운다', async (name) => {
    expect((await save(name)).status).toBe(200);
    expect((await save('남는 기억')).status).toBe(200);
    expect(await placeMemoryApi.deleteMemory(name, signal)).toBe(true);
    const left = (await placeMemoryApi.fetchMemories(signal)).map((m) => m.name);
    expect(left).toEqual(['남는 기억']);
  });

  it('없는 이름은 false(404)이고 아무것도 지우지 않는다', async () => {
    await save('있는 기억');
    expect(await placeMemoryApi.deleteMemory('없는 기억', signal)).toBe(false);
    expect((await placeMemoryApi.fetchMemories(signal)).map((m) => m.name)).toEqual(['있는 기억']);
  });

  it('fetchMemories는 최근에 쓴 것부터 돌려준다', async () => {
    await save('먼저');
    await save('나중');
    expect((await placeMemoryApi.fetchMemories(signal)).map((m) => m.name)).toEqual(['나중', '먼저']);
  });
});
