import mockDevice from '../../../../fixtures/calendars/mock-device.json';

export type DeviceCalendar = {
  id: string;
  name: string;
  source: string;
  color: string;
  defaultSelected: boolean;
};

/** 기기 캘린더 목록을 읽는 인터페이스. */
export interface CalendarSource {
  list(): Promise<DeviceCalendar[]>;
}

/** 서버도 읽는 fixtures/calendars/mock-device.json을 그대로 쓴다. account는 화면의 보조 문구(source)가 된다. */
export const MOCK_CALENDARS: DeviceCalendar[] = mockDevice.calendars.map(({ id, name, account, color, defaultSelected }) => ({
  id,
  name,
  source: account,
  color,
  defaultSelected,
}));

export const mockCalendarSource: CalendarSource = {
  list: async () => MOCK_CALENDARS.map((c) => ({ ...c })),
};
