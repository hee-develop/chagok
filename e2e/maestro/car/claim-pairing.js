// 폰 대신 차 화면의 연결 번호를 서버에 보낸다(POST /pairing/claim). CODE는 화면에서 읽은 "123 456" 꼴이라 숫자만 남긴다.
var code = String(CODE).replace(/\D/g, '');
if (!/^\d{6}$/.test(code)) throw new Error('차 화면에서 읽은 연결 번호가 6자리가 아닙니다: ' + CODE);
var res = http.post(SERVER_URL + '/pairing/claim', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: code }),
});
if (res.status !== 200) throw new Error('연결 실패 ' + res.status + ': ' + res.body);
// 이어지는 단계(set-home.js 등)가 이 자리의 폰 토큰을 쓸 수 있게 flow의 output에 남긴다(로그·스크린샷에는 찍지 않는다).
output.phoneToken = JSON.parse(res.body).phoneToken;
