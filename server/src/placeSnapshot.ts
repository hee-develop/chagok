import { MAX_ID_LENGTH } from './limits.js';
import { MAX_MEMORY_ADDRESS_LENGTH, MAX_MEMORY_PLACE_NAME_LENGTH } from './placeSearch/limits.js';
import { isLat, isLng } from './placeSearch/types.js';

/**
 * 폰이 장소 검색 결과(목이 아닌 외부 결과 포함)를 자주 가는 곳·일정 보정에 저장할 때 싣는 장소 스냅숏.
 * 목 장소 id만 받던 저장소를 넓힌 것이고 기존 `placeId` 요청은 그대로 받는다(둘 중 하나만 보낸다).
 * 서버는 받은 스냅숏을 **그 자리 저장소에 값으로** 저장한다(외부 장소 id를 나중에 다시 조회하지 않는다).
 */
export type PlaceSnapshotInput = { name: string; lat: number; lng: number; address?: string | null; externalId?: string | null };

/** 저장소가 들고 있는 장소. 응답의 장소(`PublicPlace`)와 같은 모양이다. id는 목 id 또는 서버가 만든 `ext:<externalId>`·`geo:<위도>,<경도>`다. */
export type StoredPlace = { id: string; name: string; address: string; lat: number; lng: number };

const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9:_.-]+$/;
const clean = (text: string) => text.trim().replace(/\s+/g, ' ');
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type ParsedSnapshot = { ok: true; place: StoredPlace } | { ok: false; error: string };

export function parsePlaceSnapshot(raw: unknown): ParsedSnapshot {
  if (!isRecord(raw)) return { ok: false, error: 'place는 객체여야 합니다' };
  if (Object.keys(raw).some((k) => k !== 'name' && k !== 'lat' && k !== 'lng' && k !== 'address' && k !== 'externalId')) {
    return { ok: false, error: 'place는 name, lat, lng, address, externalId만 가질 수 있습니다' };
  }
  if (typeof raw.name !== 'string' || clean(raw.name) === '' || clean(raw.name).length > MAX_MEMORY_PLACE_NAME_LENGTH) {
    return { ok: false, error: `place.name은 1~${MAX_MEMORY_PLACE_NAME_LENGTH}자 문자열이어야 합니다` };
  }
  if (!isLat(raw.lat) || !isLng(raw.lng)) return { ok: false, error: 'place.lat은 -90~90, place.lng는 -180~180 숫자여야 합니다' };
  let address = '';
  if (raw.address !== undefined && raw.address !== null) {
    if (typeof raw.address !== 'string' || clean(raw.address).length > MAX_MEMORY_ADDRESS_LENGTH) {
      return { ok: false, error: `place.address는 ${MAX_MEMORY_ADDRESS_LENGTH}자 이하 문자열이어야 합니다` };
    }
    address = clean(raw.address);
  }
  let id = `geo:${raw.lat},${raw.lng}`;
  if (raw.externalId !== undefined && raw.externalId !== null) {
    if (typeof raw.externalId !== 'string' || raw.externalId === '' || raw.externalId.length > MAX_ID_LENGTH - 4 || !EXTERNAL_ID_PATTERN.test(raw.externalId)) {
      return { ok: false, error: 'place.externalId는 영문·숫자·: _ . - 로 된 문자열이어야 합니다' };
    }
    id = `ext:${raw.externalId}`;
  }
  return { ok: true, place: { id, name: clean(raw.name), address, lat: raw.lat, lng: raw.lng } };
}
