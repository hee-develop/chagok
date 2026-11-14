// 서버의 기억 목록을 확인한다. EXPECT는 쉼표로 이은 남아 있어야 할 이름, ABSENT는 없어야 할 이름.
var memories = json(http.get(SERVER_URL + '/places/memory').body).memories;
var names = [];
for (var i = 0; i < memories.length; i++) names.push(memories[i].name);
var expected = EXPECT.split(',');
for (var j = 0; j < expected.length; j++) {
  if (names.indexOf(expected[j]) === -1) throw new Error('기억 ' + expected[j] + '가 없습니다: ' + JSON.stringify(names));
}
if (ABSENT !== '' && names.indexOf(ABSENT) !== -1) throw new Error('기억 ' + ABSENT + '가 지워지지 않았습니다: ' + JSON.stringify(names));
