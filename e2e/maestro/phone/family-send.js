// 엄마가 아빠에게 약속 가기 요청을 보낸다(POST /requests). 받는 사람(아빠) 폰에는 알림이 없고 오늘 탭 '받은 가족 요청'에만 보인다.
// MOM_TOKEN은 엄마의 구성원 비밀값. 약속 시각은 서버의 지금(실제 시계) 한 시간 뒤다.
var JSON_HEADER = { 'content-type': 'application/json', 'x-chagok-member': MOM_TOKEN };
var family = json(http.get(SERVER_URL + '/family', { headers: { 'x-chagok-member': MOM_TOKEN } }).body).family;
var dad = null;
for (var i = 0; i < family.members.length; i++) if (!family.members[i].isMe) dad = family.members[i];
if (!dad) throw new Error('아빠(받는 사람)를 찾지 못했습니다');
var res = http.post(SERVER_URL + '/requests', {
  headers: JSON_HEADER,
  body: JSON.stringify({
    category: 'appointment',
    recipient: { memberId: dad.memberId },
    at: new Date(Date.now() + 3600 * 1000).toISOString(),
    place: { text: '예시치과의원' },
    memo: '보험증 챙겨요',
  }),
});
if (res.status !== 200) throw new Error('요청 보내기 실패 ' + res.status + ': ' + res.body);
output.incomingId = json(res.body).request.id;
