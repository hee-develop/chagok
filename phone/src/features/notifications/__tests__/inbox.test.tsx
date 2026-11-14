import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { createInbox, INBOX_KEY, INBOX_TTL_MS, MAX_INBOX_ITEMS, useInbox } from '../inbox';
import { createMemoryStore } from '../../../storage/keyValueStore';
import { idsOf, note } from '../../../__tests__/support/notifications';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('폰 알림함(createInbox)', () => {
  it('새 알림만 담고(이미 있거나 lastId 이하는 건너뜀) 담은 것을 돌려준다. 새것이 위', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    expect((await inbox.add([note('10'), note('20')])).map((i) => i.id)).toEqual(['10', '20']);
    expect(idsOf(inbox)).toEqual(['20', '10']);
    expect(inbox.getState().lastId).toBe('20');
    expect(await inbox.add([note('10'), note('20'), note('30')])).toHaveLength(1);
    expect(await inbox.add([note('5')])).toEqual([]); // lastId(30) 이하
    expect(idsOf(inbox)).toEqual(['30', '20', '10']);
  });

  it('id는 길이 → 사전순으로 견준다(자릿수가 다른 큰 수)', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    await inbox.add([note('9')]);
    expect((await inbox.add([note('10')])).map((i) => i.id)).toEqual(['10']);
    expect(inbox.getState().lastId).toBe('10');
  });

  it('지운(dismiss) 알림은 서버가 다시 줘도 되살아나지 않는다', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    await inbox.add([note('10')]);
    inbox.dismiss('10');
    expect(idsOf(inbox)).toEqual([]);
    expect(await inbox.add([note('10')])).toEqual([]);
  });

  it('읽음 표시: 하나·모두. 이미 읽은 것은 알리지 않는다', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    await inbox.add([note('1'), note('2')]);
    const listener = jest.fn();
    inbox.subscribe(listener);
    inbox.markRead('1');
    expect(inbox.getState().items.map((i) => [i.id, i.read])).toEqual([['2', false], ['1', true]]);
    inbox.markRead('1');
    expect(listener).toHaveBeenCalledTimes(1);
    inbox.markAllRead();
    expect(inbox.getState().items.every((i) => i.read)).toBe(true);
    inbox.markAllRead();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it(`상한(${MAX_INBOX_ITEMS}) 넘으면 오래된 것부터 버리고, 보관 기간(7일)이 지난 것은 버린다`, async () => {
    let clock = Date.parse('2026-11-14T00:00:00Z');
    const inbox = createInbox({ storage: createMemoryStore(), now: () => new Date(clock), maxItems: 3 });
    await inbox.add(['1', '2', '3', '4'].map((id) => note(id)));
    expect(idsOf(inbox)).toEqual(['4', '3', '2']);
    clock += INBOX_TTL_MS;
    await inbox.add([note('5')]);
    expect(idsOf(inbox)).toEqual(['5']);
  });

  it('저장소에 써 두고 다음 실행에서 불러온다(lastId 포함)', async () => {
    const storage = createMemoryStore();
    const first = createInbox({ storage });
    await first.add([note('10'), note('20')]);
    first.markRead('10');
    await flush();
    const second = createInbox({ storage });
    await second.load();
    expect(second.getState()).toMatchObject({ loaded: true, lastId: '20' });
    expect(second.getState().items.map((i) => [i.id, i.read])).toEqual([['20', false], ['10', true]]);
  });

  it('깨진 저장 값·읽기 실패·쓰기 실패에도 던지지 않고 메모리로 동작한다', async () => {
    const broken = createInbox({ storage: createMemoryStore({ [INBOX_KEY]: '{not json' }) });
    await broken.load();
    expect(broken.getState()).toMatchObject({ loaded: true, items: [], lastId: null });
    const partial = createInbox({ storage: createMemoryStore({ [INBOX_KEY]: JSON.stringify({ items: [{ id: 1 }, null], lastId: 'x' }) }) });
    await partial.load();
    expect(partial.getState()).toMatchObject({ items: [], lastId: null });
    const failing = createInbox({
      storage: { getItem: async () => { throw new Error('r'); }, setItem: async () => { throw new Error('w'); }, removeItem: async () => undefined },
    });
    expect(await failing.add([note('1')])).toHaveLength(1);
    await flush();
    expect(idsOf(failing)).toEqual(['1']);
  });

  it('불러오는 중에 담은 것은 저장된 것과 합친다', async () => {
    const storage = createMemoryStore();
    await createInbox({ storage }).add([note('10')]);
    await flush();
    const inbox = createInbox({ storage });
    const adding = inbox.add([note('20')]);
    await inbox.load();
    await adding;
    expect(idsOf(inbox)).toEqual(['20', '10']);
  });

  it('clear는 목록과 lastId를 모두 비우고 저장소에도 반영한다', async () => {
    const storage = createMemoryStore();
    const inbox = createInbox({ storage });
    await inbox.add([note('10')]);
    inbox.clear();
    expect(inbox.getState()).toMatchObject({ items: [], lastId: null });
    await flush();
    const next = createInbox({ storage });
    await next.load();
    expect(next.getState()).toMatchObject({ items: [], lastId: null });
    expect((await inbox.add([note('10')])).length).toBe(1); // lastId를 잊었으니 다시 담긴다
  });
});

describe('폰 알림함: 종류 지우기·건너뛰기·마지막 id 버리기', () => {
  it('dismissKind는 그 종류만 모두 지우고 lastId는 그대로라 지운 알림이 다시 나타나지 않는다. 지울 것이 없으면 알리지 않는다', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    await inbox.add([note('1'), note('2', { kind: 'late-sms' }), note('3')]);
    const listener = jest.fn();
    inbox.subscribe(listener);
    inbox.dismissKind('events-stale');
    expect(idsOf(inbox)).toEqual(['2']);
    expect(inbox.getState().lastId).toBe('3');
    expect(listener).toHaveBeenCalledTimes(1);
    inbox.dismissKind('events-stale');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await inbox.add([note('1'), note('3')])).toEqual([]);
  });

  it('skip에 든 id는 담지도 돌려주지도 않지만 lastId는 넘어간다', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    const added = await inbox.add([note('1'), note('2')], { skip: new Set(['2']) });
    expect(added.map((i) => i.id)).toEqual(['1']);
    expect(idsOf(inbox)).toEqual(['1']);
    expect(inbox.getState().lastId).toBe('2');
    const onlySkipped = createInbox({ storage: createMemoryStore() });
    expect(await onlySkipped.add([note('5')], { skip: new Set(['5']) })).toEqual([]);
    expect(onlySkipped.getState()).toMatchObject({ items: [], lastId: '5' });
  });

  it('resetLastId는 lastId만 잊고 알림은 남긴다. 이미 가진 id는 다시 담지 않고 새 id만 담는다', async () => {
    const storage = createMemoryStore();
    const inbox = createInbox({ storage });
    await inbox.add([note('900')]);
    inbox.resetLastId();
    expect(inbox.getState()).toMatchObject({ lastId: null });
    expect(idsOf(inbox)).toEqual(['900']);
    expect((await inbox.add([note('900'), note('510')])).map((i) => i.id)).toEqual(['510']);
    expect(inbox.getState().lastId).toBe('900');
    await flush();
    const next = createInbox({ storage });
    await next.load();
    expect(next.getState().lastId).toBe('900');
  });
});

describe('useInbox', () => {
  function Probe({ inbox }: { inbox: ReturnType<typeof createInbox> }) {
    const { items, unreadCount, loaded } = useInbox(inbox);
    return <Text testID="out">{`${loaded ? 'loaded' : 'loading'}|${unreadCount}|${items.map((i) => i.title).join(',')}`}</Text>;
  }

  it('알림이 쌓이면 구독한 화면이 다시 그려지고 읽음 수가 줄어든다(권한과 무관하게 홈에서 보인다)', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    await render(<Probe inbox={inbox} />);
    await act(async () => {
      await flush();
    });
    expect(screen.getByTestId('out')).toHaveTextContent('loaded|0|');
    await act(async () => {
      await inbox.add([note('1', { title: '일정을 못 받고 있어요' })]);
    });
    expect(screen.getByTestId('out')).toHaveTextContent('loaded|1|일정을 못 받고 있어요');
    await act(async () => {
      inbox.markRead('1');
    });
    expect(screen.getByTestId('out')).toHaveTextContent('loaded|0|일정을 못 받고 있어요');
  });
});
