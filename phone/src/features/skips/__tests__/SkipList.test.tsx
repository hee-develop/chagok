import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import { createTravelExceptions, type KeyValueStorage } from '../../calendar-sync/travelExceptions';
import { SkipList } from '../SkipList';
import { createSkipMemory, type SkipMemory } from '../skipMemory';
import type { SkipChange, SkipEntry, SkipsApi } from '../skipsApi';

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const storage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
};
const norm = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase();

const setup = (initial: string[]) => {
  let list: SkipEntry[] = initial.map((name) => ({ name, addedAt: '2026-11-11T01:00:00.000Z' }));
  const state = { down: false, reject: null as number | null };
  const change = jest.fn(async (c: SkipChange) => {
    if (state.down) throw new Error('network');
    if (state.reject !== null) throw new HttpError(state.reject, `PUT /skips ${state.reject}`);
    const remove = new Set((c.remove ?? []).map(norm));
    list = list.filter((e) => !remove.has(norm(e.name)));
    for (const name of c.add ?? []) if (!list.some((e) => norm(e.name) === norm(name))) list = [{ name, addedAt: '2026-11-11T02:00:00.000Z' }, ...list];
    return list;
  });
  const api: SkipsApi = {
    fetch: jest.fn(async () => {
      if (state.down) throw new Error('network');
      return list;
    }),
    change,
  };
  const memory = createSkipMemory({ api, storage: storage(), exceptions: createTravelExceptions(storage()), timeoutMs: 1000, loadTimeoutMs: 100, log: jest.fn() });
  return { memory, state, change, names: () => list.map((e) => e.name) };
};
const renderList = async (memory: SkipMemory, onChanged = jest.fn()) => {
  await render(<SafeAreaProvider initialMetrics={insets}><SkipList memory={memory} onChanged={onChanged} /></SafeAreaProvider>);
  return onChanged;
};

describe('SkipList (정책서 10.8 이동 없음 목록)', () => {
  it('서버 목록을 불러와 이름을 보인다', async () => {
    const { memory } = setup(['KIA 직관', '치과']);
    await renderList(memory);
    expect(await screen.findByText('KIA 직관')).toBeOnTheScreen();
    expect(screen.getByText('치과')).toBeOnTheScreen();
    expect(screen.queryByText('이동 없음으로 기억한 일정이 없어요.')).toBeNull();
  });

  it('비어 있으면 안내를 보인다', async () => {
    const { memory } = setup([]);
    await renderList(memory);
    expect(await screen.findByText('이동 없음으로 기억한 일정이 없어요.')).toBeOnTheScreen();
  });

  it('[지우기]를 누르면 목록에서 빠지고 서버에서 지워지며 일정을 다시 보내도록 알린다', async () => {
    const { memory, change, names } = setup(['KIA 직관', '치과']);
    const onChanged = await renderList(memory);
    await fireEvent.press(await screen.findByRole('button', { name: 'KIA 직관 이동 없음 지우기' }));
    await waitFor(() => expect(screen.queryByText('KIA 직관')).toBeNull());
    expect(change).toHaveBeenCalledWith({ remove: ['kia 직관'] }, expect.any(AbortSignal));
    expect(names()).toEqual(['치과']);
    expect(screen.getByText('치과')).toBeOnTheScreen();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('서버에 닿지 않으면 지운 것을 되돌리고 안내한다(차에는 계속 걸러지고 있기 때문)', async () => {
    const { memory, state } = setup(['KIA 직관']);
    const onChanged = await renderList(memory);
    const remove = await screen.findByRole('button', { name: 'KIA 직관 이동 없음 지우기' });
    state.down = true;
    await fireEvent.press(remove);
    expect(await screen.findByText('지우지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.getByText('KIA 직관')).toBeOnTheScreen();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('목록을 새로 받지 못하면 저장해 둔 목록을 보이고 다시 시도할 수 있다', async () => {
    const { memory, state } = setup(['KIA 직관']);
    await memory.sync(); // 이전에 받아 캐시해 둠
    state.down = true;
    await renderList(memory);
    expect(await screen.findByText('목록을 새로 받지 못했어요. 저장해 둔 목록을 보여 드려요.')).toBeOnTheScreen();
    expect(screen.getByText('KIA 직관')).toBeOnTheScreen();
    state.down = false;
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(screen.queryByText(/새로 받지 못했어요/)).toBeNull());
  });

  it('서버에 아직 올리지 못한 이름은 그렇게 표시한다', async () => {
    const { memory, state } = setup([]);
    state.down = true;
    await memory.add('콩물 픽업');
    await renderList(memory);
    expect(await screen.findByText('콩물 픽업')).toBeOnTheScreen();
    expect(screen.getByText('아직 서버에 올리지 못했어요')).toBeOnTheScreen();
  });

  it('다른 곳에서 기억이 바뀌면 바로 반영된다', async () => {
    const { memory } = setup([]);
    await renderList(memory);
    expect(await screen.findByText('이동 없음으로 기억한 일정이 없어요.')).toBeOnTheScreen();
    await act(async () => memory.add('치과'));
    expect(await screen.findByText('치과')).toBeOnTheScreen();
  });

  it('서버가 기억 상한이라고 거절한 적이 있으면 가득 참을 알리고 [확인]으로 닫는다', async () => {
    const { memory, state } = setup(['KIA 직관']);
    state.reject = 409;
    await memory.add('새 일정');
    await memory.sync();
    state.reject = null;
    await renderList(memory);
    expect(await screen.findByText(/이동 없음으로 기억할 수 있는 일정 이름이 가득 찼어요/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '확인' }));
    await waitFor(() => expect(screen.queryByText(/가득 찼어요/)).toBeNull());
  });
});
