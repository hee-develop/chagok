import { isLat, isLng } from './types.js';

/**
 * 일정의 장소 칸 글자가 '정확한 주소'처럼 보이는가. 도로명(`…로·길 12`, `…번길 3-4`)이나 지번(`…동·읍·면·리 100-2`)처럼
 * 이름 끝에 번지가 붙은 글자만 true다. 장소 이름("광주 육전집", "예시 아파트 101동")은 false라 키워드 검색으로 간다.
 * 틀려도 주소 검색이 정확히 한 곳을 못 찾으면 키워드 검색으로 넘어가므로 안전하다(좌표를 잘못 확정하지는 않는다).
 */
export const looksLikeAddress = (text: string): boolean => /(?:로|길|동|읍|면|리)\s*(?:산\s*)?\d+(?:-\d+)?(?:\s*번지)?(?:\s|$)/.test(text.trim());

/** `35.1595, 126.8526`(위도, 경도) 꼴 글자를 좌표로 읽는다. 범위를 벗어나면 null. */
export function parseCoordinateText(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return isLat(lat) && isLng(lng) ? { lat, lng } : null;
}
