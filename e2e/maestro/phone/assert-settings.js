// 서버의 설정을 확인한다(GET /settings). 이 flow의 폰은 연결 전이고 서버에 자리 있는 차가 없어 기본 자리가 쓰인다.
// EXPECT는 쉼표로 이은 key=true|false 목록이다(예: plusMode=true,lateContact=false,voiceOnly=false).
var res = http.get(SERVER_URL + '/settings');
if (res.status !== 200) throw new Error('설정 조회 실패 ' + res.status + ': ' + res.body);
var settings = json(res.body);
var wanted = EXPECT.split(',');
for (var i = 0; i < wanted.length; i++) {
  var pair = wanted[i].split('=');
  if (String(settings[pair[0]]) !== pair[1]) throw new Error('설정 ' + pair[0] + '가 ' + pair[1] + '이어야 하는데 ' + String(settings[pair[0]]) + '입니다: ' + res.body);
}
