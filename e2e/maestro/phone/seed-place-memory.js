// 장소 탭의 '기억한 장소'를 보이려고 서버에 기억 둘을 심는다(PUT /places/memory). 이 flow의 폰은 연결 전이고 서버에 자리 있는 차가 없어 기본 자리가 쓰인다.
// 나중에 쓴 것이 위에 온다: '스타벅스' 다음 '헬스장' 순으로 심으면 목록은 헬스장, 스타벅스 순이다.
function save(name, place, ambiguous) {
  var res = http.put(SERVER_URL + '/places/memory', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name, place: place, ambiguous: ambiguous }),
  });
  if (res.status !== 200) throw new Error('기억 저장 실패 ' + res.status + ': ' + res.body);
}
save('스타벅스', { name: '스타벅스 상무점', address: '광주 서구 상무중앙로 1', lat: 35.1527, lng: 126.8517 }, true);
save('헬스장', { name: '상무 피트니스', address: '광주 서구 상무대로 2', lat: 35.1531, lng: 126.8493 }, false);
