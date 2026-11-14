// 폰이 읽은 실제 기기 캘린더 일정이 서버에 반영됐는지 확인한다(scripts/seed-phone-calendar.sh가 심은 일정 기준).
// SERVER_URL은 호스트에서 본 서버 주소. 일정 보내기는 선택 저장 직후 비동기로 시작되므로 최대 30초 기다린다.
function sleep(ms) {
  var end = Date.now() + ms;
  while (Date.now() < end) {}
}

// 서울 날짜(YYYY-MM-DD). offset일 뒤.
function seoulDate(offsetDays) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}

function titles(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(list[i].title);
  return out;
}

function has(list, title) {
  return titles(list).indexOf(title) !== -1;
}

// 선택은 기기 캘린더 출처(device)로 저장돼야 한다(목 id와 섞이면 안 된다).
var selection = json(http.get(SERVER_URL + '/calendars/selection').body);
if (selection.source !== 'device') {
  throw new Error('저장된 선택의 source가 device여야 합니다: ' + JSON.stringify(selection));
}

var today = null;
var tomorrow = null;
for (var attempt = 0; attempt < 30; attempt++) {
  today = json(http.get(SERVER_URL + '/events?date=' + seoulDate(0)).body);
  if (today.receivedAt && has(today.events, 'E2E Today Meeting')) break;
  sleep(1000);
}
if (!today || !has(today.events, 'E2E Today Meeting')) {
  throw new Error('GET /events에 오늘 일정(E2E Today Meeting)이 없습니다: ' + JSON.stringify(today));
}

var meeting = null;
for (var i = 0; i < today.events.length; i++) {
  if (today.events[i].title === 'E2E Today Meeting') meeting = today.events[i];
}
if (meeting.locationText !== 'E2E Place') throw new Error('장소 칸이 locationText로 가야 합니다: ' + JSON.stringify(meeting));
if (meeting.notes !== 'E2E notes') throw new Error('메모가 notes로 가야 합니다: ' + JSON.stringify(meeting));
if (meeting.allDay !== false) throw new Error('allDay가 false여야 합니다: ' + JSON.stringify(meeting));

tomorrow = json(http.get(SERVER_URL + '/events?date=' + seoulDate(1)).body);
if (!has(tomorrow.events, 'E2E Tomorrow Visit')) {
  throw new Error('GET /events에 내일 일정(E2E Tomorrow Visit)이 없습니다: ' + JSON.stringify(tomorrow));
}
var far = json(http.get(SERVER_URL + '/events?date=' + seoulDate(3)).body);
if (has(far.events, 'E2E Far Away') || has(today.events, 'E2E Far Away') || has(tomorrow.events, 'E2E Far Away')) {
  throw new Error('오늘·내일이 아닌 일정(E2E Far Away)이 서버에 저장됐습니다');
}

// 차량이 읽는 /schedules/today는 폰 일정으로 바뀌어야 한다(픽스처 일정이 섞이면 안 된다).
var schedules = json(http.get(SERVER_URL + '/schedules/today').body).schedules;
if (!has(schedules, 'E2E Today Meeting')) {
  throw new Error('/schedules/today에 폰 일정이 없습니다: ' + JSON.stringify(schedules));
}
if (has(schedules, 'KIA 직관') || has(schedules, '육전집 점심')) {
  throw new Error('/schedules/today에 픽스처 일정이 섞여 있습니다: ' + JSON.stringify(schedules));
}
if (has(schedules, 'E2E Tomorrow Visit')) {
  throw new Error('/schedules/today에 내일 일정이 들어 있습니다');
}

// 3단계가 채울 일정: 장소를 못 찾은 폰 일정은 place가 null로 내려온다.
var places = json(http.get(SERVER_URL + '/schedules/places').body).schedules;
var found = null;
for (var j = 0; j < places.length; j++) {
  if (places[j].title === 'E2E Today Meeting') found = places[j];
}
if (!found || found.place !== null) {
  throw new Error('/schedules/places의 E2E Today Meeting은 장소가 null이어야 합니다: ' + JSON.stringify(found));
}
