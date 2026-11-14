import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';

/** 연결 코드가 살아 있는 시간. 차는 만료되면 새 코드를 받는다. */
export const PAIRING_CODE_TTL_MS = 10 * 60_000;

const CODE_PATTERN = /^\d{6}$/;

/**
 * 차–폰 연결(QR · 6자리 숫자). 회원가입 없이 차를 목 사용자 한 명의 폰에 묶는다.
 * 차는 설치 때 만든 익명 차 id로 코드를 받아 QR과 숫자로 보이고, 폰이 그 코드를 보내면 연결된다.
 * 연결은 메모리에만 두며 서버를 다시 켜면 사라진다. 차는 한 번 연결되면 저장해 두고 다시 묻지 않는다.
 * 연결 전인 차는 상태의 codeActive가 false면(서버 재시작·만료) 새 코드를 받는다.
 */
export type PairingStore = {
  /** 차 하나에 새 코드를 낸다. 그 차의 이전 코드는 버린다. */
  issue(carId: string): { code: string; expiresAt: string };
  /** 살아 있는 코드면 그 차를 연결하고 코드를 버린다. 없거나 만료면 null */
  claim(code: string): { carId: string; pairedAt: string } | null;
  /** codeActive: 이 차에 살아 있는 코드가 있는가. 서버를 다시 켜 코드를 잃었으면 false라 차가 새 코드를 받는다. */
  status(carId: string): { paired: boolean; pairedAt: string | null; codeActive: boolean };
  /** 연결을 푼다(데모 초기화용). 그 차의 코드도 버린다. */
  unpair(carId: string): void;
};

export function createPairingStore(now: () => Date = () => new Date(), random: () => number = Math.random): PairingStore {
  const codes = new Map<string, { carId: string; expiresAt: number }>();
  const paired = new Map<string, string>();
  const purge = () => {
    const t = now().getTime();
    for (const [code, entry] of codes) if (entry.expiresAt <= t) codes.delete(code);
  };
  const dropCodesOf = (carId: string) => {
    for (const [code, entry] of codes) if (entry.carId === carId) codes.delete(code);
  };
  return {
    issue: (carId) => {
      purge();
      dropCodesOf(carId);
      let code: string;
      do code = String(Math.floor(random() * 1_000_000)).padStart(6, '0');
      while (codes.has(code));
      const expiresAt = now().getTime() + PAIRING_CODE_TTL_MS;
      codes.set(code, { carId, expiresAt });
      return { code, expiresAt: new Date(expiresAt).toISOString() };
    },
    claim: (code) => {
      purge();
      const entry = codes.get(code);
      if (!entry) return null;
      codes.delete(code);
      const pairedAt = now().toISOString();
      paired.set(entry.carId, pairedAt);
      return { carId: entry.carId, pairedAt };
    },
    status: (carId) => {
      purge();
      const codeActive = [...codes.values()].some((entry) => entry.carId === carId);
      return { paired: paired.has(carId), pairedAt: paired.get(carId) ?? null, codeActive };
    },
    unpair: (carId) => {
      paired.delete(carId);
      dropCodesOf(carId);
    },
  };
}

const tooLarge = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) });
const validCarId = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_ID_LENGTH;

// RPC 타입 추론을 위해 체이닝을 유지한다. 검증기는 받은 본문 모양 그대로를 돌려준다(폰 RPC 타입이 이 모양을 쓴다).
export const createPairingRoute = (store: PairingStore) =>
  new Hono()
    // 차가 코드를 받는다. qr은 차 화면 QR에 담을 글이다.
    .post('/codes', tooLarge,
      validator('json', (raw: unknown, c) => {
        const v = raw as Record<string, unknown> | null;
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1 || !validCarId(v.carId)) {
          return c.json({ error: `carId(1~${MAX_ID_LENGTH}자) 하나가 필요합니다` }, 400);
        }
        return { carId: v.carId };
      }),
      (c) => {
        const { code, expiresAt } = store.issue(c.req.valid('json').carId);
        return c.json({ code, expiresAt, qr: `chagok://pair?code=${code}` }, 200);
      })
    // 차가 연결됐는지 본다(연결 카드를 띄운 동안 몇 초마다).
    .get('/cars/:carId', (c) => {
      const carId = c.req.param('carId');
      if (!validCarId(carId)) return c.json({ error: 'carId가 올바르지 않습니다' }, 400);
      return c.json(store.status(carId), 200);
    })
    // 폰이 QR이나 숫자로 받은 코드를 보낸다.
    .post('/claim', tooLarge,
      validator('json', (raw: unknown, c) => {
        const v = raw as Record<string, unknown> | null;
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1 || typeof v.code !== 'string' || !CODE_PATTERN.test(v.code)) {
          return c.json({ error: 'code(숫자 6자리) 하나가 필요합니다' }, 400);
        }
        return { code: v.code };
      }),
      (c) => {
        const result = store.claim(c.req.valid('json').code);
        if (!result) return c.json({ error: '없거나 만료된 코드입니다. 차 화면의 새 코드로 다시 해 주세요' }, 404);
        return c.json(result, 200);
      })
    // 데모 초기화: 연결을 푼다.
    .delete('/cars/:carId', (c) => {
      const carId = c.req.param('carId');
      if (!validCarId(carId)) return c.json({ error: 'carId가 올바르지 않습니다' }, 400);
      store.unpair(carId);
      return c.json(store.status(carId), 200);
    });
