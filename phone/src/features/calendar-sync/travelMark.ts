import { appEventSync, type EventSync, type SyncResult } from './eventSync';
import { appFilteredEvents, type FilteredEvent, type FilteredEventsStore } from './filteredEvents';
import { appTravelExceptions, normalizeTitle, type TravelExceptions } from './travelExceptions';

/** 서버로 보낼 필요가 없거나 보냈다는 결과. 이 밖의 결과는 차에 반영하지 못한 것이다. */
const REFLECTED: ReadonlySet<SyncResult> = new Set(['sent', 'unchanged', 'mock']);

export type TravelMarkResult = 'ok' | 'failed';

export type TravelMarkDeps = {
  exceptions?: Pick<TravelExceptions, 'add' | 'remove' | 'has' | 'rollbackAdd'>;
  filtered?: Pick<FilteredEventsStore, 'get' | 'set' | 'removeWhere'>;
  sync?: Pick<EventSync, 'run'>;
};

/**
 * "이동 일정이에요": 같은 이름을 예외로 기억하고(폰 저장소), 거른 목록에서 빼고, 곧바로 다시 읽어 서버로 보낸다.
 * 서버로 보내지 못했으면(네트워크·권한·선택 없음) **이 일로 바뀐 것만** 되돌린다: 이 이름의 예외 저장을 지우고(원래 예외였거나 저장소를 읽지 못한 동안이면 저장된 이름은 건드리지 않음)
 * 거른 목록에서는 이 일이 뺀 줄만 도로 넣어 그 줄이 사라지지 않게 하고 'failed'를 돌려준다. 그 사이 다른 줄을 바꾸거나 목록이 새로 읽힌 것은 덮지 않는다.
 */
export async function markTravelByTitle(
  title: string,
  { exceptions = appTravelExceptions, filtered = appFilteredEvents, sync = appEventSync }: TravelMarkDeps = {},
): Promise<TravelMarkResult> {
  const name = normalizeTitle(title);
  const wasException = exceptions.has(title);
  const removedRows = filtered.get().filter((e) => normalizeTitle(e.title) === name);
  const order = filtered.get().map((e) => e.id);
  await exceptions.add(title);
  filtered.removeWhere((e) => normalizeTitle(e.title) === name);
  let result: SyncResult | 'error' = 'error';
  try {
    result = await sync.run();
  } catch {
    // 아래에서 되돌린다.
  }
  if (result !== 'error' && REFLECTED.has(result)) return 'ok';
  await exceptions.rollbackAdd(title, wasException);
  restoreRows(filtered, removedRows, order);
  return 'failed';
}

/** 뺐던 줄만 도로 넣는다. 지금 목록에 이미 있는 줄은 건드리지 않고, 처음 순서(`order`)를 따르며 처음에 없던 줄은 뒤에 둔다. */
function restoreRows(filtered: Pick<FilteredEventsStore, 'get' | 'set'>, rows: readonly FilteredEvent[], order: readonly string[]) {
  const current = filtered.get();
  const present = new Set(current.map((e) => e.id));
  const missing = rows.filter((e) => !present.has(e.id));
  if (missing.length === 0) return;
  const rank = (e: FilteredEvent) => {
    const i = order.indexOf(e.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  filtered.set([...current, ...missing].sort((a, b) => rank(a) - rank(b)));
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
