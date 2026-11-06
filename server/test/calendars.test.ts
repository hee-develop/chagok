import { beforeEach, describe, expect, it } from 'vitest';
import type { createApp } from '../src/app.js';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../src/limits.js';
import { MAX_SELECTED_IDS } from '../src/routes/calendars.js';
import { newApp } from './helpers.js';

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = newApp();
});

const put = (body: unknown) =>
  app.request('/calendars/selection', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('GET /calendars/selection', () => {
  it('저장 전에는 null 둘을 돌려준다', async () => {
    const res = await app.request('/calendars/selection');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ selectedIds: null, savedAt: null, revision: null });
  });
});

describe('PUT /calendars/selection revision', () => {
  const saveAt = (selectedIds: string[], revision: number) => put({ selectedIds, revision });
  const current = async () => (await (await app.request('/calendars/selection')).json()) as { selectedIds: string[]; revision: number };

  it('더 큰 revision은 저장한다', async () => {
    await saveAt(['mock-my'], 5);
    const res = await saveAt(['mock-work'], 6);
    expect(await res.json()).toMatchObject({ selectedIds: ['mock-work'], revision: 6 });
    expect((await current()).selectedIds).toEqual(['mock-work']);
  });

  it('같은 revision은 저장한다', async () => {
    await saveAt(['mock-my'], 5);
    await saveAt(['mock-work'], 5);
    expect((await current()).selectedIds).toEqual(['mock-work']);
  });

  it('저장된 것보다 작은 revision은 저장하지 않고 현재 저장값을 200으로 돌려준다', async () => {
    await saveAt(['mock-kia'], 10);
    const stale = await saveAt(['mock-my'], 9);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ selectedIds: ['mock-kia'], revision: 10 });
    expect(await current()).toMatchObject({ selectedIds: ['mock-kia'], revision: 10 });
  });

  it('요청이 뒤바뀌어 도착해도 마지막 revision이 남는다', async () => {
    await saveAt(['mock-work'], 2);
    await saveAt(['mock-my'], 1);
    expect((await current()).selectedIds).toEqual(['mock-work']);
  });
});

describe('PUT /calendars/selection', () => {
  it('저장하고 selectedIds와 savedAt을 돌려준다', async () => {
    const res = await put({ selectedIds: ['mock-my', 'mock-work'], revision: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { selectedIds: string[]; savedAt: string };
    expect(body.selectedIds).toEqual(['mock-my', 'mock-work']);
    expect(new Date(body.savedAt).toISOString()).toBe(body.savedAt);
  });

  it('저장 뒤 GET이 같은 값을 돌려준다', async () => {
    const saved = (await (await put({ selectedIds: ['mock-kia'], revision: 1 })).json()) as { savedAt: string };
    const res = await app.request('/calendars/selection');
    expect(await res.json()).toEqual({ selectedIds: ['mock-kia'], savedAt: saved.savedAt, revision: 1 });
  });

  it('빈 선택(0개)도 허용한다', async () => {
    expect((await put({ selectedIds: [], revision: 1 })).status).toBe(200);
  });

  it('캘린더 이름·출처 같은 다른 필드는 무시한다', async () => {
    const res = await put({ selectedIds: ['mock-my'], revision: 1, calendars: [{ id: 'x' }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ selectedIds: ['mock-my'], savedAt: expect.any(String), revision: 1 });
  });

  it.each([
    ['selectedIds 없음', { revision: 1 }],
    ['selectedIds가 배열이 아님', { selectedIds: 'mock-my', revision: 1 }],
    ['목 캘린더에 없는 id', { selectedIds: ['zzz'], revision: 1 }],
    ['selectedIds 중복', { selectedIds: ['mock-my', 'mock-my'], revision: 1 }],
    ['빈 문자열', { selectedIds: [''], revision: 1 }],
    ['공백 문자열', { selectedIds: ['  '], revision: 1 }],
    ['문자열 아님', { selectedIds: [1], revision: 1 }],
    ['본문이 배열', []],
    ['revision 없음', { selectedIds: [] }],
    ['revision이 문자열', { selectedIds: [], revision: '1' }],
    ['revision이 소수', { selectedIds: [], revision: 1.5 }],
    ['revision이 음수', { selectedIds: [], revision: -1 }],
    ['revision이 안전 정수 초과', { selectedIds: [], revision: Number.MAX_SAFE_INTEGER + 2 }],
    ['id가 100자 초과', { selectedIds: ['a'.repeat(MAX_ID_LENGTH + 1)], revision: 1 }],
    ['개수가 50개 초과', { selectedIds: Array.from({ length: MAX_SELECTED_IDS + 1 }, (_, i) => `id-${i}`), revision: 1 }],
  ])('400: %s', async (_name, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('JSON이 아니면 400이고 기존 저장값은 그대로다', async () => {
    await put({ selectedIds: ['mock-my'], revision: 1 });
    const res = await put('not json');
    expect(res.status).toBe(400);
    const got = (await (await app.request('/calendars/selection')).json()) as { selectedIds: string[] };
    expect(got.selectedIds).toEqual(['mock-my']);
  });

  it('본문이 64KB를 넘으면 413이고 저장하지 않는다', async () => {
    const res = await put({ selectedIds: ['mock-my'], revision: 1, pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect(res.status).toBe(413);
    expect(await res.json()).toHaveProperty('error');
    expect(await (await app.request('/calendars/selection')).json()).toEqual({ selectedIds: null, savedAt: null, revision: null });
  });

  it('검증 실패 시 저장하지 않는다', async () => {
    await put({ selectedIds: ['zzz'], revision: 1 });
    expect(await (await app.request('/calendars/selection')).json()).toEqual({ selectedIds: null, savedAt: null, revision: null });
  });
});
