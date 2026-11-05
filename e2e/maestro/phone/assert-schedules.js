// GET /schedules/today에 'KIA vs 두산'이 들어 있는지 확인한다.
// SERVER_URL은 호스트에서 본 서버 주소, EXPECT_KIA는 'true' 또는 'false'.
var response = http.get(SERVER_URL + '/schedules/today?at=2026-11-06T09:20:00%2B09:00');
var body = json(response.body);

if (!body.schedules) {
  throw new Error('schedules가 없습니다: ' + response.body);
}

var found = false;
for (var i = 0; i < body.schedules.length; i++) {
  if (body.schedules[i].title === 'KIA vs 두산') found = true;
}

var expected = EXPECT_KIA === 'true';
if (found !== expected) {
  throw new Error('KIA vs 두산 포함 여부가 ' + expected + '여야 합니다: ' + response.body);
}
