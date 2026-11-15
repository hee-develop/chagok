// 엄마 쪽에서 본 가족 상태를 확인한다(GET /family, GET /requests, 엄마의 구성원 비밀값).
//   EXPECT_MEMBERS   남아 있어야 하는 구성원 수 (예: '2' 또는 '1')
//   EXPECT_SHARES    엄마가 아빠에게서 받는 도착 예정 공유가 켜져 있어야 하는가('true'|'false'|'' = 확인 안 함)
//   EXPECT_RECEIVED  엄마의 받은 요청 수 ('' = 확인 안 함)
var headers = { 'x-chagok-member': MOM_TOKEN };
var family = json(http.get(SERVER_URL + '/family', { headers: headers }).body).family;
if (!family) throw new Error('엄마의 가족이 없습니다');
if (String(family.members.length) !== EXPECT_MEMBERS) throw new Error('구성원 수가 ' + EXPECT_MEMBERS + '여야 합니다: ' + JSON.stringify(family.members));
if (EXPECT_SHARES !== '') {
  var other = null;
  for (var i = 0; i < family.members.length; i++) if (!family.members[i].isMe) other = family.members[i];
  if (!other) throw new Error('엄마 말고 구성원이 없습니다');
  if (String(other.sharesWithMe) !== EXPECT_SHARES) throw new Error('도착 예정 공유가 ' + EXPECT_SHARES + '여야 합니다: ' + JSON.stringify(other));
}
if (EXPECT_RECEIVED !== '') {
  var received = json(http.get(SERVER_URL + '/requests', { headers: headers }).body).received;
  if (String(received.length) !== EXPECT_RECEIVED) throw new Error('엄마의 받은 요청이 ' + EXPECT_RECEIVED + '개여야 합니다: ' + JSON.stringify(received));
}
