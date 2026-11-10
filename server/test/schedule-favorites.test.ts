import { describe, expect, it } from 'vitest';
import { catalog, newApp } from './helpers.js';

type App = ReturnType<typeof newApp>;
type Favorite = { kind: string; name: string; address: string; lat: number; lng: number };

const at = encodeURIComponent('2026-11-06T09:20:00+09:00');
const favorites = async (app: App) =>
  ((await (await app.request(`/schedules/today?at=${at}`)).json()) as { favorites: Favorite[] }).favorites;
const send = (app: App, method: string, path: string, body: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const place = (id: string) => {
  const p = [...catalog.places, ...catalog.suggestions].find((x) => x.id === id)!;
  return { name: p.name, address: p.address, lat: p.lat, lng: p.lng };
};

describe('GET /schedules/today 자주 가는 곳', () => {
  it('저장한 곳이 없으면 빈 목록이다', async () => {
    expect(await favorites(newApp())).toEqual([]);
  });

  it('집 → 회사 → 추가한 순서로 이름·주소·좌표를 내려주고 픽스처 전용 필드는 뺀다', async () => {
    const app = newApp();
    await send(app, 'POST', '/places/favorites/others', { placeId: 'mock-station' });
    await send(app, 'POST', '/places/favorites/others', { placeId: 'mock-library' });
    await send(app, 'PUT', '/places/favorites/work', { placeId: 'mock-work-gwangju' });
    await send(app, 'PUT', '/places/favorites/home', { placeId: 'mock-home-apt' });

    const list = await favorites(app);
    expect(list).toEqual([
      { kind: 'home', ...place('mock-home-apt') },
      { kind: 'work', ...place('mock-work-gwangju') },
      { kind: 'other', ...place('mock-station') },
      { kind: 'other', ...place('mock-library') },
    ]);
    expect(list.every((f) => !('fictional' in f))).toBe(true);
  });

  it('폰에서 바꾸면 다음 응답에 바로 반영된다', async () => {
    const app = newApp();
    await send(app, 'PUT', '/places/favorites/home', { placeId: 'mock-home-apt' });
    await send(app, 'PUT', '/places/favorites/work', { placeId: 'mock-work-gwangju' });
    await send(app, 'PUT', '/places/favorites/home', { placeId: null });
    // 다른 자리에 있던 장소를 집으로 옮기면 그 자리에서 빠진다.
    await send(app, 'PUT', '/places/favorites/home', { placeId: 'mock-work-gwangju' });
    expect(await favorites(app)).toEqual([{ kind: 'home', ...place('mock-work-gwangju') }]);
  });

  it('추천 목록에만 있는 장소도 풀어서 내려준다', async () => {
    const app = newApp();
    const suggestion = catalog.suggestions[0];
    await send(app, 'PUT', '/places/favorites/work', { placeId: suggestion.id });
    expect(await favorites(app)).toEqual([{ kind: 'work', ...place(suggestion.id) }]);
  });

  it('일정이 없는 날에도 내려준다(캘린더 선택과 무관)', async () => {
    const app = newApp();
    await send(app, 'PUT', '/places/favorites/home', { placeId: 'mock-home-apt' });
    await send(app, 'PUT', '/calendars/selection', { selectedIds: ['mock-holidays'], revision: 1 });
    const body = (await (await app.request(`/schedules/today?at=${at}`)).json()) as { schedules: unknown[]; favorites: Favorite[] };
    expect(body.schedules).toEqual([]);
    expect(body.favorites.map((f) => f.kind)).toEqual(['home']);
  });

  it('앱 인스턴스마다 따로 가진다', async () => {
    const app = newApp();
    await send(app, 'PUT', '/places/favorites/home', { placeId: 'mock-home-apt' });
    expect(await favorites(newApp())).toEqual([]);
  });
});
