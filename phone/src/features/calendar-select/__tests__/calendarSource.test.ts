import { MOCK_CALENDARS, mockCalendarSource } from '../calendarSource';

describe('mockCalendarSource', () => {
  it('fixtures/calendars/mock-device.json의 6개 캘린더를 돌려준다', async () => {
    const list = await mockCalendarSource.list();
    expect(list.map((c) => c.id)).toEqual(['mock-my', 'mock-work', 'mock-family', 'mock-holidays', 'mock-birthdays', 'mock-kia']);
    expect(list[0]).toEqual({ id: 'mock-my', name: '내 캘린더', source: '삼성 계정', color: '#3367d6', defaultSelected: true });
    expect(list.filter((c) => c.defaultSelected)).toHaveLength(3);
  });

  it('호출마다 복사본을 돌려준다', async () => {
    const list = await mockCalendarSource.list();
    list[0].name = '바뀜';
    expect(MOCK_CALENDARS[0].name).toBe('내 캘린더');
  });
});
