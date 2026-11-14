import { rememberNoTravelName, schedulePlacesApi } from '../schedulePlacesApi';

import { appCorrectedPlaces } from '../../calendar-sync/correctedPlaces';

const mockPut = jest.fn();
const mockGet = jest.fn();
const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockSync = jest.fn();
jest.mock('../../../api/client', () => ({
  api: { schedules: { places: { $get: (...args: unknown[]) => mockGet(...args) }, ':id': { place: { $put: (...args: unknown[]) => mockPut(...args) } } } },
}));
jest.mock('../../skips/skipMemory', () => ({
  appSkipMemory: {
    add: (...args: unknown[]) => mockAdd(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    sync: (...args: unknown[]) => mockSync(...args),
  },
}));

const saved = (over: Record<string, unknown> = {}) => ({ id: 'kia', title: 'KIA 직관', place: null, locationText: null, noTravel: true, noTravelReason: null, corrected: false, ...over });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockPut.mockReset();
  mockGet.mockReset();
  mockAdd.mockReset().mockResolvedValue(undefined);
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockSync.mockReset().mockResolvedValue({ refreshed: true, pendingFailed: false, full: false });
  appCorrectedPlaces.clear();
});

describe('savePlace: 이동 없음 → 같은 이름 기억', () => {
  it('일정에 이동 없음을 고르면 일정별 저장에 더해 그 이름을 기억한다', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => saved() });
    const { signal } = new AbortController();
    const result = await schedulePlacesApi.savePlace('kia', { noTravel: true }, signal);
    expect(mockPut).toHaveBeenCalledWith({ param: { id: 'kia' }, json: { noTravel: true } }, { init: { signal } });
    expect(result).toMatchObject({ id: 'kia', noTravel: true });
    await flush();
    expect(mockAdd).toHaveBeenCalledWith('KIA 직관');
    expect(mockSync).toHaveBeenCalledTimes(1); // 서버에 올리는 것은 기다리지 않고 시작한다
  });

  it('저장 응답은 이름 기억을 기다리지 않고 돌려준다(기억이 막혀 있어도 저장은 끝난다)', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => saved() });
    mockAdd.mockReturnValue(new Promise(() => {}));
    await expect(schedulePlacesApi.savePlace('kia', { noTravel: true }, new AbortController().signal)).resolves.toMatchObject({ id: 'kia' });
    mockRemove.mockReturnValue(new Promise(() => {}));
    mockPut.mockResolvedValue({ ok: true, json: async () => saved({ noTravel: false, corrected: true }) });
    await expect(schedulePlacesApi.savePlace('kia', { placeId: 'mock-field' }, new AbortController().signal)).resolves.toMatchObject({ id: 'kia' });
  });

  it('장소를 넣으면 같은 이름의 이동 없음 기억을 지운다(가장 최근 선택이 이긴다) — 지우거나 이동 없음일 때는 지우지 않는다', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => saved({ noTravel: false, corrected: true }) });
    await schedulePlacesApi.savePlace('kia', { placeId: 'mock-field' }, new AbortController().signal);
    await flush();
    expect(mockRemove).toHaveBeenCalledWith('KIA 직관');
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockAdd).not.toHaveBeenCalled();
    mockRemove.mockClear();
    mockPut.mockResolvedValue({ ok: true, json: async () => saved({ noTravel: false }) });
    await schedulePlacesApi.savePlace('kia', { placeId: null }, new AbortController().signal);
    await flush();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('저장 응답의 보정 여부를 일정 동기화가 보는 목록에 남긴다(장소를 넣으면 거르지 않는 일정)', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => saved({ noTravel: false, corrected: true }) });
    await schedulePlacesApi.savePlace('kia', { placeId: 'mock-field' }, new AbortController().signal);
    expect(appCorrectedPlaces.has('kia')).toBe(true);
    mockPut.mockResolvedValue({ ok: true, json: async () => saved({ noTravel: true, corrected: false }) });
    await schedulePlacesApi.savePlace('kia', { noTravel: true }, new AbortController().signal);
    expect(appCorrectedPlaces.has('kia')).toBe(false);
  });

  it('조회하면 보정된 일정 id로 목록을 통째로 바꾼다', async () => {
    appCorrectedPlaces.set('옛 일정', true);
    mockGet.mockResolvedValue({ ok: true, json: async () => ({ anchor: 'x', schedules: [saved({ id: 'a', corrected: true }), saved({ id: 'b' }), saved({ id: 'c', corrected: true })] }) });
    await schedulePlacesApi.fetchSchedules(new AbortController().signal);
    expect(['a', 'b', 'c', '옛 일정'].map((id) => appCorrectedPlaces.has(id))).toEqual([true, false, true, false]);
  });

  it('undoNoTravel: 일정별 보정을 지우고 이름 기억도 되돌린다(전부터 기억하던 이름이면 기억은 그대로)', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => saved({ noTravel: false }) });
    const { signal } = new AbortController();
    await schedulePlacesApi.undoNoTravel('kia', 'KIA 직관', false, signal);
    expect(mockPut).toHaveBeenCalledWith({ param: { id: 'kia' }, json: { placeId: null } }, { init: { signal } });
    await flush();
    expect(mockRemove).toHaveBeenCalledWith('KIA 직관');
    mockRemove.mockClear();
    await schedulePlacesApi.undoNoTravel('kia', 'KIA 직관', true, signal);
    await flush();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('undoNoTravel이 서버에서 실패하면 기억을 건드리지 않는다', async () => {
    mockPut.mockResolvedValue({ ok: false, status: 503 });
    await expect(schedulePlacesApi.undoNoTravel('kia', 'KIA 직관', false, new AbortController().signal)).rejects.toThrow('503');
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('일정별 저장이 실패하면 이름도 기억하지 않는다', async () => {
    mockPut.mockResolvedValue({ ok: false, status: 404 });
    await expect(schedulePlacesApi.savePlace('kia', { noTravel: true }, new AbortController().signal)).rejects.toThrow('404');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('이름 기억에서 오류가 나도 일정별 저장 결과를 돌려준다', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => saved() });
    mockAdd.mockRejectedValue(new Error('storage'));
    await expect(schedulePlacesApi.savePlace('kia', { noTravel: true }, new AbortController().signal)).resolves.toMatchObject({ id: 'kia' });
  });

  it('서버에 올리는 것이 실패해도(거절되지 않고 던져도) 저장은 성공한다', async () => {
    mockSync.mockRejectedValue(new Error('network'));
    await rememberNoTravelName('KIA 직관', { add: mockAdd, sync: mockSync });
    expect(mockAdd).toHaveBeenCalledWith('KIA 직관');
  });
});
