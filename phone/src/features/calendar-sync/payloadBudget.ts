/** 서버 본문 상한(1MB, server/src/limits.ts MAX_EVENTS_BODY_BYTES)에서 여유를 둔 보내기 예산. */
export const PAYLOAD_BUDGET_BYTES = 900 * 1024;

/** 문자열의 UTF-8 바이트 수(JSON 이스케이프 전 기준, 이스케이프 여유는 예산의 여유분이 맡는다). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // 서로게이트 쌍은 4바이트
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** 일정을 앞에서부터 담아 직렬화 크기가 예산을 넘기기 전까지만 남긴다(넘기면 서버가 413으로 거절하므로 덜어 보낸다). */
export function fitToBudget<T extends object>(events: T[], maxBytes: number = PAYLOAD_BUDGET_BYTES): T[] {
  let total = '{"events":[]}'.length;
  const kept: T[] = [];
  for (const event of events) {
    const size = utf8Length(JSON.stringify(event)) + 1; // 쉼표 포함
    if (total + size > maxBytes) break;
    total += size;
    kept.push(event);
  }
  return kept;
}
