import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import type { MockCalendar } from '../fixture-types.js';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';

export const MAX_SELECTED_IDS = 50;

export type SavedSelection = { selectedIds: string[]; savedAt: string; revision: number };

/** 목 사용자 한 명의 선택을 메모리에 둔다. */
export type SelectionStore = {
  get(): SavedSelection | null;
  /** 저장된 revision보다 작은 요청은 저장하지 않고 현재 저장값을 돌려준다. */
  set(selectedIds: string[], revision: number): SavedSelection;
};

export function createSelectionStore(): SelectionStore {
  let saved: SavedSelection | null = null;
  return {
    get: () => saved,
    set: (selectedIds, revision) => {
      if (saved && revision < saved.revision) return saved;
      saved = { selectedIds, savedAt: new Date().toISOString(), revision };
      return saved;
    },
  };
}

/** 저장된 선택이 있으면 그것을, 없으면 defaultSelected 캘린더 id를 돌려준다. */
export function effectiveSelectedIds(calendars: MockCalendar[], store: SelectionStore): string[] {
  return store.get()?.selectedIds ?? calendars.filter((c) => c.defaultSelected).map((c) => c.id);
}

function parseSelection(
  raw: unknown,
  knownIds: Set<string>,
): { ok: true; ids: string[]; revision: number } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '본문이 객체가 아닙니다' };
  const { selectedIds, revision } = raw as Record<string, unknown>;
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
  const unknown = ids.find((id) => !knownIds.has(id));
  if (unknown !== undefined) return { ok: false, error: '목 캘린더에 없는 id가 있습니다' };
  return { ok: true, ids, revision };
}

// RPC 타입 추론을 위해 체이닝을 유지한다.
export const createCalendarsRoute = (calendars: MockCalendar[], store: SelectionStore) => {
  const knownIds = new Set(calendars.map((c) => c.id));
  return new Hono()
    .get('/selection', (c) =>
      c.json({
        selectedIds: store.get()?.selectedIds ?? (null as string[] | null),
        savedAt: store.get()?.savedAt ?? (null as string | null),
        revision: store.get()?.revision ?? (null as number | null),
      }),
    )
    .put(
      '/selection',
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: (c) => c.json({ error: `본문은 ${MAX_BODY_BYTES}바이트 이하여야 합니다` }, 413),
      }),
      validator('json', (value, c) => {
        const parsed = parseSelection(value, knownIds);
        if (!parsed.ok) return c.json({ error: parsed.error }, 400);
        return { selectedIds: parsed.ids, revision: parsed.revision };
      }),
      (c) => {
        const { selectedIds, revision } = c.req.valid('json');
        const saved = store.set(selectedIds, revision);
        return c.json({ selectedIds: saved.selectedIds, savedAt: saved.savedAt, revision: saved.revision }, 200);
      },
    );
};
