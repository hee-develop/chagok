// 폰이 차 연결을 끊은 뒤 그 차(CAR_ID)에 연결된 자리가 없는지 서버에서 확인한다.
var status = json(http.get(SERVER_URL + '/pairing/cars/' + CAR_ID).body);
if (status.paired !== false) throw new Error('차가 아직 연결돼 있습니다: ' + JSON.stringify(status));
