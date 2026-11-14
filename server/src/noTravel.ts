/**
 * 이동이 필요 없는 일정을 알아본다(폰 1단계 문구 "온라인 회의나 회의실 일정은 걸러서 차에 보내지 않아요").
 * 정책서 10.3 표 1~3번(종일·온라인·건물 안)의 판정이 이 파일 한 곳에 있다. 두 곳이 쓴다:
 * - 폰(`@chagok/server/no-travel`): 일정을 읽을 때 거르고, 2·3번(온라인·건물 안)에 걸린 일정은 서버로 보내지 않는다.
 * - 서버(`routes/schedules.ts`): 폰이 못 거른 일정(옛 앱, 픽스처·데모 경로)의 안전망. 알아본 일정은 3단계 '이동 없음'과 같이
 *   차량 응답에서 빠지고, 사용자가 장소를 넣으면 다시 차로 간다.
 * 잘못 거르면 사용자가 그 일정을 차에서 잃으므로 확실한 표시만 본다.
 * 예를 들어 '화상' 한 단어는 '화상전문병원'과 헷갈리므로 장소 칸 전체가 '화상'일 때나 '화상회의'처럼 붙은 말만 본다.
 * 건물 안은 정책서 12장의 "실내 표시만 있다"를 그대로 따른다: 실내 표시 말고 고유한 장소 이름이 하나라도 남으면 찾아가는 곳이다.
 * 이 파일은 다른 모듈을 가져오지 않는다(폰의 Metro가 소스 그대로 읽는다).
 */
export type NoTravelReason = 'online' | 'meetingRoom';
/** 폰이 거르는 이유. 종일(allDay)은 서버로 이름만 보내고, 나머지 둘은 보내지 않는다. */
export type TravelFilterReason = 'allDay' | NoTravelReason;

/** 화상 회의 주소의 호스트. 장소 칸이나 메모에 이 주소가 있으면 온라인 회의다. */
const MEETING_HOSTS = [
  'zoom.us',
  'zoom.com',
  'meet.google.com',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'whereby.com',
  'gotomeeting.com',
  'meet.jit.si',
];

/** 한글·영문·숫자가 아닌 곳에서 낱말이 끊긴다고 본다(한국어는 띄어쓰기가 없어 앞뒤 글자를 보고 경계를 정한다). */
const NOT_WORD_BEFORE = '(?<![a-z0-9가-힣])';
const NOT_WORD_AFTER = '(?![a-z0-9가-힣])';

/**
 * 장소 칸에 낱말로 들어 있으면 온라인 회의인 말(소문자, 공백 하나로 정리한 뒤 본다). '강한 말'이다.
 * 앞뒤가 글자로 이어지면 다른 말이다: '온라인마케팅협회 강남사무소'는 해당하지 않는다.
 * 뒤에 '으로'·'로'·'에서'가 붙는 것('온라인으로')은 같은 말로 본다.
 * 'zoom'·'줌'·'teams'·'meet'은 가게 이름일 수 있어('Zoom Cafe 강남', 'zoom 카페') 회의를 뜻하는 말이 뒤에 붙을 때만 강한 말이다('zoom미팅', '줌 회의', 'Teams Meeting').
 */
const ONLINE_STRONG = new RegExp(
  `${NOT_WORD_BEFORE}(?:${[
    '온라인(?:\\s?(?:회의|미팅|강의|면접))?',
    '(?:화상|비대면)\\s?(?:회의|미팅|강의|면접)',
    '(?:zoom|줌|teams|meet)\\s?(?:meeting|call|회의|미팅|모임|링크|link|강의|면접|세미나|웨비나|webinar)',
    'google meet',
    '구글\\s?(?:미트|밋)',
    'microsoft teams',
    'ms teams',
    'webex',
    '웹엑스',
    '팀즈',
    '웨비나',
    'webinar',
  ].join('|')})(?:으로|로|에서)?${NOT_WORD_AFTER}`,
  'g',
);

/** 짧아서 다른 말 안에 섞일 수 있는 '약한 말'. 장소 칸 전체가 이 말(과 '또는' 같은 이음말)뿐일 때만 온라인 회의다('줌 스튜디오'·'화상 병원'·'Zoom Cafe'는 아님). */
const ONLINE_WEAK_WORDS = new Set(['줌', 'zoom', 'teams', 'meet', '화상', '비대면']);
const ONLINE_WEAK = new RegExp(`${NOT_WORD_BEFORE}(?:${[...ONLINE_WEAK_WORDS].join('|')})(?:으로|로|에서)?${NOT_WORD_AFTER}`, 'g');
const JOINER_WORDS = new Set(['또는', '혹은', 'or', 'and', '및']);
/** 온라인 말 옆에 다른 장소가 이어질 수 있는 꼴('온라인 또는 강남역', '강남역 / 온라인'). */
const ALTERNATIVE = /또는|혹은|(?<![a-z0-9가-힣])or(?![a-z0-9가-힣])|(?<![a-z0-9가-힣])and(?![a-z0-9가-힣])|및|[/|+]/;

/** 제목에 들어 있으면 온라인 회의인 말. 장소 칸이 비었을 때만 본다('온라인 회의 준비' 일정이 스타벅스에서 열릴 수 있다). */
const ONLINE_TITLE_PHRASES = [
  '화상회의',
  '화상 회의',
  '화상미팅',
  '화상 미팅',
  '온라인 회의',
  '온라인회의',
  '온라인 미팅',
  '비대면 회의',
  '비대면회의',
  '비대면 미팅',
  '비대면미팅',
  'zoom 미팅',
  'zoom미팅',
  'zoom 회의',
  'zoom회의',
  'zoom meeting',
  '줌 회의',
  '줌회의',
  '줌 미팅',
  '줌미팅',
  'teams 회의',
  'teams회의',
  'teams 미팅',
  'teams meeting',
  '웨비나',
  'webinar',
];

const normalize = (text: string | null) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const URL_HOSTS = /https?:\/\/([^/\s?#:]+)/gi;

const isMeetingHost = (host: string) => MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

/** 주소를 붙여 쓰지 않고 호스트만 적은 것('zoom.us/j/1'). 이메일(@)·다른 주소의 일부('/zoom.us', '=zoom.us')·'zoom.us.example.com'은 제외한다. */
const BARE_HOSTS = new RegExp(
  `(?<![\\w.@/=%-])(?:[\\w-]+\\.)*(?:${MEETING_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})(?![\\w-]|\\.[a-z0-9])`,
  'gi',
);

/**
 * 글에 회의 주소가 있는가. 'link'는 들어가 볼 수 있는 주소(스킴이 있거나 호스트 뒤에 경로가 붙음), 'host'는 호스트 이름만 스쳐 언급된 것.
 * 'zoom.us 녹화본 참고'처럼 호스트만 언급된 메모는 그 일정이 온라인이라는 뜻이 아닐 수 있다.
 */
function meetingMention(text: string | null): 'link' | 'host' | null {
  if (!text) return null;
  for (const m of text.matchAll(URL_HOSTS)) {
    if (isMeetingHost(m[1].toLowerCase())) return 'link';
  }
  let found: 'host' | null = null;
  for (const m of text.matchAll(BARE_HOSTS)) {
    if (text[m.index + m[0].length] === '/') return 'link';
    found = 'host';
  }
  return found;
}

/**
 * 건물 안 표시(정책서 12장): 회의실·미팅룸·룸·라운지·세미나실·강당·○층·○호, 영문 7F·Room 301·meeting/conference/seminar/board room.
 * 강한 표시·약한 표시를 나누지 않는다. 장소 칸에 이 표시와 '일반 말'만 남을 때만 건물 안이고,
 * 고유한 장소 이름(한글이든 영문이든)이 함께 있으면 찾아가는 곳으로 본다: 'Starbucks 2층'·'COEX 3층'·'서울시청 강당'은 거르지 않고
 * '7층 대회의실'·'본사 2층 라운지'·'강당'·'Room 301'·'7F'는 거른다.
 */
const INDOOR_MARKERS: RegExp[] = [
  /회의실|세미나실|강당|라운지/g,
  /meeting\s*room|conference\s*room|seminar\s*room|board\s*room|\broom\b|\blounge\b/g,
  // ○층(지하 포함). '층간'·'층계'는 다른 말이다.
  /\d+\s*층(?!간|계)/g,
  // ○호·○호실. '3호선'·'1호점'·'2호기'처럼 다른 말이 붙으면 실내 표시가 아니다.
  /\d+\s*호(?:실)?(?![가-힣])/g,
  // 7F, 3rd floor
  /\b\d+\s*f\b/g,
  /\b\d+(?:st|nd|rd|th)\s*floor\b/g,
  /\bfloor\b/g,
];

/** ○룸 앞에 붙어도 방 이름인 말. '쇼룸'·'베드룸'·'VIP룸'·'파티룸'은 찾아가는 곳이라 방 표시가 아니다(그 낱말이 그대로 남는다). */
const ROOM_PREFIXES = new Set(['미팅', '스터디', '회의', '세미나', '워크', '화상', '프로젝트']);

/** 방·층 번호표 같은 짧은 기호: 한 글자(A, B)이거나 숫자가 들어간 4자 이하(3A, B1, 4F, 301). */
const isLabel = (token: string) => /^[a-z]$/.test(token) || (/\d/.test(token) && /^[a-z0-9]{1,4}$/.test(token));

/** 건물 안 표시를 걷어낸 나머지에 남아도 건물 이름이 아닌 말(회사 안을 가리키는 말, 크기·위치·안내 말). 사옥·센터·청사 같은 말은 앞에 지명·회사명이 붙으면 이 목록의 말이 아니라 한 낱말이 된다('판교사옥', 'R&D센터'). */
const GENERIC_WORDS = new Set([
  '본사', '사옥', '본관', '신관', '별관', '구관', '센터', '청사', '사무실', '사내', '회사', '우리', '지하', '지상', '옥상',
  '합동', '공동', '큰', '작은', '별도', '임시', '전용', '내부', '외부',
  '출입구', '입구', '비상구', '로비', '복도', '엘리베이터',
  '옆', '앞', '뒤', '위', '아래', '안', '밖', '근처', '쪽', '오른쪽', '왼쪽', '맞은편', '건너편', '자리',
  '이동', '가능', '불가', '예정', '변경', '확인', '필요', '오전', '오후', '또는', '혹은', '및',
  '예약', '예약됨', '장소', '연결', '화상', '링크', '오프라인', '대면', '병행',
  '층', '호', '동', '관', '실', '방',
  'or', 'and', 'the', 'at', 'in', 'of', 'on', 'office', 'hq', 'main', 'building', 'bldg',
]);

const TRAILING_PARTICLES = /(?:으로|에서|에게|까지|부터|로|에|의|은|는|이|가|을|를|과|와|도|만)$/;

/** 사람을 가리키는 꼴: 이름(0~4자) + 직함·호칭('김팀장', '팀장님', '김대리', '철수씨'). 뒤의 소유격('의')은 TRAILING_PARTICLES가 뗀다. */
const PERSON_TOKEN = /^[가-힣]{0,4}(?:팀장|부장|차장|과장|대리|주임|책임|선임|수석|이사|상무|전무|대표|실장|본부장|센터장|파트장|사장|매니저|님|씨)(?:님)?$/;

function isGenericToken(token: string): boolean {
  if (/^\d+$/.test(token) || token.length === 1 || isLabel(token)) return true;
  // 수량·시간 말('5분', '4명', '1번')은 이름이 아니다.
  if (/^\d+(?:분|시간|초|명|개|시|번째|번)$/.test(token)) return true;
  // 제1회의실·제2 세미나실의 '제1'.
  if (/^제\d+$/.test(token)) return true;
  // A동·B관: 알파벳·숫자 기호 뒤의 동·관. 아파트 동·호 주소('102동 1203호')는 주소 꼴이 먼저 거른다.
  if (/^[a-z0-9]+(?:동|관|층|호|실)$/.test(token)) return true;
  if (GENERIC_WORDS.has(token) || PERSON_TOKEN.test(token)) return true;
  const stem = token.replace(TRAILING_PARTICLES, '');
  return stem !== token && (stem === '' || stem.length === 1 || GENERIC_WORDS.has(stem) || PERSON_TOKEN.test(stem));
}

/** 지명 낱말인가: 일반 말·'○○실'·'○○으'(…실로·…으로)로 끝나는 말이 아닌 낱말('비상구'·'입구'·'임시'·'회의실로'는 지명이 아니다). */
const isPlaceName = (stem: string) => stem !== '' && !isGenericToken(stem) && !/[실으]$/.test(stem);

/**
 * 주소 꼴. 건물 안 표시와 같이 있으면 찾아갈 곳이다(정책서 12장). 좁게 본다: 앞에 지명이 붙지 않은 숫자-숫자('회의실 2-1', '301-2호')나
 * 오른쪽으로·합동 세미나실·세미나실로·비상구 회의실로 같은 말은 주소가 아니다. 지명 낱말은 `isPlaceName`으로 확인한다.
 * - 도로명: ○○로·○○길·○○대로 뒤에 건물번호가 붙은 꼴('테헤란로 152'). 뒤가 '분·층·호·명'이면 번호가 아니다('세미나실로 5분').
 * - 번지 꼴: 지명(○○동·리·가·로·길) 뒤의 숫자-숫자('역삼동 123-4'), ○번지.
 * - 아파트: ○동 ○호('102동 1203호').
 * - 행정구역: ○시·○군·○구 뒤에 공백을 두고 동·로·길·읍·면·리로 이어지는 지명 꼴('강남구 역삼동'). 앞말이 일반 말이면 아니다('비상구 회의실로').
 *   광역·시군구 이름 자체는 고유한 장소 이름이라 낱말 규칙이 이미 거르지 않는다.
 */
const ROAD_ADDRESS = /(?<![가-힣])([가-힣]{2,}\d*(?:대로|로|길))\s*\d+(?![\d]|\s*[층분호명시개])/g;
const LOT_ADDRESS = /(?<![가-힣])([가-힣]{2,}\d*(?:동|리|가|로|길))\s*\d+-\d+/g;
const DISTRICT_ADDRESS = /(?<![가-힣])([가-힣]+(?:시|군|구))\s+([가-힣0-9]+(?:동|로|길|읍|면|리))(?![가-힣])/g;
const stemOf = (word: string) => word.replace(/\d*(?:대로|로|길|동|리|가|읍|면)$/, '');

function isAddress(location: string): boolean {
  if (/\d+\s*번지/.test(location) || /\d+\s*동\s*\d+\s*호/.test(location)) return true;
  for (const m of location.matchAll(ROAD_ADDRESS)) if (isPlaceName(stemOf(m[1]))) return true;
  for (const m of location.matchAll(LOT_ADDRESS)) if (isPlaceName(stemOf(m[1]))) return true;
  for (const m of location.matchAll(DISTRICT_ADDRESS)) {
    if (!isGenericToken(m[1]) && isPlaceName(stemOf(m[2]))) return true;
  }
  return false;
}

/** 건물 안 표시를 지운 나머지 글과 표시가 하나라도 있었는지. */
function stripIndoor(location: string): { rest: string; matched: boolean } {
  let matched = false;
  // ○룸: 앞이 비었거나 방 이름 앞말·번호표일 때만 방 표시다.
  let rest = location.replace(/(?<![a-z0-9가-힣])[a-z0-9가-힣]*룸/g, (word) => {
    const prefix = word.slice(0, -1);
    if (prefix !== '' && !ROOM_PREFIXES.has(prefix) && !isLabel(prefix)) return word;
    matched = true;
    return ' ';
  });
  for (const re of INDOOR_MARKERS) {
    rest = rest.replace(re, () => {
      matched = true;
      return ' ';
    });
  }
  return { rest, matched };
}

/** 일반 말이 아닌 낱말(고유한 장소 이름일 수 있는 말)이 남아 있는가. 'R&D센터'처럼 &로 이어진 말은 한 낱말이다. */
const hasProperName = (text: string) =>
  text
    .split(/[^a-z0-9가-힣&]+/)
    .filter(Boolean)
    .some((token) => !isGenericToken(token));

/** 장소 칸에 건물 안 표시와 일반 말만 있는가. */
function isIndoorOnly(location: string): boolean {
  const { rest, matched } = stripIndoor(location);
  if (!matched) return false;
  if (isAddress(location)) return false;
  return !hasProperName(rest);
}

/** '줌으로'·'zoom에서'의 조사를 뗀다(약한 말일 때만). */
const withoutParticle = (word: string) => {
  const m = /^(.+?)(?:으로|에서|로)$/.exec(word);
  return m !== null && ONLINE_WEAK_WORDS.has(m[1]) ? m[1] : word;
};

/**
 * 장소 칸이 온라인 회의인가.
 * - 강한 말('온라인', 'Google Meet', 'zoom미팅' …)이 있으면 온라인이다. 다만 '또는'·'/'로 다른 장소가 이어지고 그 밖에 고유한 장소 이름이 남으면
 *   ('온라인 또는 강남역', '강남역 / 온라인') 찾아갈 수도 있는 일정이라 거르지 않는다. 건물 안 표시·일반 말뿐이면('7층 회의실 또는 온라인') 둘 다 이동이 없다.
 * - 약한 말('zoom', '줌', 'Teams', 'Meet', '화상', '비대면')은 장소 칸 전체가 그 말뿐일 때만 온라인이다.
 */
function isOnlinePlace(location: string): boolean {
  const rest = location.replace(ONLINE_STRONG, ' ');
  if (rest !== location) {
    if (!ALTERNATIVE.test(location)) return true;
    return !hasProperName(stripIndoor(rest.replace(ONLINE_WEAK, ' ')).rest);
  }
  const words = location
    .split(/[^a-z0-9가-힣]+/)
    .filter(Boolean)
    .map(withoutParticle);
  return words.length > 0 && words.some((w) => ONLINE_WEAK_WORDS.has(w)) && words.every((w) => ONLINE_WEAK_WORDS.has(w) || JOINER_WORDS.has(w));
}

/**
 * 일정 하나가 이동이 필요 없는지와 그 이유. 해당하지 않으면 null. 온라인 회의를 건물 안보다 먼저 본다.
 * - 장소·메모의 회의 주소(링크)는 온라인이다. 메모에 호스트 이름만 스쳐 언급된 것은 장소 칸이 비었을 때만 온라인으로 본다.
 * - 제목만으로 보는 규칙('온라인 회의')도 장소 칸이 비었을 때만 쓴다. 장소 칸에 실제 장소가 있으면 그곳으로 간다.
 */
export function detectNoTravel(schedule: { title: string; locationText: string | null; notes: string | null }): NoTravelReason | null {
  const location = normalize(schedule.locationText);
  const blank = location === '';
  const inLocation = meetingMention(schedule.locationText);
  const inNotes = meetingMention(schedule.notes);
  if (
    inLocation !== null ||
    inNotes === 'link' ||
    (blank && inNotes === 'host') ||
    isOnlinePlace(location) ||
    (blank && ONLINE_TITLE_PHRASES.some((w) => normalize(schedule.title).includes(w)))
  ) {
    return 'online';
  }
  if (isIndoorOnly(location)) return 'meetingRoom';
  return null;
}

/**
 * 정책서 10.3 표 1~3번을 순서대로 본다: 종일 → 온라인 → 건물 안. 해당하지 않으면 null.
 * 종일 일정은 이동 대상이 아니다(이름만 보낸다). 장소 칸이 빈 일정은 거르지 않는다(null).
 */
export function travelFilterReason(event: {
  allDay: boolean;
  title: string;
  locationText: string | null;
  notes: string | null;
}): TravelFilterReason | null {
  if (event.allDay) return 'allDay';
  return detectNoTravel(event);
}
