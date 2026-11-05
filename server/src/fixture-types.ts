export type PlaceFixture = { name: string; lat: number; lng: number };

export type ScheduleFixture = {
  id: string;
  calendarId: string;
  title: string;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
  allDay: boolean;
  locationText: string | null;
  place: PlaceFixture | null;
  memo: string | null;
  attendees: string[];
};

export type DayFixture = {
  id: string;
  name: string;
  schedules: ScheduleFixture[];
};

export type MockCalendar = {
  id: string;
  name: string;
  account: string;
  color: string;
  defaultSelected: boolean;
};
