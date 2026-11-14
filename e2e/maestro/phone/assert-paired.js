// 폰이 보낸 번호로 그 차(CAR_ID)가 서버에서 연결됐는지 확인한다.
var status = json(http.get(SERVER_URL + '/pairing/cars/' + CAR_ID).body);
if (status.paired !== true || !status.pairedAt) throw new Error('차가 연결되지 않았습니다: ' + JSON.stringify(status));
