/**
 * 이동이 필요 없는 일정을 알아본다(폰 1단계 문구 "온라인 회의나 회의실 일정은 걸러서 차에 보내지 않아요").
 * 정책서 10.3 표 1~3번(종일·온라인·건물 안)의 판정이 이 파일 한 곳에 있다. 두 곳이 쓴다:
 * - 폰(`@chagok/server/no-travel`): 일정을 읽을 때 거르고, 2·3번(온라인·건물 안)에 걸린 일정은 서버로 보내지 않는다.
 * - 서버(`routes/schedules.ts`): 폰이 못 거른 일정(옛 앱, 픽스처·데모 경로)의 안전망. 알아본 일정은 3단계 '이동 없음'과 같이
 *   차량 응답에서 빠지고, 사용자가 장소를 넣으면 다시 차로 간다.
 * 잘못 거르면 사용자가 그 일정을 차에서 잃으므로 확실한 표시만 본다.
 * 예를 들어 '화상' 한 단어는 '화상전문병원'과 헷갈리므로 장소 칸 전체가 '화상'일 때나 '화상회의'처럼 붙은 말만 본다.
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

/** 장소 칸에 들어 있으면 온라인 회의인 말(소문자, 공백 하나로 정리한 뒤 포함 여부). */
const ONLINE_PLACE_PHRASES = [
  '온라인',
  '화상회의',
  '화상 회의',
  '화상미팅',
  '화상 미팅',
  '비대면회의',
  '비대면 회의',
  '비대면미팅',
  '비대면 미팅',
  'zoom',
  'google meet',
  '구글 미트',
  '구글미트',
  'microsoft teams',
  'ms teams',
  'webex',
  '웹엑스',
  '팀즈',
];

/** 장소 칸 전체가 이 말 하나뿐이면 온라인 회의다. 짧아서 다른 말 안에 섞일 수 있는 것('줌바')만 여기에 둔다. */
const ONLINE_PLACE_WORDS = ['줌', 'teams', 'meet', '화상', '비대면'];

/** 제목에 들어 있으면 온라인 회의인 말. */
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
];

/**
 * 건물 안 표시 중 '그 자체로 방'인 말. 주소 표시가 없으면 이것만으로 건물 안이다(소문자·공백 정리 뒤에 본다).
 * '쇼룸'·'베드룸'처럼 실제로 찾아가는 곳은 보지 않으므로 ○룸은 앞말이 정해진 것만 본다.
 */
const INDOOR_ROOM_MARKERS: RegExp[] = [
  /회의실/,
  /미팅룸/,
  /세미나실/,
  /강당/,
  /meeting room/,
  /conference room/,
  /seminar room/,
  /[a-z0-9]\s*룸/, // 3A룸
  /(?:스터디|회의|세미나|워크|화상|프로젝트)룸/,
  /(?:^|\s)룸(?:\s|$)/,
];

/**
 * 층·호·라운지는 '롯데월드몰 8층'·'챔피언스필드 2층'·'공항 라운지'처럼 건물 이름 뒤에도 붙어 찾아가는 곳을 가리킬 수 있다.
 * 그래서 장소 칸에 이 표시(와 아래 일반 말)만 있을 때(예: '5층', '301호', '본사 2층 라운지')만 건물 안으로 본다.
 */
const INDOOR_WEAK_MARKERS: RegExp[] = [
  /라운지/,
  /lounge/,
  // ○층(지하 포함). '층간'·'층계'는 다른 말이다.
  /\d\s*층(?!간|계)/,
  // ○호·○호실. '3호선'·'1호점'·'2호기'처럼 다른 말이 붙으면 실내 표시가 아니다.
  /\d\s*호(?:실)?(?![가-힣])/,
];

/** 약한 표시만 있다고 볼 때 건물 이름으로 치지 않는 말(회사 안을 가리키는 말, 동·관 기호). */
const GENERIC_INDOOR_WORDS = /본사|사옥|본관|신관|별관|사무실|사내|지하|옥상|[a-z0-9]+\s*(?:동|관)|[a-z0-9]+/g;

/**
 * 주소 표시. 실내 표시와 같이 있으면 찾아갈 곳이므로 거르지 않는다(정책서 12장).
 * 말이 길게 겹쳐도 거르지 않는 쪽으로만 틀리므로 넓게 본다: ○○로·○○길·○○대로·○○동·번지·○○구·○○시·○○읍·○○면.
 */
const ADDRESS_MARKERS: RegExp[] = [
  /[가-힣0-9]+(?:대로|로|길)(?![가-힣])/,
  /[가-힣]+동(?![가-힣])/,
  /\d+(?:-\d+)?\s*번지/,
  /[가-힣]{2,}(?:구|군|읍|면|시)(?![가-힣])/,
];

const normalize = (text: string | null) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const URL_HOSTS = /https?:\/\/([^/\s?#:]+)/gi;

const isMeetingHost = (host: string) => MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

/** 주소를 붙여 쓰지 않고 호스트만 적은 것('zoom.us/j/1'). 이메일(@)·다른 주소의 일부('/zoom.us', '=zoom.us')·'zoom.us.example.com'은 제외한다. */
const BARE_HOSTS = new RegExp(
  `(?<![\\w.@/=%-])(?:[\\w-]+\\.)*(?:${MEETING_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})(?![\\w-]|\\.[a-z0-9])`,
  'i',
);

function hasMeetingLink(text: string | null): boolean {
  for (const m of (text ?? '').matchAll(URL_HOSTS)) {
    if (isMeetingHost(m[1].toLowerCase())) return true;
  }
  return BARE_HOSTS.test(text ?? '');
}

/** 장소 칸에 실내 표시만 있는가(주소 표시가 같이 있으면 아니다). */
function isIndoorOnly(location: string): boolean {
  const room = INDOOR_ROOM_MARKERS.some((re) => re.test(location));
  const weak = INDOOR_WEAK_MARKERS.some((re) => re.test(location));
  if (!room && !weak) return false;
  if (ADDRESS_MARKERS.some((re) => re.test(location))) return false;
  if (room) return true;
  // 약한 표시는 표시를 걷어낸 나머지에 건물 이름이 남지 않을 때만.
  let rest = location;
  for (const re of INDOOR_WEAK_MARKERS) rest = rest.replace(new RegExp(re.source, 'g'), ' ');
  rest = rest.replace(GENERIC_INDOOR_WORDS, ' ').replace(/[\s\d\-·.,()[\]/]+/g, '');
  return rest === '';
}

/** 일정 하나가 이동이 필요 없는지와 그 이유. 해당하지 않으면 null. 온라인 회의를 건물 안보다 먼저 본다. */
export function detectNoTravel(schedule: { title: string; locationText: string | null; notes: string | null }): NoTravelReason | null {
  const location = normalize(schedule.locationText);
  const title = normalize(schedule.title);
  if (
    hasMeetingLink(schedule.locationText) ||
    hasMeetingLink(schedule.notes) ||
    ONLINE_PLACE_PHRASES.some((w) => location.includes(w)) ||
    ONLINE_PLACE_WORDS.includes(location) ||
    ONLINE_TITLE_PHRASES.some((w) => title.includes(w))
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
