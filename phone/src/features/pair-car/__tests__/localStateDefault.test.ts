import { appInbox } from '../../notifications/inbox';
import { appFilteredEvents } from '../../calendar-sync/filteredEvents';
import { appEventSync } from '../../calendar-sync/eventSync';
import { appPoller } from '../../notifications/poller';
import { clearLocalCarState } from '../localState';

// 앱 싱글턴을 실제로 불러와 비우는 기본 경로(경로 오타·모듈 이름 변경을 잡는다). 네이티브 모듈은 jest에서 가져오는 것만으로 던지지 않는 것만 쓴다.
jest.mock('../../notifications/localNotifier', () => ({ expoLocalNotifier: {} }));

describe('clearLocalCarState 기본 경로(앱 싱글턴)', () => {
  it('앱 알림함과 거른 일정 목록을 실제로 비운다', async () => {
    await appInbox.add([{ id: '9', kind: 'events-stale', title: 't', body: 'b', data: {}, createdAt: '2026-11-14T11:00:00.000Z' }]);
    appFilteredEvents.set([{ id: 'x', title: '회의', start: 'a', end: 'b', reason: 'online' } as never]);
    expect(appInbox.getState().items.length).toBeGreaterThan(0);
    const resetSync = jest.spyOn(appEventSync, 'reset');
    const stopPoll = jest.spyOn(appPoller, 'stop');

    clearLocalCarState();

    expect(resetSync).toHaveBeenCalledTimes(1);
    expect(stopPoll).toHaveBeenCalledTimes(1);
    expect(appInbox.getState()).toMatchObject({ items: [], lastId: null });
    expect(appFilteredEvents.get()).toEqual([]);
  });
});
