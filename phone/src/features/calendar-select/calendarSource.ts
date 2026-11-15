import mockDevice from '../../../../fixtures/calendars/mock-device.json';

export type DeviceCalendar = {
  id: string;
  name: string;
  source: string;
  color: string;
  defaultSelected: boolean;
};

/** 서버(PUT /events)로 보내는 일정 한 건. 시각은 ISO8601(UTC), 장소 칸·메모·참석자 이름만 담는다. */
export type DeviceEvent = {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  locationText: string | null;
  notes: string | null;
  attendees: string[];
  /** 참석자 이메일(소문자). **폰 안에서 연락 상대를 찾는 데만 쓰고 서버로 보내지 않는다**(`docs/contacts.md`). */
  attendeeEmails?: string[];
  /** 사용자가 "이동 일정이에요"로 바꾼 같은 이름 일정. 서버의 이동 없음 안전망을 건너뛰게 한다(없으면 적용). */
  travelConfirmed?: boolean;
};

/** 캘린더 읽기 권한이 없을 때 던진다. 목 캘린더로 대신하지 않고 화면이 안내한다. */
export class CalendarPermissionError extends Error {
  /** 시스템 권한 창을 다시 띄울 수 있는가. false면 설정에서 직접 허용해야 한다. */
  readonly canAskAgain: boolean;

  constructor(canAskAgain: boolean) {
    super('캘린더 권한이 없습니다');
    this.name = 'CalendarPermissionError';
    this.canAskAgain = canAskAgain;
    Object.setPrototypeOf(this, CalendarPermissionError.prototype);
  }
}

/** 기기 캘린더를 읽는 인터페이스. 목(mock)은 테스트·E2E용, 실제(device)는 Android Calendar Provider. */
export interface CalendarSource {
  /** 'mock'이면 서버로 일정을 보내지 않는다(서버는 픽스처를 그대로 쓴다). */
  readonly kind: 'mock' | 'device';
  /** 캘린더 목록. 권한이 없으면 요청하고, 끝내 못 얻으면 CalendarPermissionError를 던진다. */
  list(): Promise<DeviceCalendar[]>;
  /** 고른 캘린더의 오늘·내일(서울) 일정. 권한 창은 띄우지 않고, 권한이 없으면 CalendarPermissionError. */
  listEvents(calendarIds: string[], now?: Date): Promise<DeviceEvent[]>;
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
  kind: 'mock',
  listEvents: async () => [],
  list: async () => MOCK_CALENDARS.map((c) => ({ ...c })),
};
