import { appEventSync } from '../calendar-sync/eventSync';
import { appFilteredEvents } from '../calendar-sync/filteredEvents';
import { appInbox } from '../notifications/inbox';
import { appPoller } from '../notifications/poller';

/**
 * 차 연결을 끊은 뒤 폰이 비워야 할 **로컬 상태**를 한 함수(`clearLocalCarState`)로 모은다(정책서 10.9: 자리의 기억은 서버에서 지워지고, 폰에는 그 자리의 흔적이 남지 않아야 한다).
 * 폰 토큰은 `pairingApi.disconnect`가 `session.clearToken()`으로 지운다. 여기서는 그 밖의 것을 지운다.
 *
 * - 알림함: 받은 알림과 `lastId`(다른 자리의 알림과 섞이지 않게). 토큰이 지워질 때 `useNotifications`가 이미 비우지만, 훅이 안 떠 있어도 비워지도록 여기서도 부른다(여러 번 불려도 안전).
 * - 알림 폴링: 진행 중인 요청을 멈춘다(옛 자리의 늦은 응답이 방금 비운 알림함을 다시 채우지 않게).
 * - 일정 보내기 기억: 직전에 보낸 내용·기억해 둔 캘린더 선택(`EventSync.reset`). 새 자리에 옛 선택을 다시 저장하지 않게 한다.
 * - 거른 일정 목록: 폰 안에만 있는 '이동 아님으로 거른 일정' 캐시.
 *
 * 지우지 않는 것: 폰 기기 id(이 앱 설치 하나를 가리키는 난수), 알림 권한을 물은 기록, '이동 일정이에요' 이름 목록(이 폰 사용자의 취향이고 자리에 묶이지 않는다),
 * 캘린더 읽기 권한.
 * 각 단계는 따로 실패를 삼킨다(한 단계가 던져도 나머지는 비운다).
 */
export type LocalCarState = {
  clearInbox(): void;
  stopPolling(): void;
  resetEventSync(): void;
  clearFilteredEvents(): void;
};

const appState: LocalCarState = {
  clearInbox: () => appInbox.clear(),
  stopPolling: () => appPoller.stop(),
  resetEventSync: () => appEventSync.reset(),
  clearFilteredEvents: () => appFilteredEvents.set([]),
};

export function clearLocalCarState(state: LocalCarState = appState): void {
  for (const step of [() => state.stopPolling(), () => state.clearInbox(), () => state.resetEventSync(), () => state.clearFilteredEvents()]) {
    try {
      step();
    } catch {
      // 한 단계의 실패가 나머지를 막지 않는다.
    }
  }
}
