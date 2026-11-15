import { createMemoryStore } from '../../../storage/keyValueStore';
import { note } from '../../../__tests__/support/notifications';
import { createInbox, dropEta, INBOX_KEY } from '../inbox';

const eta = (id: string) => note(id, { kind: 'family-status', title: '엄마에게 보낸 픽업', body: '곧 도착해요', data: { requestId: 'r1', category: 'ride', status: 'accepted', stage: 'soon', etaAt: '2026-11-06T09:25:00.000Z' } });

describe('알림함은 도착 예정 시각(etaAt)을 두지 않는다(정책 11장: 가족에게 보인 도착 예정 시각은 저장하지 않음)', () => {
  it('dropEta는 etaAt만 버리고 나머지 data는 그대로 둔다', () => {
    const item = dropEta({ data: { requestId: 'r1', etaAt: 'x', stage: 'soon' } });
    expect(item.data).toEqual({ requestId: 'r1', stage: 'soon' });
    const same = { data: { requestId: 'r1' } };
    expect(dropEta(same)).toBe(same);
  });

  it('담을 때 etaAt을 버려 메모리와 저장소(AsyncStorage) 어디에도 남지 않는다. 알림 누름에 쓰는 requestId는 남는다', async () => {
    const storage = createMemoryStore();
    const inbox = createInbox({ storage });
    const added = await inbox.add([eta('10')]);
    expect(added[0]!.data).toEqual({ requestId: 'r1', category: 'ride', status: 'accepted', stage: 'soon' });
    expect(inbox.getState().items[0]!.data).not.toHaveProperty('etaAt');
    await new Promise((r) => setTimeout(r, 0));
    expect(storage.dump()[INBOX_KEY]).not.toContain('etaAt');
    expect(storage.dump()[INBOX_KEY]).toContain('r1');
  });

  it('옛 버전이 저장해 둔 etaAt은 불러올 때 지우고 저장소에도 다시 쓴다', async () => {
    const stored = { ...eta('10'), receivedAt: new Date().toISOString(), read: false };
    const storage = createMemoryStore({ [INBOX_KEY]: JSON.stringify({ v: 1, items: [stored], lastId: '10' }) });
    const inbox = createInbox({ storage });
    await inbox.load();
    expect(inbox.getState().items[0]!.data).not.toHaveProperty('etaAt');
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(storage.dump()[INBOX_KEY]!).items[0].data).not.toHaveProperty('etaAt');
  });
});
