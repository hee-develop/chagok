// 서버에 저장된 선택에 기대한 캘린더 id 4개가 모두 있는지 확인한다.
// SERVER_URL은 호스트(맥)에서 본 서버 주소다. Maestro 스크립트는 호스트에서 실행된다.
var response = http.get(SERVER_URL + '/calendars/selection');
var body = json(response.body);

var expected = ['mock-my', 'mock-work', 'mock-family', 'mock-kia'];

if (!body.selectedIds) {
  throw new Error('서버에 저장된 선택이 없습니다: ' + response.body);
}
if (body.selectedIds.length !== expected.length) {
  throw new Error('선택 개수가 ' + expected.length + '개여야 합니다: ' + response.body);
}
for (var i = 0; i < expected.length; i++) {
  if (body.selectedIds.indexOf(expected[i]) === -1) {
    throw new Error(expected[i] + ' 가 저장되지 않았습니다: ' + response.body);
  }
}
