import { deviceCalendarSource } from './deviceCalendarSource';
import { mockCalendarSource, type CalendarSource } from './calendarSource';

/**
 * EXPO_PUBLIC_CALENDAR_SOURCE로 캘린더 출처를 고른다. 'mock'이면 목, 그 밖(비어 있음 포함)은 실제 기기 캘린더.
 * 실제 사용자에게 가짜 일정이 보이면 안 되므로 기본은 device이고, 목은 명시했을 때만 쓴다.
 * Expo는 process.env.EXPO_PUBLIC_* 를 빌드 때 값으로 바꾸므로 환경 변수 이름을 그대로 써야 한다.
 */
export const pickCalendarSource = (value: string | undefined): CalendarSource => (value === 'mock' ? mockCalendarSource : deviceCalendarSource);

export const defaultCalendarSource: CalendarSource = pickCalendarSource(process.env.EXPO_PUBLIC_CALENDAR_SOURCE);
