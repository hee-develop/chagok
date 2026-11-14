// 서버 자주 가는 곳의 집을 정한다(PUT /places/favorites/home). 폰 대신 claim-pairing.js가 받은 폰 토큰(PHONE_TOKEN)으로 부르므로
// 토큰의 자리(차가 식별 없이 읽는 그 자리)에 들어간다. 토큰 없이 부르면 '기본 자리'에 들어가 자리 있는 차의 읽기에는 보이지 않는다(docs/pairing.md).
//   PLACE_ID: 등록할 장소 id. 'none'이면 집을 지운다.
var placeId = PLACE_ID === 'none' ? null : PLACE_ID;
var res = http.put(SERVER_URL + '/places/favorites/home', {
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + PHONE_TOKEN },
  body: JSON.stringify({ placeId: placeId }),
});
if (res.status !== 200) throw new Error('집 등록 실패 ' + res.status + ': ' + res.body);
