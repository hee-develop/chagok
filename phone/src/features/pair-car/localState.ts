import { session as appSession, type Session } from '../../api/session';
import { appEventSync } from '../calendar-sync/eventSync';
import { appCorrectedPlaces } from '../calendar-sync/correctedPlaces';
import { appFilteredEvents } from '../calendar-sync/filteredEvents';
import { appInbox } from '../notifications/inbox';
import { appPoller } from '../notifications/poller';
import { appSkipMemory } from '../skips/skipMemory';

/**
 * 차 연결을 끊은 뒤 폰이 비워야 할 **로컬 상태**를 한 함수(`clearLocalCarState`)로 모은다(정책서 10.9: 자리의 기억은 서버에서 지워지고, 폰에는 그 자리의 흔적이 남지 않아야 한다).
 * 폰 토큰은 `pairingApi.disconnect`가 `session.clearToken()`으로 지운다. 여기서는 그 밖의 것을 지운다.
 *
 * - 알림함: 받은 알림과 `lastId`(다른 자리의 알림과 섞이지 않게). 토큰이 지워질 때 `useNotifications`가 이미 비우지만, 훅이 안 떠 있어도 비워지도록 여기서도 부른다(여러 번 불려도 안전).
 * - 알림 폴링: 진행 중인 요청을 멈춘다(옛 자리의 늦은 응답이 방금 비운 알림함을 다시 채우지 않게).
 * - 일정 보내기 기억: 직전에 보낸 내용·기억해 둔 캘린더 선택(`EventSync.reset`). 새 자리에 옛 선택을 다시 저장하지 않게 한다.
 * - 거른 일정 목록: 폰 안에만 있는 '이동 아님으로 거른 일정' 캐시.
 * - 이동 없음 기억 캐시와 올리지 못한 변경(`skipMemory.reset`: 서버도 그 자리의 기억을 지웠고, 도는 중이던 동기화의 응답은 세대 번호로 버린다)과 보정된 일정 id 목록.
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
  /** 이동 없음 기억의 폰 캐시·올리지 못한 변경을 버린다(`skipMemory.reset`). */
  resetSkips(): void;
  /** 장소를 넣어 보정한 일정 id 목록을 비운다(그 자리의 보정은 서버에서 지워졌다). */
  clearCorrectedPlaces(): void;
  /** 일정 보내기를 붙잡는다(해제 함수를 돌려준다). 연결을 끊는 동안 새 보내기가 시작되지 않게 한다. */
  holdEventSync(): () => void;
};

const appState: LocalCarState = {
  clearInbox: () => appInbox.clear(),
  stopPolling: () => appPoller.stop(),
  resetEventSync: () => appEventSync.reset(),
  clearFilteredEvents: () => appFilteredEvents.set([]),
  resetSkips: () => void appSkipMemory.reset().catch(() => undefined),
  clearCorrectedPlaces: () => appCorrectedPlaces.clear(),
  holdEventSync: () => appEventSync.hold(),
};

/**
 * 서버에서 자리를 지우기 **전에** 부른다(`pairingApi.disconnect`): 알림 폴링을 멈추고 일정 보내기를 멈춘 채 붙잡는다(`hold`) + 기억을 잊는다(`reset`).
 * 끊는 동안 진행 중이던 일정 보내기가 서버의 401을 받고 토큰 없이 다시 보내 연결 전 버킷에 일정을 만드는 일이 없게 하려는 것이다.
 * 돌려주는 해제 함수는 끊기가 끝나거나(토큰이 지워진 뒤) 실패해 이어서 연결된 채로 쓸 때 부른다.
 */
export function quiesceLocalCarState(state: LocalCarState = appState): () => void {
  let release: () => void = () => undefined;
  for (const step of [() => state.stopPolling(), () => (release = state.holdEventSync()), () => state.resetEventSync()]) {
    try {
      step();
    } catch {
      // 한 단계의 실패가 나머지를 막지 않는다.
    }
  }
  return release;
}

/**
 * 폰 토큰이 지워질 때마다(직접 끊기뿐 아니라 서버가 401로 거절해 토큰을 버리는 경우: 폰 바뀜·30일 정리·차곡 초기화) `clearLocalCarState`를 부른다.
 * 그래서 어느 경로로 자리가 없어져도 비우는 범위가 직접 끊기와 같다. 앱 루트에서 한 번 연결하고 해제 함수를 돌려받는다.
 */
export function bindLocalCarStateToSession(target: Pick<Session, 'onTokenCleared'> = appSession, state: LocalCarState = appState): () => void {
  return target.onTokenCleared(() => clearLocalCarState(state));
}

export function clearLocalCarState(state: LocalCarState = appState): void {
  for (const step of [() => state.stopPolling(), () => state.clearInbox(), () => state.resetEventSync(), () => state.clearFilteredEvents(), () => state.resetSkips(), () => state.clearCorrectedPlaces()]) {
    try {
      step();
    } catch {
      // 한 단계의 실패가 나머지를 막지 않는다.
    }
  }
}
