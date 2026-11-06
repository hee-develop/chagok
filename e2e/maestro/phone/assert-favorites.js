// 서버에 저장된 자주 가는 곳이 기대와 같은지 확인한다.
// SERVER_URL은 호스트(맥)에서 본 서버 주소다. Maestro 스크립트는 호스트에서 실행된다.
// EXPECT_HOME·EXPECT_WORK는 장소 id(없으면 빈 문자열), EXPECT_OTHERS는 쉼표로 이은 장소 id(순서까지 같아야 한다).
var response = http.get(SERVER_URL + '/places/favorites');
var body = json(response.body);

function idOf(place) {
  return place ? place.id : '';
}

if (idOf(body.home) !== EXPECT_HOME) {
  throw new Error('home이 ' + JSON.stringify(EXPECT_HOME) + '여야 합니다: ' + response.body);
}
if (idOf(body.work) !== EXPECT_WORK) {
  throw new Error('work가 ' + JSON.stringify(EXPECT_WORK) + '여야 합니다: ' + response.body);
}

var others = [];
for (var i = 0; i < body.others.length; i++) {
  others.push(body.others[i].id);
}
if (others.join(',') !== EXPECT_OTHERS) {
  throw new Error('others가 ' + JSON.stringify(EXPECT_OTHERS) + '여야 합니다: ' + response.body);
}
