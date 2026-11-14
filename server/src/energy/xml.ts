import { MAX_XML_CHARS } from './constants.js';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const assertSize = (xml: string) => {
  if (xml.length > MAX_XML_CHARS) throw new Error('XML 응답이 너무 큽니다');
};

// 자식 요소: `<이름>`, `<이름/>`, 속성이 있는 `<이름 lang="ko">`. 속성 부분은 `<`·`>`를 넘지 않아 되돌아가기가 입력 길이에 비례한다.
const OPEN_TAG = /<(\w+)(?:\s[^<>]*?)?(\/)?>/y;
const CDATA_OPEN = '<![CDATA[';

/**
 * 블록 안쪽의 자식 요소를 { 이름: 글자 }로 읽는다(중첩 요소는 지원하지 않고, 요소의 속성은 읽지 않고 버린다). `fields`가 있으면 그 이름만 담는다.
 * 정규식의 되돌아가기에 기대지 않고 앞에서부터 한 번만 훑으므로, 닫히지 않은 태그가 아무리 많아도 입력 길이에 비례한다.
 */
function parseFields(body: string, fields?: ReadonlySet<string>): Record<string, string> {
  const rec: Record<string, string> = {};
  let noCdataEnd = false; // ']]>'가 한 번 없었으면 그 뒤에도 없다
  let pos = 0;
  while (pos < body.length) {
    const lt = body.indexOf('<', pos);
    if (lt < 0) break;
    OPEN_TAG.lastIndex = lt;
    const m = OPEN_TAG.exec(body);
    if (!m) {
      pos = lt + 1;
      continue;
    }
    const name = m[1];
    const keep = fields === undefined || fields.has(name);
    const afterOpen = lt + m[0].length;
    if (m[2] !== undefined) {
      if (keep) rec[name] = '';
      pos = afterOpen;
      continue;
    }
    const close = `</${name}>`;
    if (body.startsWith(CDATA_OPEN, afterOpen)) {
      if (noCdataEnd) {
        pos = afterOpen;
        continue;
      }
      const end = body.indexOf(']]>', afterOpen + CDATA_OPEN.length);
      if (end < 0) {
        noCdataEnd = true;
        pos = afterOpen;
        continue;
      }
      const afterCdata = end + 3;
      if (body.startsWith(close, afterCdata)) {
        if (keep) rec[name] = body.slice(afterOpen + CDATA_OPEN.length, end);
        pos = afterCdata + close.length;
      } else {
        pos = afterCdata; // 닫는 태그가 없으면 이 요소는 버리고 CDATA 뒤에서 다시 읽는다
      }
      continue;
    }
    const nextLt = body.indexOf('<', afterOpen);
    const textEnd = nextLt < 0 ? body.length : nextLt;
    if (nextLt >= 0 && body.startsWith(close, nextLt)) {
      if (keep) rec[name] = decode(body.slice(afterOpen, textEnd).trim());
      pos = nextLt + close.length;
    } else {
      pos = afterOpen;
    }
  }
  return rec;
}

/**
 * `<tag ...>`로 시작하는 다음 레코드의 여는 태그. `<tag>`·`<tag id="1">`·`<tag/>`를 받고 `<tags>`처럼 이름이 더 긴 태그는 건너뛴다.
 * 속성 값 안의 `>`는 지원하지 않는다. 닫는 `>`가 문서 끝까지 없으면 이후에도 없으므로 null을 돌려 더 찾지 않는다(선형 시간).
 */
function nextOpen(xml: string, tag: string, from: number): { bodyStart: number; empty: boolean } | null {
  const needle = `<${tag}`;
  let pos = from;
  for (;;) {
    const at = xml.indexOf(needle, pos);
    if (at < 0) return null;
    const after = at + needle.length;
    const c = xml.charCodeAt(after);
    if (c === 62) return { bodyStart: after + 1, empty: false };
    if (c === 47 && xml.charCodeAt(after + 1) === 62) return { bodyStart: after + 2, empty: true };
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      const gt = xml.indexOf('>', after);
      if (gt < 0) return null;
      return { bodyStart: gt + 1, empty: xml.charCodeAt(gt - 1) === 47 };
    }
    pos = after;
  }
}

/**
 * 공공데이터포털·오피넷 응답처럼 평평한 XML만 읽는 아주 작은 읽기 도구다.
 * `<tag>` 블록(여는 태그에 속성이 있어도 된다)마다 안쪽 자식 요소를 { 이름: 글자 } 로 돌려준다(중첩 요소는 지원하지 않는다).
 * `fields`를 주면 그 이름의 요소만 담는다(레코드마다 쓰지 않는 수십 개 필드를 만들지 않는다).
 * 닫히지 않은 `<tag>`부터는 읽지 않는다. 문서가 `MAX_XML_CHARS`를 넘으면 던진다.
 *
 * 주의: 돌려주는 글자는 `xml` 원문의 일부를 가리킬 수 있다(`strings.ts`의 `detach`). 오래 들고 있을 값은 복사해서 담는다.
 */
export function xmlRecords(xml: string, tag: string, fields?: readonly string[]): Record<string, string>[] {
  assertSize(xml);
  const keep = fields === undefined ? undefined : new Set(fields);
  const close = `</${tag}>`;
  const out: Record<string, string>[] = [];
  let pos = 0;
  for (;;) {
    const open = nextOpen(xml, tag, pos);
    if (!open) break;
    if (open.empty) {
      out.push({});
      pos = open.bodyStart;
      continue;
    }
    const end = xml.indexOf(close, open.bodyStart);
    if (end < 0) break;
    out.push(parseFields(xml.slice(open.bodyStart, end), keep));
    pos = end + close.length;
  }
  return out;
}

/** 문서 어디에 있든 처음 나온 `<tag>값</tag>`의 값. 없으면 null. */
export function xmlValue(xml: string, tag: string): string | null {
  assertSize(xml);
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(open, pos);
    if (start < 0) return null;
    const bodyStart = start + open.length;
    if (xml.startsWith(CDATA_OPEN, bodyStart)) {
      const end = xml.indexOf(']]>', bodyStart + CDATA_OPEN.length);
      if (end >= 0 && xml.startsWith(close, end + 3)) return xml.slice(bodyStart + CDATA_OPEN.length, end);
      return null; // 이후에도 같은 모양이므로 더 찾지 않는다(선형 시간 유지)
    }
    const nextLt = xml.indexOf('<', bodyStart);
    if (nextLt >= 0 && xml.startsWith(close, nextLt)) return decode(xml.slice(bodyStart, nextLt).trim());
    pos = bodyStart;
  }
}
