import { createInbox } from '../../notifications/inbox';
import { createMemoryStore } from '../../../storage/keyValueStore';
import { note } from '../../../__tests__/support/notifications';
import { bindFamilyInboxCleanup } from '../familyInboxCleanup';
import { createMemberSession, type MemberStorage } from '../memberSecret';

const memory = (): MemberStorage => ({ read: async () => null, write: async () => undefined, remove: async () => undefined });
const SECRET = 'm'.repeat(64);
const family = (id: string) => note(id, { kind: 'family-status', data: { requestId: `r${id}`, status: 'completed' } });

const setup = async () => {
  const inbox = createInbox({ storage: createMemoryStore() });
  await inbox.add([family('10'), note('11'), family('12')]);
  const member = createMemberSession(memory());
  const off = bindFamilyInboxCleanup(member, inbox);
  const kinds = () => inbox.getState().items.map((i) => i.id).sort();
  return { inbox, member, off, kinds };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('가족에서 나가면 알림함의 가족 요청 알림을 지운다', () => {
  it('내가 나가(left) 비밀값이 지워지면 family-status만 지우고 다른 알림은 둔다', async () => {
    const { member, kinds } = await setup();
    await member.set(SECRET);
    await settle();
    expect(kinds()).toEqual(['10', '11', '12']);
    await member.clear('left');
    await settle();
    expect(kinds()).toEqual(['11']);
  });

  it('서버가 모르는 구성원(gone)이라 지워져도 같다', async () => {
    const { member, kinds } = await setup();
    await member.set(SECRET);
    await member.clearIfCurrent(SECRET, 'gone');
    await settle();
    expect(kinds()).toEqual(['11']);
  });

  it('앱을 막 연 순간(알림함을 아직 불러오기 전)에 알게 돼도 저장된 알림까지 지운다', async () => {
    const storage = createMemoryStore();
    const seeded = createInbox({ storage });
    await seeded.add([family('10'), note('11')]);
    await settle();
    const inbox = createInbox({ storage }); // 아직 load 안 함
    const member = createMemberSession(memory());
    bindFamilyInboxCleanup(member, inbox);
    await member.set(SECRET);
    await member.clear('gone');
    await settle();
    await inbox.load();
    expect(inbox.getState().items.map((i) => i.id)).toEqual(['11']);
  });

  it('비밀값이 없을 때 지우는 것(알림 없음)과 해제한 뒤에는 아무것도 하지 않는다', async () => {
    const { member, off, kinds } = await setup();
    await member.clear('left');
    await settle();
    expect(kinds()).toEqual(['10', '11', '12']);
    off();
    await member.set(SECRET);
    await member.clear('left');
    await settle();
    expect(kinds()).toEqual(['10', '11', '12']);
  });
});
