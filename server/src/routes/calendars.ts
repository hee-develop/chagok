import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import type { MockCalendar } from '../fixture-types.js';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';
import { openDenied, type SeatEnv, type SeatGuard } from '../seatScope.js';

export const MAX_SELECTED_IDS = 50;

/** 선택한 id가 어느 출처의 캘린더 id인가. mock은 서버의 목 캘린더 id, device는 폰이 읽은 실제 기기 캘린더 id. */
export type SelectionSource = 'mock' | 'device';

export type SavedSelection = { selectedIds: string[]; savedAt: string; revision: number; source: SelectionSource };

/** 운전자 자리 하나의 선택을 메모리에 둔다. */
export type SelectionStore = {
  get(): SavedSelection | null;
  /** 저장된 revision보다 작은 요청은 저장하지 않고 현재 저장값을 돌려준다. */
  set(selectedIds: string[], revision: number, source?: SelectionSource): SavedSelection;
};

export function createSelectionStore(): SelectionStore {
  let saved: SavedSelection | null = null;
  return {
    get: () => saved,
    set: (selectedIds, revision, source = 'mock') => {
      if (saved && revision < saved.revision) return saved;
      saved = { selectedIds, savedAt: new Date().toISOString(), revision, source };
      return saved;
    },
  };
}

/**
 * 픽스처(목 캘린더 id)에 쓸 선택. 목 출처로 저장된 선택이 있으면 그것을, 없으면(또는 기기 캘린더 선택뿐이면) defaultSelected 캘린더 id.
 * 기기 캘린더 id는 목 일정의 calendarId와 무관하므로 섞어 쓰지 않는다.
 */
export function effectiveSelectedIds(calendars: MockCalendar[], store: SelectionStore): string[] {
  const saved = store.get();
  return saved && saved.source === 'mock' ? saved.selectedIds : calendars.filter((c) => c.defaultSelected).map((c) => c.id);
}

/**
 * selectedIds를 검증한다. source가 'device'면 폰이 읽은 실제 기기 캘린더 id이므로 목 캘린더 id에 있는지는 보지 않는다
 * (그 외 형식·개수·길이·중복 검사는 같다). source가 없거나 'mock'이면 목 캘린더 id만 받는다.
 */
function parseSelection(
  raw: unknown,
  knownIds: Set<string>,
): { ok: true; ids: string[]; revision: number; source: SelectionSource } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '본문이 객체가 아닙니다' };
  const { selectedIds, revision, source } = raw as Record<string, unknown>;
  if (source !== undefined && source !== 'mock' && source !== 'device') return { ok: false, error: "source는 'mock' 또는 'device'여야 합니다" };
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return { ok: false, error: 'revision은 0 이상의 정수여야 합니다' };
  }
  if (!Array.isArray(selectedIds)) return { ok: false, error: 'selectedIds는 배열이어야 합니다' };
  if (selectedIds.length > MAX_SELECTED_IDS) {
    return { ok: false, error: `selectedIds는 ${MAX_SELECTED_IDS}개 이하여야 합니다` };
  }
  const ids: string[] = [];
  for (const id of selectedIds) {
    if (typeof id !== 'string' || id.trim() === '') return { ok: false, error: 'selectedIds에 빈 값이 있습니다' };
    if (id.length > MAX_ID_LENGTH) return { ok: false, error: `id는 ${MAX_ID_LENGTH}자 이하여야 합니다` };
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'selectedIds에 중복이 있습니다' };
  const unknown = source === 'device' ? undefined : ids.find((id) => !knownIds.has(id));
  if (unknown !== undefined) return { ok: false, error: '목 캘린더에 없는 id가 있습니다' };
  return { ok: true, ids, revision, source: source === 'device' ? 'device' : 'mock' };
}

// RPC 타입 추론을 위해 체이닝을 유지한다.
export const createCalendarsRoute = (calendars: MockCalendar[], guard: SeatGuard) => {
  const knownIds = new Set(calendars.map((c) => c.id));
  return new Hono<SeatEnv>()
    .get('/selection', guard.read, (c) => {
      const store = c.var.seat.data.selection;
      return c.json({
        selectedIds: store.get()?.selectedIds ?? (null as string[] | null),
        savedAt: store.get()?.savedAt ?? (null as string | null),
        revision: store.get()?.revision ?? (null as number | null),
        source: store.get()?.source ?? (null as SelectionSource | null),
      });
    })
    .put(
      '/selection',
      guard.write,
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: (c) => c.json({ error: `본문은 ${MAX_BODY_BYTES}바이트 이하여야 합니다` }, 413),
      }),
      validator('json', (value, c) => {
        const parsed = parseSelection(value, knownIds);
        if (!parsed.ok) return c.json({ error: parsed.error }, 400);
        return { selectedIds: parsed.ids, revision: parsed.revision, source: parsed.source };
      }),
      (c) => {
        const { selectedIds, revision, source } = c.req.valid('json');
        const opened = c.var.seat.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        const saved = opened.data.selection.set(selectedIds, revision, source);
        return c.json({ selectedIds: saved.selectedIds, savedAt: saved.savedAt, revision: saved.revision, source: saved.source }, 200);
      },
    );
};
