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

export type MockPlace = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** 가상으로 만든 장소. 화면과 API 응답에는 내보내지 않는다. */
  fictional?: boolean;
};

export type PlaceSuggestion = MockPlace & { hint: string };

/** 일정 제목으로 기억한 장소. 같은 제목의 장소 없는 일정에 1순위 후보로 낸다. */
export type RememberedPlace = { title: string; placeId: string };

/** 미리 묶어 둔 가족 한 명(시연용 계정). 가족에게 보내기의 받는 사람이다. */
export type FamilyMember = { id: string; name: string };

/** 장소 검색 대상 목록, '캘린더에서 자주 나온 곳' 추천, 일정 제목별 기억한 장소. */
export type PlacesCatalog = {
  places: MockPlace[];
  suggestions: PlaceSuggestion[];
  remembered: RememberedPlace[];
};
