import type { Category, PatchableStatus } from './requests.js';

/**
 * 폰 알림함(`family-status`)에 넣는 문구. 요청 상태 화면의 문구는 폰이 상태 코드와 카테고리로 정하지만(정책서 10.10 '보낸 사람 폰' 열),
 * 알림은 서버가 글자를 만들어 보내야 해서 같은 표를 따른다. 문구는 가안이고 폰 가족 탭 묶음과 맞춘다.
 */
export const CATEGORY_LABEL: Record<Category, string> = {
  care: '채비',
  stop: '들르기',
  appointment: '약속 가기',
  ride: '데려다주기·픽업',
};

/** 알림 제목: "엄마에게 보낸 들르기", "우리 차에 보낸 들르기". */
export const statusTitle = (category: Category, recipient: { kind: 'member'; name: string } | { kind: 'car' }) =>
  `${recipient.kind === 'member' ? `${recipient.name}에게` : '우리 차에'} 보낸 ${CATEGORY_LABEL[category]}`;

/**
 * 알림 본문. 거절은 '이번엔 어려워요'만(이유·답장 없음). 수락은 들르기·픽업이 '수락했어요', 약속이 '출발했어요'(정책서 10.10 표).
 * 완료는 들르기 '들렀어요', 약속·픽업 '도착했어요', 채비는 하차 체크에서 말했을 때라 '챙기라고 전했어요'.
 */
export const statusBody = (category: Category, status: PatchableStatus): string => {
  switch (status) {
    case 'delivered':
      return '전달했어요';
    case 'accepted':
      return category === 'appointment' ? '출발했어요' : '수락했어요';
    case 'declined':
      return '이번엔 어려워요';
    case 'completed':
      return category === 'care' ? '챙기라고 전했어요' : category === 'stop' ? '들렀어요' : '도착했어요';
  }
};

/** 도착 5분 전(약속·픽업, 도착 예정 공유를 켠 경우). 픽업은 '곧 도착해요'(정책서 10.10 표), 약속은 5분 뒤 도착을 알린다. */
export const soonBody = (category: Category) => (category === 'ride' ? '곧 도착해요' : '5분 뒤 도착해요');
