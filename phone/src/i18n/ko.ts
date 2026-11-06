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
    saveFailed: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    loadFailed: '캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    retry: '다시 시도',
    loading: '캘린더를 불러오는 중',
    saving: '저장하는 중',
  },
  places: {
    title: '자주 가는 곳',
  },
} as const;

export type Strings = typeof ko;

export const strings: Strings = ko;
