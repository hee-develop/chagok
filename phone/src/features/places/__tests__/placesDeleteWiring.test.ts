/**
 * 폰의 `placesApi.removeOther`를 실제 hono `hc`로 서버 앱(진짜 라우트)에 묶어 돌린 테스트다(`memoryWiring.test.ts` 방식).
 * 콜론·쉼표·점이 든 장소 id(`ext:…`, `geo:위도,경도`)가 경로 변수로 올바르게 서버에 닿는지 본다.
 */
// 서버 앱은 값으로 가져온다(타입만이 아니라 실제 라우트를 돌린다). 서버 코드의 .js 확장자 import는 jest 설정(moduleNameMapper)이 푼다.
import { createApp } from '../../../../../server/src/app';
import { placesApi } from '../placesApi';

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

beforeEach(() => {
  mockServer.app = createApp({
    fixture: { schedules: [] } as never,
    calendars: [],
    places: { places: [], suggestions: [], remembered: [] } as never,
    familyMembers: [],
  });
});

const add = (place: object) =>
  mockServer.app!.request('/places/favorites/others', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ place }) });

describe('placesApi.removeOther + hc + 서버 앱', () => {
  it.each([
    ['외부 검색 결과(ext:)', { name: '카페 상무', address: '광주 서구', lat: 35.15, lng: 126.85, externalId: 'kakao:1234.5-a_b' }, 'ext:kakao:1234.5-a_b'],
    ['좌표만 있는 장소(geo:)', { name: '임시 장소', lat: 35.15, lng: 126.85 }, 'geo:35.15,126.85'],
  ])('%s의 id로 지운다', async (_label, place, id) => {
    expect((await add(place)).status).toBe(200);
    expect((await add({ name: '남는 곳', lat: 35.2, lng: 126.9 })).status).toBe(200);
    const next = await placesApi.removeOther(id, signal);
    expect(next.others.map((p) => p.id)).toEqual(['geo:35.2,126.9']);
    expect((await placesApi.fetchFavorites(signal)).others).toHaveLength(1);
  });

  it('없는 장소는 404 HttpError다', async () => {
    await expect(placesApi.removeOther('mock-nope', signal)).rejects.toMatchObject({ name: 'HttpError', status: 404 });
  });
});
