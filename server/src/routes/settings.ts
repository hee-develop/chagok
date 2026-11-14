import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES } from '../limits.js';
import { bearerOf, openDenied, type SeatEnv, type SeatGuard } from '../seatScope.js';
import type { SeatStore } from '../seats.js';

/**
 * 자리별 설정(정책서 10.8). 폰이 쓰고, 차는 `/schedules/today` 응답의 `settings`로 받는다.
 * - plusMode: 주행 중 늦어질 때 일정당 한 번 먼저 말한다(꺼짐이 기본).
 * - lateContact: 늦을 때 연락(꺼짐이 기본). 꺼져 있으면 차는 늦는다는 말만 한다(정책서 5장).
 * - voiceOnly: 화면 없이 음성만(꺼짐, 가안). 켜면 카드를 띄우지 않는다.
 * 기본 말 걸기는 끌 수 없는 고정 값이라 저장하지 않는다.
 */
export type SeatSettings = { plusMode: boolean; lateContact: boolean; voiceOnly: boolean };
export const SETTING_KEYS = ['plusMode', 'lateContact', 'voiceOnly'] as const satisfies readonly (keyof SeatSettings)[];
export const DEFAULT_SETTINGS: Readonly<SeatSettings> = { plusMode: false, lateContact: false, voiceOnly: false };

export type SettingsStore = {
  get(): SeatSettings;
  /** 보낸 키만 바꾼다(나머지는 그대로). 바뀐 전체 설정을 돌려준다. */
  update(patch: Partial<SeatSettings>): SeatSettings;
  /** 모두 기본값인가(연결 전 버킷을 밀어낼 때 '빈 버킷'을 가른다). */
  isDefault(): boolean;
};

export function createSettingsStore(): SettingsStore {
  let current: SeatSettings = { ...DEFAULT_SETTINGS };
  return {
    get: () => ({ ...current }),
    update: (patch) => {
      current = { ...current, ...patch };
      return { ...current };
    },
    isDefault: () => SETTING_KEYS.every((key) => current[key] === DEFAULT_SETTINGS[key]),
  };
}

const tooLarge = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) });

/**
 * `GET /settings`·`PUT /settings`. 자리는 새 장소 API와 같은 엄격한 가드로 정한다(옛 차 앱 호환 읽기 없음):
 * 폰 토큰 = 그 자리, 기기 id만 = 그 기기의 연결 전 버킷(연결하면 버킷의 설정이 자리로 이어진다), 차 토큰 = `driver=<seatId>` 필수,
 * 식별 없음 = 서버에 자리 있는 차가 하나도 없을 때만 기본 자리이고 그 밖에는 저장하지 않는 빈 범위(읽으면 기본값, 쓰면 거절).
 * 읽기는 버킷을 만들지 않고, 본문 검증을 통과한 쓰기만 만든다.
 */
export const createSettingsRoute = (guard: SeatGuard, seats: SeatStore) =>
  new Hono<SeatEnv>()
    .get('/', guard.placeRead, (c) => c.json(c.var.seat.data.settings.get(), 200))
    // 보낸 키만 바꾼다(부분 갱신). 알 수 없는 키·boolean이 아닌 값·빈 객체는 400.
    // 설정은 폰 사용자가 정한다: 차 토큰으로는 읽기만 되고(`GET`, `driver=` 필수) 쓰면 403이다.
    .put(
      '/',
      async (c, next) => {
        const auth = bearerOf(c);
        if (auth.kind === 'token' && !seats.seatByToken(auth.token) && seats.carByToken(auth.token)) {
          return c.json({ error: '설정은 폰에서만 바꿀 수 있습니다', reason: 'forbidden' as const }, 403);
        }
        await next();
      },
      guard.placeWrite,
      tooLarge,
      validator('json', (raw: unknown, c) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        const value = raw as Record<string, unknown>;
        const keys = Object.keys(value);
        if (keys.length === 0) return c.json({ error: `${SETTING_KEYS.join(', ')} 중 하나 이상이 필요합니다` }, 400);
        const patch: Partial<SeatSettings> = {};
        for (const key of keys) {
          if (!(SETTING_KEYS as readonly string[]).includes(key)) return c.json({ error: `알 수 없는 설정입니다: ${key.slice(0, 40)}` }, 400);
          if (typeof value[key] !== 'boolean') return c.json({ error: `${key}는 true 또는 false여야 합니다` }, 400);
          patch[key as keyof SeatSettings] = value[key] as boolean;
        }
        return patch;
      }),
      (c) => {
        const opened = c.var.seat.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        return c.json(opened.data.settings.update(c.req.valid('json')), 200);
      },
    );
