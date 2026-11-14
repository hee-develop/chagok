const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/**
 * 공공데이터포털·오피넷 응답처럼 평평한 XML만 읽는 아주 작은 읽기 도구다.
 * `<tag>` 블록마다 안쪽 자식 요소를 { 이름: 글자 } 로 돌려준다(중첩 요소는 지원하지 않는다).
 */
export function xmlRecords(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const block = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  for (const m of xml.matchAll(block)) {
    const rec: Record<string, string> = {};
    const field = /<(\w+)\s*\/>|<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\2>/g;
    for (const f of m[1].matchAll(field)) {
      if (f[1] !== undefined) rec[f[1]] = '';
      else rec[f[2]] = f[3] !== undefined ? f[3] : decode((f[4] ?? '').trim());
    }
    out.push(rec);
  }
  return out;
}

/** 문서 어디에 있든 처음 나온 `<tag>값</tag>`의 값. 없으면 null. */
export function xmlValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`).exec(xml);
  if (!m) return null;
  return m[1] !== undefined ? m[1] : decode(m[2].trim());
}
