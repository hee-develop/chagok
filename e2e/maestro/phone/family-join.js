// 화면에서 만든 가족의 초대 코드로 두 번째 구성원('엄마')을 서버에 직접 참여시킨다(POST /family/join).
// CODE는 화면의 초대 코드(copyTextFrom), NAME은 부르는 이름. 응답의 구성원 비밀값을 output.momToken에 둔다(엄마 폰 역할).
var res = http.post(SERVER_URL + '/family/join', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: CODE, name: NAME }),
});
if (res.status !== 200) throw new Error('가족 참여 실패 ' + res.status + ': ' + res.body);
var body = json(res.body);
if (!/^[0-9a-f]{64}$/.test(body.memberToken)) throw new Error('구성원 비밀값이 이상합니다: ' + res.body);
if (body.family.members.length !== 2) throw new Error('구성원이 둘이어야 합니다: ' + res.body);
output.momToken = body.memberToken;
