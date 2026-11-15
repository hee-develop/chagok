/**
 * 장소 검색 화면을 '장소 하나 고르기'로 쓰는 다리. 호출한 화면(요청 만들기)이 `listen(key, fn)`으로 기다리고,
 * 장소 검색 화면(`PlaceSearchScreen`의 `pickerKey`)이 고른 결과를 `deliver(key, picked)`로 돌려준다. 라우트 파라미터에는 함수를 실을 수 없어서
 * 모듈 안 한 곳에 등록한다. 검색 화면은 서버에 아무것도 저장하지 않고(자주 가는 곳·일정 보정이 아니다) 글자와 좌표만 돌려준다.
 */
export type PickedPlace = { text: string; lat?: number; lng?: number };

const listeners = new Map<string, (place: PickedPlace) => void>();

/** `key`로 오는 결과를 기다린다(같은 키는 바꾼다). 해제 함수를 돌려준다. */
export function listenForPlace(key: string, listener: (place: PickedPlace) => void): () => void {
  listeners.set(key, listener);
  return () => {
    if (listeners.get(key) === listener) listeners.delete(key);
  };
}

/** 고른 장소를 기다리는 화면에 전한다. 받을 화면이 없으면 false. */
export function deliverPlace(key: string, place: PickedPlace): boolean {
  const listener = listeners.get(key);
  if (listener === undefined) return false;
  listener(place);
  return true;
}
