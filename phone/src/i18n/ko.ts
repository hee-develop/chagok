const SAVE_FAILED = '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
const RETRY = '다시 시도';

export const ko = {
  setup: {
    stepOf: (step: number, total: number) => `${step} / ${total}`,
    logoLabel: '차곡',
  },
  calendarSelect: {
    title: '캘린더를 골라 주세요',
    description: '고른 캘린더의 일정만 차에 보내요.',
    readOnlyNotice: '일정은 읽기만 해요. 온라인 회의나 회의실 일정은 걸러서 차에 보내지 않아요.',
    connect: (count: number) => `캘린더 ${count}개 연결하기`,
    later: '나중에 할게요',
    saveFailed: SAVE_FAILED,
    loadFailed: '캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    retry: RETRY,
    loading: '캘린더를 불러오는 중',
    saving: '저장하는 중',
  },
  places: {
    title: '자주 가는 곳을 알려주세요',
    description: '일정이 없는 날 "어디로 갈까요?"라고 물을 때 바로 후보로 보여드려요.',
    home: '집',
    work: '회사',
    homeAddressPlaceholder: '[집 주소]',
    workAddressPlaceholder: '[회사 주소]',
    suggestionsHeading: '캘린더에서 자주 나온 곳',
    add: '추가',
    addLabel: (name: string) => `${name} 추가`,
    addManually: '+ 장소 직접 추가',
    addManuallyLabel: '장소 직접 추가',
    addressUnset: '주소 미설정',
    openSearchHint: '장소 검색 화면으로 이동',
    next: '다음',
    skip: '건너뛰기',
    loadFailed: '장소를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    saveFailed: SAVE_FAILED,
    retry: RETRY,
    loading: '장소를 불러오는 중',
    saving: '저장하는 중',
  },
  placeSearch: {
    titleHome: '집 주소 찾기',
    titleWork: '회사 주소 찾기',
    titleOther: '장소 찾기',
    inputLabel: '장소 검색',
    inputPlaceholder: '장소 이름이나 주소로 검색',
    searching: '장소를 찾는 중',
    noResults: '검색 결과가 없어요',
    searchFailed: '장소를 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    saveFailed: SAVE_FAILED,
    retry: RETRY,
    saving: '저장하는 중',
    cancel: '취소',
  },
  fillPlaces: {
    title: '장소가 빈 일정이 2개 있어요',
  },
} as const;

export type Strings = typeof ko;

export const strings: Strings = ko;
