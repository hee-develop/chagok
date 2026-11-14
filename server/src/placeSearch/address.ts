import { isLat, isLng } from './types.js';

/**
 * 일정의 장소 칸 글자가 '정확한 주소'처럼 보이는가. 도로명(`…로·길 12`, `…번길 3-4`)이나 지번(`…동·읍·면·리 100-2`)처럼
 * 이름 끝에 번지가 붙은 글자만 true다. 장소 이름("광주 육전집", "예시 아파트 101동")은 false라 키워드 검색으로 간다.
 * 틀려도 주소 검색이 정확히 한 곳을 못 찾으면 키워드 검색으로 넘어가므로 안전하다(좌표를 잘못 확정하지는 않는다).
 */
export const looksLikeAddress = (text: string): boolean => /(?:로|길|동|읍|면|리)\s*(?:산\s*)?\d+(?:-\d+)?(?:\s*번지)?(?:\s|$)/.test(text.trim());

/** 한국의 위도·경도 범위(도). 좌표 글자는 이 안일 때만 좌표로 본다. */
export const KOREA_LAT_RANGE = [33, 39] as const;
export const KOREA_LNG_RANGE = [124, 132] as const;

/**
 * `35.1595, 126.8526`(위도, 경도) 꼴 글자를 좌표로 읽는다. **소수점 아래 3자리 이상인 두 수**이고 한국 범위(위도 33~39, 경도 124~132)일 때만
 * 좌표다. 장소 이름·층수·호수 같은 `10 30`·`3, 15`·`35 126`을 좌표로 오판하지 않기 위해서다. 아니면 null.
 */
export function parseCoordinateText(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,3}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const inKorea = lat >= KOREA_LAT_RANGE[0] && lat <= KOREA_LAT_RANGE[1] && lng >= KOREA_LNG_RANGE[0] && lng <= KOREA_LNG_RANGE[1];
  return inKorea && isLat(lat) && isLng(lng) ? { lat, lng } : null;
}
