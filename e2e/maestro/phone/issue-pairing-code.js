// 차 대신 연결 코드를 받는다(POST /pairing/codes). output.code에 숫자 6자리를 둔다. CAR_ID는 E2E용 익명 차 id.
var res = http.post(SERVER_URL + '/pairing/codes', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ carId: CAR_ID }),
});
if (res.status !== 200) throw new Error('코드 받기 실패 ' + res.status + ': ' + res.body);
var issued = json(res.body);
if (!/^\d{6}$/.test(issued.code)) throw new Error('코드가 6자리가 아닙니다: ' + res.body);
if (issued.qr !== 'chagok://pair?code=' + issued.code) throw new Error('QR 글이 다릅니다: ' + res.body);
output.code = issued.code;
