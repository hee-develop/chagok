import { authHeaders, createSession, withSessionReset, type TokenStorage } from '../session';

const memoryStorage = (initial: string | null = null) => {
  let value = initial;
  const storage: TokenStorage & { value: () => string | null } = {
    read: jest.fn(async () => value),
    write: jest.fn(async (token: string) => {
      value = token;
    }),
    remove: jest.fn(async () => {
      value = null;
    }),
    value: () => value,
  };
  return storage;
};

describe('세션(폰 토큰)', () => {
  it('저장소의 토큰을 처음 한 번만 읽어 메모리에 둔다', async () => {
    const storage = memoryStorage('saved');
    const session = createSession(storage);
    expect(await session.getToken()).toBe('saved');
    expect(await session.getToken()).toBe('saved');
    expect(storage.read).toHaveBeenCalledTimes(1);
  });

  it('저장하면 저장소와 메모리가 바뀌고, 지우면 둘 다 비운다', async () => {
    const storage = memoryStorage();
    const session = createSession(storage);
    expect(await session.getToken()).toBeNull();
    await session.setToken('abc');
    expect(await session.getToken()).toBe('abc');
    expect(storage.value()).toBe('abc');
    await session.clearToken();
    expect(await session.getToken()).toBeNull();
    expect(storage.value()).toBeNull();
  });

  it('저장소가 실패해도 이번 실행 동안은 메모리 값으로 동작한다', async () => {
    const broken: TokenStorage = {
      read: jest.fn().mockRejectedValue(new Error('keystore')),
      write: jest.fn().mockRejectedValue(new Error('keystore')),
      remove: jest.fn().mockRejectedValue(new Error('keystore')),
    };
    const session = createSession(broken);
    expect(await session.getToken()).toBeNull();
    await session.setToken('abc');
    expect(await session.getToken()).toBe('abc');
    await session.clearToken();
    expect(await session.getToken()).toBeNull();
  });

  it('불러오는 중에 저장한 토큰이 늦게 도착한 옛 값에 덮이지 않는다', async () => {
    let resolveRead: (v: string | null) => void = () => undefined;
    const storage: TokenStorage = {
      read: () => new Promise((resolve) => (resolveRead = resolve)),
      write: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const session = createSession(storage);
    const pending = session.getToken();
    await session.setToken('new');
    resolveRead('old');
    expect(await pending).toBe('new');
    expect(await session.getToken()).toBe('new');
  });

  it('요청 헤더는 토큰이 있을 때만 Authorization: Bearer를 붙인다', async () => {
    const session = createSession(memoryStorage());
    expect(await authHeaders(session)()).toEqual({});
    await session.setToken('abc');
    expect(await authHeaders(session)()).toEqual({ authorization: 'Bearer abc' });
  });
});

describe('withSessionReset', () => {
  const respond = (status: number) => jest.fn(async () => new Response(null, { status }));

  it('보낸 토큰이 401이면 그 토큰을 버린다', async () => {
    const session = createSession(memoryStorage('stale'));
    const fetcher = withSessionReset(session, respond(401));
    await fetcher('http://x/events', { headers: { authorization: 'Bearer stale' } });
    expect(await session.getToken()).toBeNull();
  });

  it('그 사이 새 토큰으로 바뀌었으면 오래된 요청의 401은 새 토큰을 지우지 않는다', async () => {
    const session = createSession(memoryStorage('stale'));
    const fetcher = withSessionReset(session, respond(401));
    await session.setToken('fresh');
    await fetcher('http://x/events', { headers: { authorization: 'Bearer stale' } });
    expect(await session.getToken()).toBe('fresh');
  });

  it('토큰 없이 보낸 요청의 401이나 다른 오류는 토큰을 건드리지 않는다', async () => {
    const session = createSession(memoryStorage('keep'));
    await withSessionReset(session, respond(401))('http://x/events');
    await withSessionReset(session, respond(500))('http://x/events', { headers: { authorization: 'Bearer keep' } });
    expect(await session.getToken()).toBe('keep');
  });
});
