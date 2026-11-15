import { createInbox } from '../../notifications/inbox';
import { handleNotificationTap, registerTapHandler } from '../../notifications/taps';
import { createMemoryStore } from '../../../storage/keyValueStore';
import { createFamilyStatusTapHandler, familyRequestPath, FAMILY_STATUS_KIND } from '../familyTaps';
import { note } from '../../../__tests__/support/notifications';

describe('family-status 알림 누름', () => {
  it('종류 이름은 서버 알림 종류와 같다', () => {
    expect(FAMILY_STATUS_KIND).toBe('family-status');
  });

  it('data.requestId가 있으면 가족 탭에서 그 요청의 상태를 연다', async () => {
    const navigate = jest.fn();
    await createFamilyStatusTapHandler(navigate)({ id: '7', kind: 'family-status', data: { requestId: 'req-9', category: 'stop', status: 'accepted' } });
    expect(navigate).toHaveBeenCalledWith({ pathname: '/family', params: { request: 'req-9' } });
  });

  it('요청 id가 없으면 가족 탭만 연다', async () => {
    const navigate = jest.fn();
    await createFamilyStatusTapHandler(navigate)({ id: '7', kind: 'family-status', data: {} });
    expect(navigate).toHaveBeenCalledWith('/family');
    expect(familyRequestPath('')).toBe('/family');
  });

  it('알림을 누르면 읽음으로 하고 처리기를 불러 그 요청 화면으로 간다(handleNotificationTap 경로)', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    await inbox.add([note('21', { kind: 'family-status', data: { requestId: 'req-3', status: 'completed' } })]);
    const navigate = jest.fn();
    const off = registerTapHandler(FAMILY_STATUS_KIND, createFamilyStatusTapHandler(navigate));
    await handleNotificationTap({ id: '21', kind: 'family-status', data: { requestId: 'req-3', status: 'completed' } }, inbox);
    expect(navigate).toHaveBeenCalledWith({ pathname: '/family', params: { request: 'req-3' } });
    expect(inbox.getState().items.map((i) => [i.id, i.read])).toEqual([['21', true]]);
    off();
  });

  it('이동에 실패해도 앱이 깨지지 않는다(누름 처리 실패는 조용히 넘어간다)', async () => {
    const off = registerTapHandler(FAMILY_STATUS_KIND, createFamilyStatusTapHandler(() => { throw new Error('router'); }));
    await expect(handleNotificationTap({ id: '', kind: 'family-status', data: { requestId: 'x' } }, createInbox({ storage: createMemoryStore() }))).resolves.toBeUndefined();
    off();
  });
});
