import { createMemberSession, type MemberEvent, type MemberStorage } from '../memberSecret';

const SECRET = 'm'.repeat(64);
const OTHER = 'n'.repeat(64);

const memory = (initial: string | null = null): MemberStorage & { value: () => string | null } => {
  let value = initial;
  return { read: async () => value, write: async (t) => void (value = t), remove: async () => void (value = null), value: () => value };
};

describe('구성원 비밀값 저장', () => {
  it('저장한 값을 처음 읽을 때 한 번 불러오고, 저장·지우기가 저장소에 반영된다', async () => {
    const storage = memory(SECRET);
    const read = jest.spyOn(storage, 'read');
    const session = createMemberSession(storage);
    expect(await session.get()).toBe(SECRET);
    expect(await session.get()).toBe(SECRET);
    expect(read).toHaveBeenCalledTimes(1);
    await session.set(OTHER);
    expect(storage.value()).toBe(OTHER);
    expect(await session.get()).toBe(OTHER);
    await session.clear('left');
    expect(storage.value()).toBeNull();
    expect(await session.get()).toBeNull();
  });

  it('값이 없거나 모양이 이상하거나(서버가 400으로 거절할 값) 저장소를 읽지 못하면 없는 것으로 본다', async () => {
    expect(await createMemberSession(memory()).get()).toBeNull();
    expect(await createMemberSession(memory('짧은 값!')).get()).toBeNull();
    const broken: MemberStorage = { read: () => { throw new Error('keystore'); }, write: async () => undefined, remove: async () => undefined };
    expect(await createMemberSession(broken).get()).toBeNull();
    // undefined를 돌려주는 막힌 환경도 없는 값이다
    expect(await createMemberSession({ read: async () => undefined as unknown as null, write: async () => undefined, remove: async () => undefined }).get()).toBeNull();
  });

  it('저장소에 쓰지 못해도 이번 실행 동안은 메모리 값으로 동작한다', async () => {
    const session = createMemberSession({ read: async () => null, write: () => { throw new Error('full'); }, remove: async () => { throw new Error('full'); } });
    await session.set(SECRET);
    expect(await session.get()).toBe(SECRET);
    await session.clear('gone');
    expect(await session.get()).toBeNull();
  });

  it('값이 생기고 지워질 때마다 이유와 함께 알린다. 값이 없을 때 지우는 것은 알리지 않는다', async () => {
    const session = createMemberSession(memory());
    const events: MemberEvent[] = [];
    const off = session.subscribe((e) => events.push(e));
    await session.clear('gone');
    expect(events).toEqual([]);
    await session.set(SECRET);
    await session.clear('left');
    await session.set(OTHER);
    await session.clear('gone');
    expect(events).toEqual([{ type: 'set', persisted: true }, { type: 'cleared', reason: 'left' }, { type: 'set', persisted: true }, { type: 'cleared', reason: 'gone' }]);
    off();
    await session.set(SECRET);
    expect(events).toHaveLength(4);
  });

  it('저장소에 쓰지 못하면 메모리에는 두되 persisted: false로 알린다(화면이 안내한다)', async () => {
    const session = createMemberSession({ read: async () => null, write: () => { throw new Error('keystore'); }, remove: async () => undefined });
    const events: MemberEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.set(SECRET);
    expect(await session.get()).toBe(SECRET);
    expect(events).toEqual([{ type: 'set', persisted: false }]);
  });

  it('오래된 요청의 401이 새로 받은 값을 지우지 않는다(현재 값일 때만 지운다)', async () => {
    const session = createMemberSession(memory(SECRET));
    await session.set(OTHER);
    await session.clearIfCurrent(SECRET, 'gone');
    expect(await session.get()).toBe(OTHER);
    await session.clearIfCurrent(OTHER, 'gone');
    expect(await session.get()).toBeNull();
  });

  it('리스너가 던져도 저장과 지우기는 끝난다', async () => {
    const storage = memory();
    const session = createMemberSession(storage);
    session.subscribe(() => { throw new Error('listener'); });
    await session.set(SECRET);
    expect(storage.value()).toBe(SECRET);
    await session.clear('left');
    expect(storage.value()).toBeNull();
  });
});
