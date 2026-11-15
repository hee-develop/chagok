// 엄마 폰을 새 차에 연결한다: 차가 코드를 받고(POST /pair/code) 폰이 코드로 연결(POST /pair/claim)한 뒤, 연결 뒤 첫 가족 호출에
// 구성원 비밀값과 폰 토큰을 함께 보내 자리를 구성원에 묶는다(docs/family-requests.md). output.carToken·seatId를 둔다(차가 상태를 바꿀 때 쓴다).
var JSON_HEADER = { 'content-type': 'application/json' };
var car = http.post(SERVER_URL + '/pair/code', { headers: JSON_HEADER, body: '{}' });
if (car.status !== 200) throw new Error('차 코드 실패 ' + car.status + ': ' + car.body);
var carToken = json(car.body).carToken;
var issued = http.post(SERVER_URL + '/pair/code', { headers: { 'content-type': 'application/json', authorization: 'Bearer ' + carToken }, body: '{}' });
if (issued.status !== 200) throw new Error('코드 발급 실패 ' + issued.status + ': ' + issued.body);
var claim = http.post(SERVER_URL + '/pair/claim', {
  headers: { 'content-type': 'application/json', 'x-chagok-device': 'e2e-mom-device-0000000000000000' },
  body: JSON.stringify({ code: json(issued.body).code, name: '엄마 폰' }),
});
if (claim.status !== 200) throw new Error('폰 연결 실패 ' + claim.status + ': ' + claim.body);
var claimed = json(claim.body);
var family = http.get(SERVER_URL + '/family', { headers: { 'x-chagok-member': MOM_TOKEN, authorization: 'Bearer ' + claimed.phoneToken } });
if (family.status !== 200) throw new Error('가족 조회 실패 ' + family.status + ': ' + family.body);
var mom = null;
var members = json(family.body).family.members;
for (var i = 0; i < members.length; i++) if (members[i].isMe) mom = members[i];
if (!mom || mom.connected !== true) throw new Error('엄마 폰이 차에 묶이지 않았습니다: ' + family.body);
output.carToken = carToken;
output.seatId = claimed.seatId;
