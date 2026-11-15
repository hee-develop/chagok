import { appSkipMemory, type SkipMemory } from '../skips/skipMemory';
import { appEventSync, type EventSync, type SyncResult } from './eventSync';
import { appFilteredEvents, type FilteredEvent, type FilteredEventsStore } from './filteredEvents';
import { appTravelExceptions, normalizeTitle, type TravelExceptions } from './travelExceptions';

/** 서버로 보낼 필요가 없거나 보냈다는 결과. 이 밖의 결과는 차에 반영하지 못한 것이다. */
const REFLECTED: ReadonlySet<SyncResult> = new Set(['sent', 'unchanged', 'mock']);

export type TravelMarkResult = 'ok' | 'failed';

const appForgotten = new Set<string>();

export type TravelMarkDeps = {
  exceptions?: Pick<TravelExceptions, 'add' | 'remove' | 'has' | 'rollbackAdd'>;
  /**
   * '이동 없음' 기억. 예외를 더하면 같은 이름의 기억이 지워지고(`skipMemory`가 예외 알림으로, 기억에 있는 이름일 때만), 실패해 되돌릴 때와 방금 바꾼 것을 되돌릴 때 도로 더한다.
   * `load`·`sync`는 기억을 최신으로 맞춰 '이 이름을 기억하고 있었는가'를 정확히 알려고 쓴다(없으면 건너뛴다).
   */
  skips?: Pick<SkipMemory, 'has' | 'add' | 'remove'> & Partial<Pick<SkipMemory, 'load' | 'sync'>>;
  /**
   * 이 "이동 일정이에요"가 지운 이동 없음 기억의 이름(정규화). `undoMarkTravel`이 되돌릴 때 이 이름의 기억을 되살린다(전부터 기억하던 이름만 들어 있다).
   * 기본은 앱 전체가 하나를 쓴다. 되돌리기는 바꾼 직후에만 부르므로 마지막으로 바꾼 이름이 맞는다.
   */
  forgotten?: Set<string>;
  filtered?: Pick<FilteredEventsStore, 'get' | 'set' | 'removeWhere'>;
  sync?: Pick<EventSync, 'run'>;
};

/**
 * "이동 일정이에요": 같은 이름을 예외로 기억하고(폰 저장소), 거른 목록에서 빼고, 곧바로 다시 읽어 서버로 보낸다.
 * 서버로 보내지 못했으면(네트워크·권한·선택 없음) **이 일로 바뀐 것만** 되돌린다: 이 이름의 예외 저장을 지우고(원래 예외였거나 저장소를 읽지 못한 동안이면 저장된 이름은 건드리지 않음)
 * 거른 목록에서는 이 일이 뺀 줄만 도로 넣어 그 줄이 사라지지 않게 하고 'failed'를 돌려준다. 그 사이 다른 줄을 바꾸거나 목록이 새로 읽힌 것은 덮지 않는다.
 * 같은 이름을 '이동 없음'으로 기억하고 있었다면 예외를 더할 때 그 기억이 지워지므로(가장 최근 선택이 이긴다), 실패해 되돌릴 때 기억도 도로 더한다.
 * (온라인·건물 안 줄이 대상이다. 이유가 '이동 없음으로 기억'인 줄은 `unskipByTitle`을 쓴다.)
 */
export async function markTravelByTitle(
  title: string,
  { exceptions = appTravelExceptions, filtered = appFilteredEvents, sync = appEventSync, skips = appSkipMemory, forgotten = appForgotten }: TravelMarkDeps = {},
): Promise<TravelMarkResult> {
  const name = normalizeTitle(title);
  const wasException = exceptions.has(title);
  // 이 이름을 기억하고 있었는지 정확히 알아야 한다(예외를 더하면 기억에 있는 이름만 지우기를 쌓는다. 거른 일정의 제목을 서버에 올리지 않으려는 것).
  // 기억을 아직 읽지 않았거나 이 이름이 없으면 서버와 한 번 맞춰 본다(다른 곳에서 더한 기억이 있을 수 있다). 맞추지 못해도(오프라인) 있는 대로 진행한다.
  await skips.load?.().catch(() => undefined);
  if (!skips.has(title)) await skips.sync?.().catch(() => undefined);
  const wasSkipped = skips.has(title);
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
  if (result !== 'error' && REFLECTED.has(result)) {
    // 방금 지운 기억은 되돌리기가 되살린다.
    if (wasSkipped) forgotten.add(name);
    else forgotten.delete(name);
    return 'ok';
  }
  await exceptions.rollbackAdd(title, wasException);
  // 되돌린다: 도로 더하면 이번에 쌓은 지우기도 지워진다(서버에 올라가지 않은 채 남지 않는다).
  if (wasSkipped) await skips.add(title);
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
 * 방금 바꾼 "이동 일정이에요"를 취소한다: 예외를 지워 같은 이름 일정을 다시 거르고, 그 바꾸기가 지웠던 같은 이름의 이동 없음 기억(전부터 기억하던 것)을 되살리며(실패 롤백과 같다),
 * 다시 읽어 서버 일정을 교체한다(서버에서 그 일정이 빠진다).
 * 서버에 보내지 못해도 예외는 이미 지웠으므로 다음 주기 읽기(`useEventSync`)가 다시 보내고, 그 사이 'failed'로 알린다.
 */
export async function undoMarkTravel(
  title: string,
  { exceptions = appTravelExceptions, sync = appEventSync, skips = appSkipMemory, forgotten = appForgotten }: TravelMarkDeps = {},
): Promise<TravelMarkResult> {
  await exceptions.remove(title);
  if (forgotten.delete(normalizeTitle(title))) await skips.add(title);
  try {
    return REFLECTED.has(await sync.run()) ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * 이유가 '이동 없음으로 기억'인 줄의 "이동 일정이에요": 그 이름의 기억을 지우고(서버에는 일정을 보내기 전에 올림) 거른 목록에서 그 이름의 줄을 빼고 곧바로 다시 읽어 보낸다.
 * 보내지 못했으면 기억과 줄을 도로 넣고 'failed'를 돌려준다(`markTravelByTitle`과 같은 규칙).
 */
export async function unskipByTitle(
  title: string,
  { filtered = appFilteredEvents, sync = appEventSync, skips = appSkipMemory }: Pick<TravelMarkDeps, 'filtered' | 'sync' | 'skips'> = {},
): Promise<TravelMarkResult> {
  const name = normalizeTitle(title);
  const isSkippedRow = (e: FilteredEvent) => e.reason === 'skipped' && normalizeTitle(e.title) === name;
  const removedRows = filtered.get().filter(isSkippedRow);
  const order = filtered.get().map((e) => e.id);
  await skips.remove(title);
  filtered.removeWhere(isSkippedRow);
  let result: SyncResult | 'error' = 'error';
  try {
    result = await sync.run();
  } catch {
    // 아래에서 되돌린다.
  }
  if (result !== 'error' && REFLECTED.has(result)) return 'ok';
  await skips.add(title);
  restoreRows(filtered, removedRows, order);
  return 'failed';
}

/** 방금 바꾼 `unskipByTitle`을 취소한다: 이름을 다시 '이동 없음'으로 기억하고 다시 읽어 서버 일정을 교체한다(`undoMarkTravel`과 같은 규칙). */
export async function undoUnskipByTitle(
  title: string,
  { sync = appEventSync, skips = appSkipMemory }: Pick<TravelMarkDeps, 'sync' | 'skips'> = {},
): Promise<TravelMarkResult> {
  await skips.add(title);
  try {
    return REFLECTED.has(await sync.run()) ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}
