/** `alias`는 말·버튼에 쓰는 짧은 이름(예: 광주-기아 챔피언스필드 → 챔필). 없으면 차는 `name`을 쓴다. */
export type PlaceFixture = { name: string; alias?: string; lat: number; lng: number };

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
  /**
   * 고정 기준 시각(오프셋 있는 ISO8601). 있으면 이 픽스처의 일정 시각은 요청 시각(at)·서버 시계와 상관없이 늘 이 시각 기준이다.
   * PT 시연처럼 폰(기준 시각을 보내지 않음)과 차(데모 시계)가 같은 시각을 봐야 할 때 쓴다. 없으면 요청의 at, 그것도 없으면 서버 시계.
   */
  anchor?: string;
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
  /** 말·버튼에 쓰는 짧은 이름. 없으면 `name`. 일정 장소(`PlaceFixture.alias`)로 그대로 내려간다. */
  alias?: string;
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
