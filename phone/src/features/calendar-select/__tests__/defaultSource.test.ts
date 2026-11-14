import { mockCalendarSource } from '../calendarSource';
import { pickCalendarSource } from '../defaultSource';
import { deviceCalendarSource } from '../deviceCalendarSource';

describe('pickCalendarSource', () => {
  it("'mock'일 때만 목을 쓰고, 비었거나 그 밖의 값은 실제 기기 캘린더다", () => {
    expect(pickCalendarSource('mock')).toBe(mockCalendarSource);
    expect(pickCalendarSource('device')).toBe(deviceCalendarSource);
    expect(pickCalendarSource(undefined)).toBe(deviceCalendarSource);
    expect(pickCalendarSource('')).toBe(deviceCalendarSource);
    expect(pickCalendarSource('Mock')).toBe(deviceCalendarSource);
  });
});
