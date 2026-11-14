/**
 * 이동이 필요 없는 일정을 알아본다(폰 1단계 문구 "온라인 회의나 회의실 일정은 걸러서 차에 보내지 않아요").
 * 알아본 일정은 3단계 '이동 없음'과 같이 차량 응답에서 빠지고, 사용자가 장소를 넣으면 다시 차로 간다.
 * 잘못 거르면 사용자가 그 일정을 차에서 잃으므로 확실한 표시만 본다.
 * 예를 들어 '화상' 한 단어는 '화상전문병원'과 헷갈리므로 '화상회의'처럼 붙은 말만 본다.
 */
export type NoTravelReason = 'online' | 'meetingRoom';

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
const ONLINE_PLACE_WORDS = ['줌', 'teams', 'meet'];

/** 제목에 들어 있으면 온라인 회의인 말. */
const ONLINE_TITLE_PHRASES = ['화상회의', '화상 회의', '화상미팅', '화상 미팅', '온라인 회의', '온라인회의', '온라인 미팅', '비대면 회의'];

/** 장소 칸에 들어 있으면 회의실 일정인 말. */
const MEETING_ROOM_PHRASES = ['회의실', 'meeting room', 'conference room'];

const normalize = (text: string | null) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const URL_HOSTS = /https?:\/\/([^/\s?#:]+)/gi;

function hasMeetingLink(text: string | null): boolean {
  for (const m of (text ?? '').matchAll(URL_HOSTS)) {
    const host = m[1].toLowerCase();
    if (MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  }
  return false;
}

/** 일정 하나가 이동이 필요 없는지와 그 이유. 해당하지 않으면 null. 온라인 회의를 회의실보다 먼저 본다. */
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
  if (MEETING_ROOM_PHRASES.some((w) => location.includes(w))) return 'meetingRoom';
  return null;
}
