// 이동 없음 기억(정책서 10.3 4번)이 서버에 반영됐는지 확인한다. 식별 없는 폰(E2E, EXPO_PUBLIC_DEVICE_ID=none)은 기본 자리를 쓰므로 식별 없이 읽는다.
//   SERVER_URL  호스트에서 본 서버 주소
//   NAME        일정 이름(E2E 캘린더의 영문 제목)
//   STAGE       remembered: GET /skips에 NAME이 있다 / forgotten: 없다
//               event-sent: 오늘·내일 폰 일정(GET /events)에 NAME 일정이 있다 / event-withheld: 없다
// 폰은 이름 기억을 기다리지 않고 올리고 일정은 동기화 때 보내므로 최대 30초 기다린다.
function sleep(ms) {
  var end = Date.now() + ms;
  while (Date.now() < end) {}
}
function seoulDate(offsetDays) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}
function remembered() {
  var list = json(http.get(SERVER_URL + '/skips').body).skips;
  for (var i = 0; i < list.length; i++) if (list[i].name === NAME) return true;
  return false;
}
function sent() {
  var days = [0, 1];
  for (var d = 0; d < days.length; d++) {
    var events = json(http.get(SERVER_URL + '/events?date=' + seoulDate(days[d])).body).events || [];
    for (var i = 0; i < events.length; i++) if (events[i].title === NAME) return true;
  }
  return false;
}
var want = { remembered: [remembered, true], forgotten: [remembered, false], 'event-sent': [sent, true], 'event-withheld': [sent, false] }[STAGE];
if (!want) throw new Error('알 수 없는 STAGE: ' + STAGE);
var ok = false;
for (var attempt = 0; attempt < 30; attempt++) {
  if (want[0]() === want[1]) { ok = true; break; }
  sleep(1000);
}
if (!ok) throw new Error(STAGE + ' 확인 실패: ' + NAME + ' skips=' + JSON.stringify(json(http.get(SERVER_URL + '/skips').body)));
