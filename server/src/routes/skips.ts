import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { displayEventName, normalizeEventName } from '../eventName.js';
import { MAX_BODY_BYTES, MAX_SKIPS, MAX_SKIP_CHANGES, MAX_TITLE_LENGTH } from '../limits.js';
import { openDenied, type SeatEnv, type SeatGuard } from '../seatScope.js';

/** '이동 없음'으로 기억한 일정 이름. `name`은 처음 기억할 때의 글자(공백만 정리)이고 같은 이름인지는 `normalizeEventName`으로 가른다. */
export type SkipEntry = { name: string; addedAt: string };

export type SkipChange = { add: string[]; remove: string[] };

export type ApplySkips = { ok: true; skips: SkipEntry[] } | { ok: false; reason: 'full'; limit: number };

/**
 * 운전자 자리 하나가 '이동 없음'으로 기억한 일정 이름을 메모리에 둔다(정책서 10.3 4번·10.8·11장). 자리와 함께 지워지고 폰을 바꿔도 남는다(`seatData.ts`).
 * 이름만 담고 일정 내용은 담지 않는다. 더하기·빼기는 여러 번 해도 같다(이미 있는 이름을 더하거나 없는 이름을 빼도 오류가 아니다).
 */
export type SkipsStore = {
  /** 기억한 이름, 최근에 더한 것부터. */
  list(): SkipEntry[];
  /** 이 일정 제목(공백·대소문자 무시)이 기억한 이름인가. */
  has(title: string): boolean;
  size(): number;
  /** 빼기를 먼저 하고 더한다. 새 이름이 상한(`limit()`)을 넘기면 아무것도 바꾸지 않고 `full`. */
  apply(change: SkipChange): ApplySkips;
  /**
   * 다른 기억(폰 바꾸기 때 새 폰의 연결 전 버킷)을 합친다: 없는 이름만 처음 기억한 시각 그대로, 오래된 것부터 상한까지 더한다. 이미 있는 이름은 그대로 두고
   * 상한을 넘는 이름은 버린다(이어받는 쪽의 기존 기억이 먼저다). 합친 개수를 돌려준다.
   */
  merge(entries: readonly SkipEntry[]): number;
  /** 기억 개수 상한. 연결 전 버킷은 연결된 자리보다 작다(`MAX_BUCKET_SKIPS`). */
  limit(): number;
  /** 상한을 바꾼다(버킷이 연결된 자리가 될 때 늘린다). 이미 상한을 넘는 기억은 지우지 않는다. */
  setLimit(limit: number): void;
};

export function createSkipsStore(now: () => Date = () => new Date(), initialLimit: number = MAX_SKIPS): SkipsStore {
  // 키는 정규화한 이름. Map의 삽입 순서가 더한 순서다.
  const names = new Map<string, SkipEntry>();
  let max = initialLimit;
  const list = () => [...names.values()].reverse();
  return {
    list,
    has: (title) => names.has(normalizeEventName(title)),
    size: () => names.size,
    apply: ({ add, remove }) => {
      const removing = new Set(remove.map(normalizeEventName));
      const adding = new Map<string, string>();
      for (const name of add) {
        const key = normalizeEventName(name);
        if (!adding.has(key)) adding.set(key, displayEventName(name));
      }
      const kept = [...names.keys()].filter((k) => !removing.has(k)).length;
      const fresh = [...adding.keys()].filter((k) => !names.has(k) || removing.has(k)).length;
      if (kept + fresh > max) return { ok: false, reason: 'full', limit: max };
      for (const key of removing) names.delete(key);
      const at = now().toISOString();
      for (const [key, name] of adding) if (!names.has(key)) names.set(key, { name, addedAt: at });
      return { ok: true, skips: list() };
    },
    merge: (entries) => {
      let merged = 0;
      // entries는 최근에 더한 것부터라 오래된 것부터 더하면 삽입 순서(더한 순서)가 이어진다.
      for (const entry of [...entries].reverse()) {
        const key = normalizeEventName(entry.name);
        if (key === '' || names.has(key) || names.size >= max) continue;
        names.set(key, { name: displayEventName(entry.name), addedAt: entry.addedAt });
        merged += 1;
      }
      return merged;
    },
    limit: () => max,
    setLimit: (limit) => {
      max = limit;
    },
  };
}

/** 이름 하나를 검사한다. 정리한 뒤(보이지 않는 글자 제거) 비어 있거나 일정 제목 상한(200자, 이모지는 한 글자)을 넘으면 오류 문구. */
function nameError(raw: unknown): string | null {
  if (typeof raw !== 'string') return '이름은 문자열이어야 합니다';
  if (raw.length > MAX_TITLE_LENGTH * 8) return `이름은 ${MAX_TITLE_LENGTH}자 이하여야 합니다`;
  const name = displayEventName(raw);
  if (name === '') return '이름이 비어 있습니다';
  if ([...name].length > MAX_TITLE_LENGTH) return `이름은 ${MAX_TITLE_LENGTH}자 이하여야 합니다`;
  return null;
}

type ParsedChange = { ok: true; change: SkipChange } | { ok: false; error: string };

function parseChange(raw: unknown): ParsedChange {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '본문은 객체여야 합니다' };
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((k) => k !== 'add' && k !== 'remove')) return { ok: false, error: 'add·remove만 보낼 수 있습니다' };
  const lists: Record<'add' | 'remove', string[]> = { add: [], remove: [] };
  for (const key of ['add', 'remove'] as const) {
    const list = value[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return { ok: false, error: `${key}는 이름 배열이어야 합니다` };
    if (list.length > MAX_SKIP_CHANGES) return { ok: false, error: `한 번에 ${MAX_SKIP_CHANGES}개까지만 바꿀 수 있습니다` };
    for (const item of list) {
      const error = nameError(item);
      if (error !== null) return { ok: false, error: `${key}: ${error}` };
    }
    lists[key] = list as string[];
  }
  if (lists.add.length + lists.remove.length === 0) return { ok: false, error: 'add 또는 remove에 이름이 하나 이상 필요합니다' };
  if (lists.add.length + lists.remove.length > MAX_SKIP_CHANGES) return { ok: false, error: `한 번에 ${MAX_SKIP_CHANGES}개까지만 바꿀 수 있습니다` };
  const removing = new Set(lists.remove.map(normalizeEventName));
  if (lists.add.some((n) => removing.has(normalizeEventName(n)))) return { ok: false, error: '같은 이름을 add와 remove에 함께 보낼 수 없습니다' };
  return { ok: true, change: lists };
}

// RPC 타입 추론을 위해 체이닝을 유지한다.
export const createSkipsRoute = (guard: SeatGuard) =>
  // 새 API라 옛 차 앱 호환 읽기를 쓰지 않는다(`guard.placeRead`·`guard.placeWrite`, 장소 해석·기억과 같은 가드): 자리는 폰 토큰, 연결 전 기기 id 버킷,
  // 차 토큰 + `driver=<자리>`(읽기·쓰기 모두 필수, 없으면 400 `driver-required`)로만 정하고, 식별이 없으면 서버에 자리 있는 차가 없을 때만 기본 자리(데모·E2E)이며
  // 그 밖에는 저장하지 않는 빈 범위(읽으면 빈 목록, 쓰면 429 `unwritable`)이다.
  new Hono<SeatEnv>()
    // 폰이 일정을 거를 때 쓰는 '이동 없음' 이름 목록(차도 driver로 읽을 수 있다).
    .get('/', guard.placeRead, (c) => c.json({ skips: c.var.seat.data.skips.list() }, 200))
    // 이름 더하기·빼기. 응답은 바뀐 뒤의 전체 목록이다.
    .put(
      '/',
      guard.placeWrite,
      bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) }),
      validator('json', (raw: unknown, c) => {
        const parsed = parseChange(raw);
        if (!parsed.ok) return c.json({ error: parsed.error }, 400);
        // 클라이언트(Hono RPC) 입력 타입: 더할 것·뺄 것 중 보내는 쪽만 적으면 된다.
        return parsed.change as { add?: string[]; remove?: string[] };
      }),
      (c) => {
        const opened = c.var.seat.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        const { add = [], remove = [] } = c.req.valid('json');
        const result = opened.data.skips.apply({ add, remove });
        if (!result.ok) return c.json({ error: `이동 없음 기억은 ${result.limit}개까지만 둘 수 있습니다`, reason: 'full' as const, limit: result.limit }, 409);
        return c.json({ skips: result.skips }, 200);
      },
    );
