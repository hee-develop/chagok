import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { ENERGY_RATE_LIMIT_MAX_CLIENTS, ENERGY_RATE_LIMIT_PER_WINDOW, ENERGY_RATE_LIMIT_WINDOW_MS, MAX_STAY_MINUTES } from '../energy/constants.js';
import { findEnergyOptions, type EnergyRequest } from '../energy/options.js';
import { createRateLimiter } from '../energy/rateLimit.js';
import type { EnergySources, FuelKind, LatLng } from '../energy/types.js';
import { MAX_BODY_BYTES } from '../limits.js';
import { connectionAddress } from '../seatScope.js';
import { parseAt } from '../time.js';

const FUELS: FuelKind[] = ['ev', 'gasoline', 'diesel', 'hybrid'];

type Parsed = { ok: true; value: Omit<EnergyRequest, 'at'> & { at: Date | null } } | { ok: false; error: string };

function parsePoint(raw: unknown, name: string): LatLng | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return `${name}은 { lat, lng } 객체여야 합니다`;
  const { lat, lng } = raw as Record<string, unknown>;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return `${name}.lat은 -90~90 사이 숫자여야 합니다`;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return `${name}.lng은 -180~180 사이 숫자여야 합니다`;
  return { lat, lng };
}

export function parseEnergyRequest(raw: unknown): Parsed {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '본문이 객체가 아닙니다' };
  const body = raw as Record<string, unknown>;
  if (typeof body.fuel !== 'string' || !FUELS.includes(body.fuel as FuelKind)) return { ok: false, error: `fuel은 ${FUELS.join('·')} 중 하나여야 합니다` };
  const origin = parsePoint(body.origin, 'origin');
  if (typeof origin === 'string') return { ok: false, error: origin };
  const destination = parsePoint(body.destination, 'destination');
  if (typeof destination === 'string') return { ok: false, error: destination };

  let stayMinutes: number | null = null;
  if (body.stayMinutes !== undefined && body.stayMinutes !== null) {
    const s = body.stayMinutes;
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > MAX_STAY_MINUTES) return { ok: false, error: `stayMinutes는 0~${MAX_STAY_MINUTES} 사이 숫자여야 합니다` };
    stayMinutes = s;
  }

  let at: Date | null = null;
  if (body.at !== undefined && body.at !== null) {
    const parsed = typeof body.at === 'string' ? parseAt(body.at) : null;
    if (parsed === null) return { ok: false, error: 'at은 오프셋이 있는 ISO8601 시각이어야 합니다(예: 2026-11-06T12:00:00+09:00)' };
    at = parsed;
  }
  return { ok: true, value: { fuel: body.fuel as FuelKind, origin, destination, stayMinutes, at } };
}

const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: `본문은 ${MAX_BODY_BYTES}바이트 이하여야 합니다` }, 413),
});

export type EnergyRouteOptions = {
  now: () => Date;
  /** 외부 조회 실패를 알린다. 기본은 한 줄 경고(URL·키는 오류 메시지에 들어 있지 않다). */
  onError?: (error: unknown) => void;
  /** 전체 제한 시간(ms). 테스트에서만 바꾼다. */
  totalTimeoutMs?: number;
  /** 요청 주소별 속도 제한(창 안 최대 횟수·창 길이 ms). 기본은 분당 20회. */
  rateLimit?: { limit?: number; windowMs?: number };
  /** 요청 주소를 정하는 함수. 기본은 연결의 원격 주소(`connectionAddress`, 프록시 헤더는 믿지 않는다). `createApp`은 `clientAddress`를 넘긴다. */
  clientKey?: (c: Context) => string;
};

// RPC 타입 추론을 위해 체이닝을 유지한다.
export const createEnergyRoute = (sources: EnergySources, { now, onError = defaultOnError, totalTimeoutMs, rateLimit, clientKey = connectionAddress }: EnergyRouteOptions) => {
  const limiter = createRateLimiter({
    limit: rateLimit?.limit ?? ENERGY_RATE_LIMIT_PER_WINDOW,
    windowMs: rateLimit?.windowMs ?? ENERGY_RATE_LIMIT_WINDOW_MS,
    maxKeys: ENERGY_RATE_LIMIT_MAX_CLIENTS,
    now: () => now().getTime(),
  });
  return new Hono().post(
    '/options',
    async (c, next) => {
      const r = limiter.check(clientKey(c));
      if (!r.ok) {
        c.header('Retry-After', String(r.retryAfterSeconds));
        return c.json({ error: '요청이 너무 잦습니다. 잠시 뒤에 다시 시도해 주세요' }, 429);
      }
      await next();
    },
    tooLarge,
    validator('json', (value, c) => {
      const parsed = parseEnergyRequest(value);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      return parsed.value;
    }),
    async (c) => {
      const req = c.req.valid('json');
      return c.json(await findEnergyOptions({ ...req, at: req.at ?? now() }, sources, { onError, totalTimeoutMs }), 200);
    },
  );
};

function defaultOnError(error: unknown) {
  console.warn(`[energy] 외부 조회 실패: ${error instanceof Error ? error.message : 'unknown'}`);
}
