/**
 * 폰의 `settingsApi`를 실제 hono `hc`로 서버 앱(진짜 라우트)에 묶어 돌린 테스트다(`api/__tests__/clientWiring.test.ts` 방식).
 * 요청 모양(부분 갱신 본문)과 응답 타입이 서버와 정말 맞는지, 연결 전 기기 버킷 → 연결 뒤 자리 이어받기가 폰 클라이언트로도 되는지를 본다.
 */
// 서버 앱은 값으로 가져온다(타입만이 아니라 실제 라우트를 돌린다). 서버 코드의 .js 확장자 import는 jest 설정(moduleNameMapper)이 푼다.
import { createApp } from '../../../../../server/src/app';
import { settingsApi } from '../settingsApi';

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

describe('settingsApi + hc + 서버 앱', () => {
  it('처음에는 모두 꺼짐이다', async () => {
    expect(await settingsApi.fetchSettings(signal)).toEqual({ plusMode: false, lateContact: false, voiceOnly: false });
  });

  it('보낸 키만 바꾸고 바뀐 전체를 돌려준다', async () => {
    expect(await settingsApi.saveSettings({ plusMode: true }, signal)).toEqual({ plusMode: true, lateContact: false, voiceOnly: false });
    expect(await settingsApi.saveSettings({ voiceOnly: true }, signal)).toEqual({ plusMode: true, lateContact: false, voiceOnly: true });
    expect(await settingsApi.fetchSettings(signal)).toEqual({ plusMode: true, lateContact: false, voiceOnly: true });
  });

  it('서버가 거절하면 HttpError를 던진다', async () => {
    await expect(settingsApi.saveSettings({ plusMode: 'yes' } as never, signal)).rejects.toMatchObject({ name: 'HttpError', status: 400 });
  });
});
