import { appEventSync, type EventSync, type SyncResult } from './eventSync';
import { appFilteredEvents, type FilteredEventsStore } from './filteredEvents';
import { appTravelExceptions, normalizeTitle, type TravelExceptions } from './travelExceptions';

/** 서버로 보낼 필요가 없거나 보냈다는 결과. 이 밖의 결과는 차에 반영하지 못한 것이다. */
const REFLECTED: ReadonlySet<SyncResult> = new Set(['sent', 'unchanged', 'mock']);

export type TravelMarkResult = 'ok' | 'failed';

export type TravelMarkDeps = {
  exceptions?: Pick<TravelExceptions, 'add' | 'remove'>;
  filtered?: Pick<FilteredEventsStore, 'get' | 'set' | 'removeWhere'>;
  sync?: Pick<EventSync, 'run'>;
};

/**
 * "이동 일정이에요": 같은 이름을 예외로 기억하고(폰 저장소), 거른 목록에서 빼고, 곧바로 다시 읽어 서버로 보낸다.
 * 서버로 보내지 못했으면(네트워크·권한·선택 없음) 되돌린다: 예외 저장을 지우고 거른 목록을 원래대로 돌려 그 줄이 사라지지 않게 하고 'failed'를 돌려준다.
 */
export async function markTravelByTitle(
  title: string,
  { exceptions = appTravelExceptions, filtered = appFilteredEvents, sync = appEventSync }: TravelMarkDeps = {},
): Promise<TravelMarkResult> {
  const name = normalizeTitle(title);
  const before = filtered.get();
  await exceptions.add(title);
  filtered.removeWhere((e) => normalizeTitle(e.title) === name);
  let result: SyncResult | 'error' = 'error';
  try {
    result = await sync.run();
  } catch {
    // 아래에서 되돌린다.
  }
  if (result !== 'error' && REFLECTED.has(result)) return 'ok';
  await exceptions.remove(title);
  filtered.set(before);
  return 'failed';
}

/**
 * 방금 바꾼 "이동 일정이에요"를 취소한다: 예외를 지워 같은 이름 일정을 다시 거르고, 다시 읽어 서버 일정을 교체한다(서버에서 그 일정이 빠진다).
 * 서버에 보내지 못해도 예외는 이미 지웠으므로 다음 주기 읽기(`useEventSync`)가 다시 보내고, 그 사이 'failed'로 알린다.
 */
export async function undoMarkTravel(
  title: string,
  { exceptions = appTravelExceptions, sync = appEventSync }: TravelMarkDeps = {},
): Promise<TravelMarkResult> {
  await exceptions.remove(title);
  try {
    return REFLECTED.has(await sync.run()) ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}
