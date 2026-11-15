import { isNumberOrEmailLike } from '@chagok/server/contact-name';

import type { Contact } from './contactsSource';

/**
 * 연락 상대 찾기 매칭 규칙(정책서 10.5). AI 없이 글자만 본다. 순수 함수라 폰 연락처 모듈이 없어도 표로 테스트한다.
 * - 참석자: 참석자의 **이메일**(대소문자 무시)이나 **이름**(공백·대소문자 무시, 전체가 같아야 함)이 연락처에 있으면 그 사람.
 * - 제목·메모 속 이름: 연락처의 **전체 이름**, 또는 **성을 뺀 두 글자 이상 이름**이 들어 있으면 그 사람("민수랑 저녁" → 김민수).
 *   "엄마"·"김 과장님" 같은 호칭은 연락처에 **그 이름으로 저장된 경우에만** 맞는다.
 * - 결과: 한 명이면 그 사람, 두 명이면 두 후보, **세 명 이상이면 못 찾은 것**(빈 목록).
 * 서버에는 표시 이름만 보낸다(`matchContacts`는 이름만 돌려준다. 번호·이메일은 폰 안에 둔다).
 *
 * 오탐은 엉뚱한 사람에게 문자를 보내게 하므로 **미탐 쪽으로 기울인다**(아래 규칙은 가안이고 문서에 '사용자 확인 필요'로 적었다, `docs/contacts.md`):
 * 1. 성을 뺀 이름은 **조사·호칭이 붙었을 때만** 맞춘다('민수랑'·'민수와'·'민수씨'·'민수 형'·'민수에게'는 맞고 '지원 회의'·'민수 저녁'은 아니다).
 * 2. **메모에서는 전체 이름만** 본다(성을 뺀 이름은 제목에서만).
 * 3. 전체 이름(저장된 이름 그대로)도 낱말 경계를 지킨다. 두 글자 이하 한글 이름('오늘', '민수')은 흔한 낱말과 겹치기 쉬워 성을 뺀 이름처럼 조사·호칭이 붙었을 때만 맞춘다.
 *    호칭·관계 말('엄마'), 세 글자 이상 이름('김민수'), 띄어쓰기·영문이 든 이름('김 과장님')은 조사 없이도 맞는다.
 * 4. 직함·관계 말('팀장'·'과장'·'엄마'·'언니'…)은 성을 뺀 이름으로 만들지 않는다(OS가 성·이름을 나눠 준 경우도 같다).
 *    그래서 '팀장 면담'이 박팀장을, '엄마 생신'이 큰엄마를 부르지 않는다. 호칭은 '그 이름 그대로 저장된 경우에만' 맞는다.
 */

/** 정책서 12장 '연락 상대 후보 2명까지'(가안). 세 명 이상이면 못 찾은 것으로 본다. */
export const MAX_CONTACT_CANDIDATES = 2;

const WORD_CHAR = /[0-9a-zㄱ-ㆎ가-힣]/;
const HANGUL = /[ㄱ-ㆎ가-힣]/;
const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** 직함(성 뒤에 붙는 직책·호칭). 성을 뺀 이름으로 쓰지 않고, 이름 뒤 호칭으로 쓰인다. */
const TITLES = [
  '팀장', '과장', '부장', '차장', '대리', '사원', '주임', '사장', '실장', '원장', '이사', '대표', '상무', '전무', '본부장', '센터장', '소장', '국장', '처장',
  '선생', '교수', '박사', '의사', '간호사', '기사', '사모', '매니저', '총무', '반장', '회장', '위원장', '조교',
];
/** 관계 말. 성을 뺀 이름으로 쓰지 않고, 연락처에 이 이름 그대로 저장된 경우에만 맞는다. */
const KINSHIP = [
  '엄마', '아빠', '어머니', '아버지', '어머님', '아버님', '할머니', '할아버지', '외할머니', '외할아버지', '언니', '오빠', '누나', '형', '동생', '이모', '고모', '삼촌',
  '외삼촌', '숙모', '이모부', '고모부', '조카', '아들', '딸', '남편', '아내', '와이프', '신랑', '여보', '자기', '장모님', '장인어른', '시어머니', '시아버지',
  '사돈', '친구', '선배', '후배', '형님', '누님', '처남', '매형', '엄마친구',
];
const TITLE_SET = new Set(TITLES);
const KIN_SET = new Set(KINSHIP);

/** 직함·관계 말인가('님'·'씨'를 붙인 말 포함: '과장님', '언니씨'). 성을 뺀 이름이 이것이면 이름으로 만들지 않는다. */
export function isTitleOrKinship(word: string): boolean {
  const w = word.normalize('NFC').replace(/\s+/g, '');
  const bare = w.endsWith('님') || w.endsWith('씨') ? w.slice(0, -1) : w;
  return TITLE_SET.has(w) || KIN_SET.has(w) || TITLE_SET.has(bare) || KIN_SET.has(bare);
}

/**
 * 이름 뒤에 붙을 수 있는 조사·호칭. **정규식 반복(`(…)+`)을 쓰지 않고** 미리 만든 집합에서 찾는다(반복 정규식은 긴 입력에서 지수 시간이 걸렸다).
 * 한 낱말 끝에 붙는 한글 덩어리(최대 `MAX_SUFFIX`글자)가 집합에 있어야 한다. 조사 하나, 또는 조사 + 보조 조사 하나('와의', '이랑은', '씨에게')까지만 받는다.
 * 붙은 덩어리가 목록에 있을 때만 맞으므로('민수이야기'는 아님) 목록에 없는 조사는 놓친다(미탐 쪽 가안).
 */
const MAX_SUFFIX = 8;
const PARTICLES = ['이랑', '랑', '이와', '와', '과', '이가', '가', '이는', '은', '는', '이를', '을', '를', '이도', '도', '만', '이의', '의', '에게서', '에게', '한테서', '한테', '께', '이네', '네', '아', '야', '하고', '이하고', '이'];
const SECOND_PARTICLES = ['는', '은', '도', '만', '의', '가', '이', '를', '을', '에게', '한테', '께', '랑', '과', '와'];
/** 이름 바로 뒤나 띄어쓰기 뒤에 오는 호칭('민수씨', '민수 형', '민수 팀장님'). */
const HONORIFICS = ['씨', '님', '군', '양', '쌤', '형', '형님', '누나', '누님', '오빠', '언니', '선배', '선배님', '후배', '동생', ...TITLES, ...TITLES.map((t) => `${t}님`)];

const ATTACHED = new Set<string>(PARTICLES);
for (const a of PARTICLES) for (const b of SECOND_PARTICLES) ATTACHED.add(a + b);
const HONORIFIC_SET = new Set<string>();
for (const h of HONORIFICS) {
  HONORIFIC_SET.add(h);
  for (const p of PARTICLES) HONORIFIC_SET.add(h + p);
}
for (const h of HONORIFIC_SET) ATTACHED.add(h);

/** text[from..]에서 이어지는 한글 덩어리(최대 limit글자). 더 이어지면 길이가 limit+1이 된다. */
function hangulRun(text: string, from: number, limit: number): string {
  let end = from;
  while (end < text.length && end - from <= limit && HANGUL.test(text[end]!)) end++;
  return text.slice(from, end);
}

/**
 * 이름 뒤가 어떤 모양인가. 'attached' 조사·호칭이 붙었다('민수랑', '민수씨', '민수 형'), 'end' 낱말이 거기서 끝난다('민수 저녁', '민수,'),
 * 'other' 다른 낱말의 일부다('민수영장', 'alex2').
 */
function suffixOf(text: string, end: number): 'attached' | 'end' | 'other' {
  const next = text[end];
  if (next === undefined) return 'end';
  if (HANGUL.test(next)) {
    const run = hangulRun(text, end, MAX_SUFFIX);
    return run.length <= MAX_SUFFIX && ATTACHED.has(run) ? 'attached' : 'other';
  }
  if (WORD_CHAR.test(next)) return 'other';
  // 띄어쓰기 뒤 호칭('민수 형', '민수 팀장님'): 공백 1~3칸 다음 한글 덩어리가 호칭(+조사)이어야 한다.
  let at = end;
  while (at < text.length && at - end < 3 && text[at] === ' ') at++;
  if (at > end && at < text.length && HANGUL.test(text[at]!)) {
    const run = hangulRun(text, at, MAX_SUFFIX);
    if (run.length <= MAX_SUFFIX && HONORIFIC_SET.has(run)) return 'attached';
  }
  return 'end';
}

/**
 * 글자 속에서 이름이 낱말로 서 있는 첫 위치(없으면 -1). 앞이 글자·숫자면 아니다('국민수영장'의 '민수').
 * `attachedOnly`면 조사·호칭이 붙었을 때만 맞는다(성을 뺀 이름·두 글자 이하 흔한 이름). 아니면 낱말이 끝나도 맞는다.
 */
export function wordIndexOf(text: string, needle: string, attachedOnly = false): number {
  if (needle === '') return -1;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = at === 0 ? '' : text[at - 1]!;
    if (before !== '' && WORD_CHAR.test(before)) continue;
    const kind = suffixOf(text, at + needle.length);
    if (kind === 'attached' || (kind === 'end' && !attachedOnly)) return at;
  }
  return -1;
}

/** 한글 이름 + 흔한 복성(성이 두 글자). 이 목록이 아니면 성은 한 글자로 본다. */
const COMPOUND_SURNAMES = ['남궁', '황보', '제갈', '사공', '선우', '독고', '서문', '동방', '어금', '망절'];

/**
 * 성을 뺀 이름(두 글자 이상). 사람 이름처럼 보이지 않거나 직함·관계 말이면 null이다. OS가 성·이름을 나눠 준 연락처도 같은 검사를 거친다.
 * ('팀장' → 박팀장, '언니' → 친언니, '엄마' → 큰엄마를 부르지 않는다.)
 */
export function givenNameOf(name: string, osGivenName?: string): string | null {
  const full = name.normalize('NFC').trim();
  let given: string | null = null;
  // OS가 성·이름을 나눠 준 연락처는 그 이름 부분을 믿는다(전체와 같으면 나뉜 것이 아니다).
  if (osGivenName !== undefined) {
    const os = osGivenName.normalize('NFC').replace(/\s+/g, '');
    if (os.length >= 2 && os.length < full.replace(/\s+/g, '').length) given = os;
  }
  if (given === null) {
    if (!/^[가-힣]{3,4}$/.test(full) || KIN_SET.has(full) || full.endsWith('님')) return null;
    given = full.length === 4 && COMPOUND_SURNAMES.includes(full.slice(0, 2)) ? full.slice(2) : full.slice(1);
  }
  return given.length >= 2 && !isTitleOrKinship(given) ? given : null;
}

type Needle = {
  text: string;
  /** true면 조사·호칭이 붙었을 때만 맞는다. */
  attachedOnly: boolean;
  /** true면 제목에서만 찾는다(메모에서는 전체 이름만 본다). */
  titleOnly: boolean;
};

type Person = {
  /** 응답에 쓰는 표시 이름(연락처에 저장된 그대로, 공백만 정리). */
  display: string;
  key: string;
  needles: Needle[];
  emails: Set<string>;
};

export type ContactIndex = {
  people: Person[];
  byEmail: Map<string, Person>;
  byName: Map<string, Person>;
};

/** 저장된 이름 그대로가 조사 없이도 맞아도 되는가: 호칭·관계 말, 세 글자 이상 이름, 띄어쓰기·영문이 든 이름. 두 글자 이하 한글 이름은 아니다. */
function bareAllowed(key: string): boolean {
  return isTitleOrKinship(key) || key.length >= 3;
}

/**
 * 연락처를 한 번 색인한다(일정마다 다시 만들지 않는다). 번호가 하나도 없는 연락처는 문자를 보낼 수 없으므로 뺀다.
 * 이름이 번호·이메일 모양인 연락처도 뺀다: Android는 이름이 없는 연락처의 표시 이름을 번호·이메일로 채우므로 그대로 서버에 나가면 번호가 샌다.
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
    if (isNumberOrEmailLike(display)) continue;
    const key = normalize(display);
    let person = byName.get(key);
    if (!person) {
      const needles: Needle[] = [{ text: key, attachedOnly: !bareAllowed(key), titleOnly: false }];
      const given = givenNameOf(display, contact.givenName);
      if (given !== null) needles.push({ text: normalize(given), attachedOnly: true, titleOnly: true });
      person = { display, key, needles, emails: new Set() };
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
  const sources: { text: string; isTitle: boolean }[] = [
    { text: normalize(input.title), isTitle: true },
    { text: normalize(input.notes ?? ''), isTitle: false },
  ];
  for (const { text, isTitle } of sources) {
    if (text === '') continue;
    const hits: { person: Person; at: number }[] = [];
    for (const person of index.people) {
      let at = -1;
      for (const needle of person.needles) {
        if (needle.titleOnly && !isTitle) continue;
        const i = wordIndexOf(text, needle.text, needle.attachedOnly);
        if (i !== -1 && (at === -1 || i < at)) at = i;
      }
      if (at !== -1) hits.push({ person, at });
    }
    hits.sort((a, b) => a.at - b.at || a.person.key.localeCompare(b.person.key));
    for (const hit of hits) add(hit.person);
  }
  return found.length > MAX_CONTACT_CANDIDATES ? [] : found.map((p) => p.display);
}
