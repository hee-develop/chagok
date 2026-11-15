// 차가 아빠가 보낸 요청의 상태를 바꾼다(PATCH /requests/:id, 차 토큰 + driver=<자리>). 엄마 폰이 연결된 차의 자리로 받은 요청을 찾아 STATUS로 바꾼다.
// 요청은 엄마가 받은 목록(GET /requests, 엄마의 구성원 비밀값)의 CATEGORY인 첫 번째 것이다.
var list = json(http.get(SERVER_URL + '/requests', { headers: { 'x-chagok-member': MOM_TOKEN } }).body).received;
var target = null;
for (var i = 0; i < list.length; i++) if (list[i].category === CATEGORY && !target) target = list[i];
if (!target) throw new Error(CATEGORY + ' 요청이 엄마의 받은 요청에 없습니다: ' + JSON.stringify(list));
var res = http.request(SERVER_URL + '/requests/' + target.id + '?driver=' + SEAT_ID, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CAR_TOKEN },
  body: JSON.stringify({ status: STATUS }),
});
if (res.status !== 200) throw new Error('상태 바꾸기 실패 ' + res.status + ': ' + res.body);
if (json(res.body).request.status !== STATUS) throw new Error('상태가 ' + STATUS + '가 아닙니다: ' + res.body);
