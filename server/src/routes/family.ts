import { Hono } from 'hono';
import { validator } from 'hono/validator';
import type { FamilyMember } from '../fixture-types.js';
import { MAX_ID_LENGTH } from '../limits.js';
import type { SeatEnv, SeatGuard } from '../seatScope.js';

/**
 * 가족에게 보낸 일정 요청. 보낼 때의 일정 내용(제목·시각·주소·채비)을 그대로 담는다.
 * 받는 쪽(가족의 차 브리핑·수락·완료)은 PT에서 프로토타입이라, 서버가 받아 가족 몫으로 저장하면 '전달됨'이다.
 */
export type FamilyRequest = {
  id: string;
  scheduleId: string;
  memberId: string;
  memberName: string;
  title: string;
  start: string;
  end: string;
  locationText: string | null;
  place: { name: string; lat: number; lng: number } | null;
  care: string | null;
  status: 'delivered';
  sentAt: string;
};

export type FamilyRequestDraft = Omit<FamilyRequest, 'id' | 'status' | 'sentAt'>;

/** 운전자 자리 하나가 보낸 요청을 메모리에 둔다. 같은 일정을 같은 가족에게 다시 보내면 내용과 보낸 시각만 새로 한다. */
export type FamilyStore = {
  list(): FamilyRequest[];
  forSchedule(scheduleId: string): FamilyRequest[];
  save(draft: FamilyRequestDraft): FamilyRequest;
};

export function createFamilyStore(now: () => Date = () => new Date()): FamilyStore {
  const requests = new Map<string, FamilyRequest>();
  const newestFirst = (a: FamilyRequest, b: FamilyRequest) => b.sentAt.localeCompare(a.sentAt);
  return {
    list: () => [...requests.values()].sort(newestFirst),
    forSchedule: (scheduleId) => [...requests.values()].filter((r) => r.scheduleId === scheduleId).sort(newestFirst),
    save: (draft) => {
      const id = `${draft.scheduleId}:${draft.memberId}`;
      const saved: FamilyRequest = { ...draft, id, status: 'delivered', sentAt: now().toISOString() };
      requests.set(id, saved);
      return saved;
    },
  };
}

// RPC 타입 추론을 위해 체이닝을 유지한다. 보내기(POST)는 일정 내용을 아는 /schedules/:id/family-request에 있다.
export const createFamilyRoute = (members: FamilyMember[], guard: SeatGuard) =>
  new Hono<SeatEnv>()
    .get('/members', (c) => c.json({ members }))
    .get(
      '/requests',
      guard.read,
      validator('query', (value: { scheduleId?: string | string[] }, c) => {
        const id = value.scheduleId;
        if (id === undefined) return { scheduleId: undefined as string | undefined };
        if (typeof id !== 'string' || id === '' || id.length > MAX_ID_LENGTH) return c.json({ error: 'scheduleId가 올바르지 않습니다' }, 400);
        return { scheduleId: id as string | undefined };
      }),
      (c) => {
        const { scheduleId } = c.req.valid('query');
        const store = c.var.seat.data.family;
        return c.json({ requests: scheduleId === undefined ? store.list() : store.forSchedule(scheduleId) }, 200);
      },
    );
