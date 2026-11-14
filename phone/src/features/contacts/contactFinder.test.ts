import type { DeviceEvent } from '../calendar-select/calendarSource';
import { createContactFinder } from './contactFinder';
import type { Contact } from './contactsSource';
import { makeContacts } from '../settings/testSupport';

const contacts: Contact[] = [
  { id: '1', name: '김민수', emails: ['m@x.com'], phones: ['010-1111-2222'] },
  { id: '2', name: '박서연', emails: ['s@x.com'], phones: ['010-3333-4444'] },
];
const event = (over: Partial<DeviceEvent> = {}): DeviceEvent => ({
  id: 'e1', calendarId: 'c', title: '민수랑 저녁', start: '2026-11-15T09:00:00.000Z', end: '2026-11-15T10:00:00.000Z',
  allDay: false, locationText: null, notes: null, attendees: [], ...over,
});
const make = (opts: Parameters<typeof createContactFinder>[0] = {}) =>
  createContactFinder({ source: makeContacts('granted', 'granted', contacts), fetchLateContact: async () => true, log: () => undefined, ...opts });

describe('createContactFinder', () => {
  it('늦을 때 연락이 켜져 있고 연락처 권한이 있으면 일정마다 상대의 표시 이름을 찾는다', async () => {
    const lookup = await make().prepare();
    expect(lookup).not.toBeNull();
    expect(lookup!(event())).toEqual(['김민수']);
    expect(lookup!(event({ title: '회의', attendeeEmails: ['s@x.com'] }))).toEqual(['박서연']);
    expect(lookup!(event({ title: '회의', attendees: ['박서연'] }))).toEqual(['박서연']);
    expect(lookup!(event({ title: '치과' }))).toEqual([]);
  });

  it('종일 일정은 이동 일정이 아니라서 찾지 않는다', async () => {
    const lookup = await make().prepare();
    expect(lookup!(event({ allDay: true }))).toEqual([]);
  });

  it('늦을 때 연락이 꺼져 있으면 연락처를 읽지도 않는다', async () => {
    const source = makeContacts('granted', 'granted', contacts);
    expect(await make({ source, fetchLateContact: async () => false }).prepare()).toBeNull();
    expect(source.permission).not.toHaveBeenCalled();
    expect(source.list).not.toHaveBeenCalled();
  });

  it.each(['ask', 'denied'] as const)('연락처 권한이 %s이면 찾지 않고 목록도 읽지 않는다', async (permission) => {
    const source = makeContacts(permission, permission, contacts);
    expect(await make({ source }).prepare()).toBeNull();
    expect(source.list).not.toHaveBeenCalled();
    expect(source.request).not.toHaveBeenCalled(); // 권한 창은 설정 화면만 띄운다
  });

  it('설정을 못 읽으면 마지막으로 안 값을 쓰고, 처음부터 못 읽었으면 찾지 않는다', async () => {
    const fetchLateContact = jest.fn().mockResolvedValueOnce(true).mockRejectedValue(new Error('offline'));
    const finder = make({ fetchLateContact });
    expect(await finder.prepare()).not.toBeNull();
    expect(await finder.prepare()).not.toBeNull(); // 읽기 실패 → 마지막 값(켜짐)
    expect(await make({ fetchLateContact: async () => { throw new Error('offline'); } }).prepare()).toBeNull();
  });

  it('연락처 색인을 TTL 동안 다시 쓰고, 지나면 다시 읽는다', async () => {
    let clock = 0;
    const source = makeContacts('granted', 'granted', contacts);
    const finder = make({ source, now: () => clock, ttlMs: 1000 });
    await finder.prepare();
    clock = 999;
    await finder.prepare();
    expect(source.list).toHaveBeenCalledTimes(1);
    clock = 1000;
    await finder.prepare();
    expect(source.list).toHaveBeenCalledTimes(2);
  });

  it('연락처를 못 읽으면 이전 색인을 쓰고, 이전 것도 없으면 찾지 않는다', async () => {
    let clock = 0;
    const source = makeContacts('granted', 'granted', contacts);
    const finder = make({ source, now: () => clock, ttlMs: 1000 });
    expect(await finder.prepare()).not.toBeNull();
    clock = 5000;
    source.list.mockRejectedValue(new Error('native'));
    const lookup = await finder.prepare();
    expect(lookup!(event())).toEqual(['김민수']);
    const fresh = makeContacts('granted', 'granted', contacts);
    fresh.list.mockRejectedValue(new Error('native'));
    expect(await make({ source: fresh }).prepare()).toBeNull();
  });

  it('권한을 잃거나 기능을 끄면 읽어 둔 연락처를 버린다(다시 켜면 다시 읽는다)', async () => {
    let late = true;
    const source = makeContacts('granted', 'granted', contacts);
    const finder = make({ source, fetchLateContact: async () => late });
    await finder.prepare();
    late = false;
    expect(await finder.prepare()).toBeNull();
    late = true;
    await finder.prepare();
    expect(source.list).toHaveBeenCalledTimes(2);
  });

  it('로그에 이름·번호·일정 내용을 남기지 않는다', async () => {
    const log = jest.fn();
    const source = makeContacts('granted', 'granted', contacts);
    source.list.mockRejectedValue(new Error('김민수 010-1111-2222'));
    await make({ source, log, fetchLateContact: async () => { throw new Error('민수랑 저녁'); } }).prepare();
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/민수|010|저녁/);
  });
});
