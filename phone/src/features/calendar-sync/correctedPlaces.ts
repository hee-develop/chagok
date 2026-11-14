/**
 * 사용자가 장소를 넣어 보정한(서버에 `PUT /schedules/:id/place`로 저장한) 일정 id(메모리). 폰이 '이동 없음' 이름 기억으로 일정을 거를 때 이 일정은 거르지 않는다
 * (`travelFilter.ts`): 장소 보정이 이동 없음 기억을 이긴다(가장 최근 선택이 이김). 거르면 서버가 일정과 함께 보정을 잃는다.
 * 3단계 조회(`GET /schedules/places`의 `corrected`)와 저장 응답이 채운다. 앱을 다시 열면 비어 있고, 그 사이에도 안전한 이유는 장소를 넣을 때
 * 같은 이름의 기억을 지우기 때문이다(`schedulePlacesApi.savePlace`). 이 캐시는 그 기억 지우기가 아직 서버에 올라가기 전이나 기억을 나중에 더한 경우를 덮는다.
 */
export type CorrectedPlaces = {
  has(id: string): boolean;
  /** 서버가 알려 준 보정된 일정 id로 통째로 바꾼다(조회 결과). */
  replace(ids: Iterable<string>): void;
  /** 일정 하나의 보정 여부를 바꾼다(저장 응답). */
  set(id: string, corrected: boolean): void;
  clear(): void;
};

export function createCorrectedPlaces(): CorrectedPlaces {
  let ids = new Set<string>();
  return {
    has: (id) => ids.has(id),
    replace: (next) => {
      ids = new Set(next);
    },
    set: (id, corrected) => {
      if (corrected) ids.add(id);
      else ids.delete(id);
    },
    clear: () => {
      ids = new Set();
    },
  };
}

/** 앱 전체가 하나를 공유한다(3단계 조회·저장과 일정 동기화). */
export const appCorrectedPlaces = createCorrectedPlaces();
