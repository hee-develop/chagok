import { authHeaders, createSession, DEVICE_HEADER, newDeviceId, withSessionReset, type DeviceStorage, type TokenStorage } from '../session';

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

  it('요청 헤더는 기기 id를 늘 붙이고, 토큰이 있을 때만 Authorization: Bearer를 더한다', async () => {
    const session = createSession(memoryStorage(), memoryDevice(), () => 'd'.repeat(32));
    expect(await authHeaders(session)()).toEqual({ [DEVICE_HEADER]: 'd'.repeat(32) });
    await session.setToken('abc');
    expect(await authHeaders(session)()).toEqual({ authorization: 'Bearer abc', [DEVICE_HEADER]: 'd'.repeat(32) });
  });
});

const memoryDevice = (initial: string | null = null) => {
  let value = initial;
  const storage: DeviceStorage & { value: () => string | null } = {
    read: jest.fn(async () => value),
    write: jest.fn(async (id: string) => {
      value = id;
    }),
    value: () => value,
  };
  return storage;
};

describe('기기 id', () => {
  it('처음 한 번 만들어 저장하고, 다시 열어도(새 세션) 같은 id를 쓴다', async () => {
    const storage = memoryDevice();
    const first = await createSession(memoryStorage(), storage, () => 'a1'.repeat(16)).getDeviceId();
    expect(first).toBe('a1'.repeat(16));
    expect(storage.value()).toBe(first);
    const second = await createSession(memoryStorage(), storage, () => 'zz'.repeat(16)).getDeviceId();
    expect(second).toBe(first);
  });

  it('동시에 불러도 id는 하나만 만들고, 저장된 값이 모양이 이상하면 새로 만든다', async () => {
    const make = jest.fn(() => 'b2'.repeat(16));
    const session = createSession(memoryStorage(), memoryDevice('bad id!'), make);
    const ids = await Promise.all([session.getDeviceId(), session.getDeviceId(), session.getDeviceId()]);
    expect(new Set(ids)).toEqual(new Set(['b2'.repeat(16)]));
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('저장소가 실패해도 이번 실행 동안은 같은 id를 쓴다', async () => {
    const broken: DeviceStorage = { read: jest.fn().mockRejectedValue(new Error('keystore')), write: jest.fn().mockRejectedValue(new Error('keystore')) };
    const session = createSession(memoryStorage(), broken, () => 'c3'.repeat(16));
    expect(await session.getDeviceId()).toBe('c3'.repeat(16));
    expect(await session.getDeviceId()).toBe('c3'.repeat(16));
  });

  it('저장된 id를 읽지 못하면 덮어쓰지 않고 이번 실행 동안만 메모리 id를 쓰며, 다음 실행에서 다시 읽는다', async () => {
    let failing = true;
    let stored: string | null = 'f6'.repeat(16);
    const flaky: DeviceStorage = {
      read: jest.fn(async () => {
        if (failing) throw new Error('keystore locked');
        return stored;
      }),
      write: jest.fn(async (id: string) => {
        stored = id;
      }),
    };
    const run1 = createSession(memoryStorage(), flaky, () => 'e5'.repeat(16));
    expect(await run1.getDeviceId()).toBe('e5'.repeat(16));
    expect(await run1.getDeviceId()).toBe('e5'.repeat(16));
    expect(flaky.write).not.toHaveBeenCalled();
    expect(stored).toBe('f6'.repeat(16)); // 저장된 id는 그대로
    failing = false;
    expect(await createSession(memoryStorage(), flaky, () => 'e5'.repeat(16)).getDeviceId()).toBe('f6'.repeat(16)); // 다음 실행에서 다시 읽는다
  });

  it('EXPO_PUBLIC_DEVICE_ID=none은 개발 번들(__DEV__)에서만 기기 id를 끈다', async () => {
    const original = process.env.EXPO_PUBLIC_DEVICE_ID;
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    process.env.EXPO_PUBLIC_DEVICE_ID = 'none';
    try {
      (globalThis as { __DEV__?: boolean }).__DEV__ = true;
      expect(await createSession(memoryStorage(), memoryDevice(), () => 'a1'.repeat(16)).getDeviceId()).toBeNull();
      (globalThis as { __DEV__?: boolean }).__DEV__ = false; // 릴리스 번들
      expect(await createSession(memoryStorage(), memoryDevice(), () => 'a1'.repeat(16)).getDeviceId()).toBe('a1'.repeat(16));
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
      if (original === undefined) delete process.env.EXPO_PUBLIC_DEVICE_ID;
      else process.env.EXPO_PUBLIC_DEVICE_ID = original;
    }
  });

  it('만드는 id는 서버가 받는 모양(영문·숫자 22~64자)의 암호학적 난수이고 매번 다르다', () => {
    const a = newDeviceId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(newDeviceId()).not.toBe(a);
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

  it('토큰 없이 보낸 요청의 401이나 다른 오류는 토큰을 건드리지 않고 다시 보내지도 않는다', async () => {
    const session = createSession(memoryStorage('keep'));
    const noToken = respond(401);
    await withSessionReset(session, noToken)('http://x/events');
    const serverError = respond(500);
    await withSessionReset(session, serverError)('http://x/events', { headers: { authorization: 'Bearer keep' } });
    expect(await session.getToken()).toBe('keep');
    expect(noToken).toHaveBeenCalledTimes(1);
    expect(serverError).toHaveBeenCalledTimes(1);
  });

  it('401로 토큰을 버린 뒤 같은 요청을 토큰 없이(기기 id는 그대로) 한 번 다시 보내고 그 응답을 돌려준다', async () => {
    const session = createSession(memoryStorage('stale'));
    const seen: { auth: string | null; device: string | null; body: unknown }[] = [];
    const server = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ auth: headers.get('authorization'), device: headers.get(DEVICE_HEADER), body: init?.body });
      return new Response(null, { status: headers.get('authorization') ? 401 : 200 });
    });
    const res = await withSessionReset(session, server)('http://x/events', {
      method: 'PUT',
      body: '{"events":[]}',
      headers: { authorization: 'Bearer stale', [DEVICE_HEADER]: 'd'.repeat(32) },
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([
      { auth: 'Bearer stale', device: 'd'.repeat(32), body: '{"events":[]}' },
      { auth: null, device: 'd'.repeat(32), body: '{"events":[]}' },
    ]);
    expect(await session.getToken()).toBeNull();
  });

  it('다시 보낸 요청도 401이면 그대로 돌려주고 더 보내지 않는다', async () => {
    const session = createSession(memoryStorage('stale'));
    const server = respond(401);
    const res = await withSessionReset(session, server)('http://x/pair', { headers: { authorization: 'Bearer stale' } });
    expect(res.status).toBe(401);
    expect(server).toHaveBeenCalledTimes(2);
  });

  it('그 사이 새 토큰으로 바뀌었으면 다시 보낼 때 새 토큰을 쓴다', async () => {
    const session = createSession(memoryStorage('stale'));
    await session.setToken('fresh');
    const auths: (string | null)[] = [];
    const server = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      auths.push(auth);
      return new Response(null, { status: auth === 'Bearer stale' ? 401 : 200 });
    });
    const res = await withSessionReset(session, server)('http://x/events', { headers: { authorization: 'Bearer stale' } });
    expect(res.status).toBe(200);
    expect(auths).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('스트림 본문은 한 번 읽으면 끝이라 다시 보내지 않는다', async () => {
    const session = createSession(memoryStorage('stale'));
    const server = respond(401);
    const body = new ReadableStream();
    const res = await withSessionReset(session, server)('http://x/events', { method: 'PUT', body, headers: { authorization: 'Bearer stale' } });
    expect(res.status).toBe(401);
    expect(server).toHaveBeenCalledTimes(1);
    expect(await session.getToken()).toBeNull();
  });
});
