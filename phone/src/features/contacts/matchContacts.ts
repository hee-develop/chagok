import type { Contact } from './contactsSource';

/**
 * 연락 상대 찾기 매칭 규칙(정책서 10.5). AI 없이 글자만 본다. 순수 함수라 폰 연락처 모듈이 없어도 표로 테스트한다.
 * - 참석자: 참석자의 **이메일**(대소문자 무시)이나 **이름**(공백·대소문자 무시, 전체가 같아야 함)이 연락처에 있으면 그 사람.
 * - 제목·메모 속 이름: 연락처의 **전체 이름**, 또는 **성을 뺀 두 글자 이상 이름**이 들어 있으면 그 사람("민수랑 저녁" → 김민수).
 *   "엄마"·"김 과장님" 같은 호칭은 연락처에 **그 이름으로 저장된 경우에만** 맞는다(전체 이름 일치뿐, 성을 뺀 이름은 만들지 않는다).
 * - 결과: 한 명이면 그 사람, 두 명이면 두 후보, **세 명 이상이면 못 찾은 것**(빈 목록).
 * 서버에는 표시 이름만 보낸다(`matchContacts`는 이름만 돌려준다. 번호·이메일은 폰 안에 둔다).
 */

/** 정책서 12장 '연락 상대 후보 2명까지'(가안). 세 명 이상이면 못 찾은 것으로 본다. */
export const MAX_CONTACT_CANDIDATES = 2;

/**
 * 이름 앞뒤가 다른 낱말의 일부면 맞지 않는다('국민수영장'에서 '민수'). 앞은 글자·숫자가 아니어야 하고, 뒤는 글자·숫자가 아니거나 조사·호칭이 이어져야 한다.
 * 한글 낱말 끝의 조사·호칭 목록은 가안이다('민수이야기'처럼 '이'로 시작하는 낱말은 못 거른다).
 */
const WORD_CHAR = /[0-9a-zㄱ-ㆎ가-힣]/;
const HANGUL = /[ㄱ-ㆎ가-힣]/;
const PARTICLES =
  /^(?:이랑|랑|이와|와|과|이가|가|이는|은|는|이를|을|를|이도|도|만|이의|의|에게서|에게|한테서|한테|께|씨|님|이네|네|아|야|형|누나|오빠|언니|군|양|하고|이하고|이)+(?![ㄱ-ㆎ가-힣])/;

const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** 한글 이름 + 흔한 복성(성이 두 글자). 이 목록이 아니면 성은 한 글자로 본다. */
const COMPOUND_SURNAMES = ['남궁', '황보', '제갈', '사공', '선우', '독고', '서문', '동방', '어금', '망절'];
/** 호칭·관계 말: 사람 이름처럼 3~4글자라도 성을 떼어 이름을 만들지 않는다('할머니' → '머니'). */
const KINSHIP = new Set([
  '어머니', '아버지', '할머니', '할아버지', '외할머니', '외할아버지', '시어머니', '시아버지', '장모님', '장인어른',
  '아버님', '어머님', '이모부', '고모부', '사돈', '선생님', '사모님', '사장님', '대표님', '팀장님', '부장님', '과장님', '차장님', '이사님',
]);

/** 성을 뺀 이름(두 글자 이상). 사람 이름처럼 보이지 않으면 null이다. */
export function givenNameOf(name: string, osGivenName?: string): string | null {
  const full = name.normalize('NFC').trim();
  // OS가 성·이름을 나눠 준 연락처는 그 이름 부분을 믿는다(전체와 같으면 나뉜 것이 아니다).
  if (osGivenName !== undefined) {
    const given = osGivenName.normalize('NFC').replace(/\s+/g, '');
    if (given.length >= 2 && given.length < full.replace(/\s+/g, '').length) return given;
  }
  if (!/^[가-힣]{3,4}$/.test(full) || KINSHIP.has(full) || full.endsWith('님')) return null;
  const given = full.length === 4 && COMPOUND_SURNAMES.includes(full.slice(0, 2)) ? full.slice(2) : full.slice(1);
  return given.length >= 2 ? given : null;
}

type Person = {
  /** 응답에 쓰는 표시 이름(연락처에 저장된 그대로, 공백만 정리). */
  display: string;
  key: string;
  /** 제목·메모에서 찾을 글자(전체 이름, 있으면 성을 뺀 이름). */
  needles: string[];
  emails: Set<string>;
};

export type ContactIndex = {
  people: Person[];
  byEmail: Map<string, Person>;
  byName: Map<string, Person>;
};

/**
 * 연락처를 한 번 색인한다(일정마다 다시 만들지 않는다). 번호가 하나도 없는 연락처는 문자를 보낼 수 없으므로 뺀다.
 * 같은 이름(공백·대소문자만 다름)은 한 사람으로 합친다: 서버에는 표시 이름만 가므로 같은 이름 둘을 따로 후보로 내도 차가 구별할 수 없다
 * (번호가 서로 다르면 보낼 때 `findNumberByDisplayName`이 고르지 못하고 번호를 묻는다).
 */
export function indexContacts(contacts: readonly Contact[]): ContactIndex {
  const people: Person[] = [];
  const byEmail = new Map<string, Person>();
  const byName = new Map<string, Person>();
  for (const contact of contacts) {
    const display = contact.name.replace(/\s+/g, ' ').trim();
    if (display === '' || contact.phones.every((p) => p.trim() === '')) continue;
    const key = normalize(display);
    let person = byName.get(key);
    if (!person) {
      const given = givenNameOf(display, contact.givenName);
      person = { display, key, needles: given === null ? [key] : [key, normalize(given)], emails: new Set() };
      people.push(person);
      byName.set(key, person);
    }
    for (const email of contact.emails) {
      const e = email.trim().toLowerCase();
      if (e !== '' && !byEmail.has(e)) {
        byEmail.set(e, person);
        person.emails.add(e);
      }
    }
  }
  return { people, byEmail, byName };
}

/** 글자 속에서 낱말로 서 있는 첫 위치. 없으면 -1. */
export function wordIndexOf(text: string, needle: string): number {
  if (needle === '') return -1;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = at === 0 ? '' : text[at - 1]!;
    if (before !== '' && WORD_CHAR.test(before)) continue;
    const rest = text.slice(at + needle.length);
    const next = rest[0];
    if (next === undefined || !WORD_CHAR.test(next)) return at;
    if (HANGUL.test(next) && PARTICLES.test(rest)) return at;
  }
  return -1;
}

export type MatchInput = {
  title: string;
  notes: string | null;
  attendeeNames: readonly string[];
  attendeeEmails: readonly string[];
};

/**
 * 일정 하나의 연락 상대 표시 이름. 참석자 → 제목 → 메모 순이고 같은 곳에서는 글에 먼저 나온 순이다.
 * 세 명 이상이면 못 찾은 것이라 빈 목록이다.
 */
export function matchContacts(index: ContactIndex, input: MatchInput): string[] {
  const found: Person[] = [];
  const add = (person: Person | undefined) => {
    if (person && !found.includes(person)) found.push(person);
  };
  for (const email of input.attendeeEmails) add(index.byEmail.get(email.trim().toLowerCase()));
  for (const name of input.attendeeNames) add(index.byName.get(normalize(name)));
  for (const raw of [input.title, input.notes ?? '']) {
    const text = normalize(raw);
    if (text === '') continue;
    const hits: { person: Person; at: number }[] = [];
    for (const person of index.people) {
      let at = -1;
      for (const needle of person.needles) {
        const i = wordIndexOf(text, needle);
        if (i !== -1 && (at === -1 || i < at)) at = i;
      }
      if (at !== -1) hits.push({ person, at });
    }
    hits.sort((a, b) => a.at - b.at || a.person.key.localeCompare(b.person.key));
    for (const hit of hits) add(hit.person);
  }
  return found.length > MAX_CONTACT_CANDIDATES ? [] : found.map((p) => p.display);
}
