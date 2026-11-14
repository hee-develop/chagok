import { mockContactsSource, pickContactsSource, deviceContactsSource, toContactsPermission } from './contactsSource';

describe('연락처 출처', () => {
  it('EXPO_PUBLIC_CONTACTS_SOURCE=mock일 때만 목이고 그 밖은 실제 기기 연락처다', () => {
    expect(pickContactsSource('mock')).toBe(mockContactsSource);
    expect(pickContactsSource(undefined)).toBe(deviceContactsSource);
    expect(pickContactsSource('')).toBe(deviceContactsSource);
    expect(pickContactsSource('device')).toBe(deviceContactsSource);
  });

  it('목 출처는 권한 창 없이 허용이고 픽스처 연락처를 돌려준다(번호 없는 연락처 포함)', async () => {
    expect(await mockContactsSource.permission()).toBe('granted');
    expect(await mockContactsSource.request()).toBe('granted');
    const list = await mockContactsSource.list();
    expect(list.map((c) => c.name)).toEqual(['김민수', '박서연', '엄마', '김 과장님', '이영희']);
    expect(list.find((c) => c.name === '이영희')!.phones).toEqual([]);
  });

  it('목 목록을 고쳐도 픽스처가 바뀌지 않는다', async () => {
    (await mockContactsSource.list())[0]!.phones.push('010-0000-0000');
    expect((await mockContactsSource.list())[0]!.phones).toEqual(['010-1234-5678']);
  });

  it.each([
    [{ granted: true, canAskAgain: true }, 'granted'],
    [{ granted: false, canAskAgain: true }, 'ask'],
    [{ granted: false, canAskAgain: false }, 'denied'],
  ] as const)('권한 응답 %j → %s', (response, expected) => {
    expect(toContactsPermission(response)).toBe(expected);
  });
});
