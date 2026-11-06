// STAGE=no-travel: 친구 약속은 이동 없음, 치과는 기억한 장소. STAGE=changed: 친구 약속에 장소를 넣어 이동 없음이 풀린 상태.
var AT = '?at=2026-11-06T09:20:00%2B09:00';
var setup = json(http.get(SERVER_URL + '/schedules/places' + AT).body).schedules;
var car = json(http.get(SERVER_URL + '/schedules/today' + AT).body).schedules;
function find(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
var friend = find(setup, 'gwangju-friend');
var dentist = find(setup, 'gwangju-dentist');
var lunch = find(car, 'gwangju-lunch');
if (!dentist || !dentist.place || dentist.place.name !== '예시치과의원') throw new Error('치과 기억한 장소가 저장되지 않았습니다');
if (find(car, 'gwangju-dentist')) throw new Error('다른 날 일정이 차량 응답에 들어 있습니다');
if (!lunch || !lunch.place || lunch.place.name !== '광주 육전집') throw new Error('기존 점심 장소가 바뀌었습니다');
if (STAGE === 'no-travel') {
  if (!friend || !friend.noTravel) throw new Error('친구 약속 이동 없음이 저장되지 않았습니다');
  if (find(car, 'gwangju-friend')) throw new Error('이동 없음 일정이 차량 응답에 남았습니다');
} else {
  if (!friend || friend.noTravel || !friend.place || friend.place.name !== '광주 육전집') throw new Error('친구 약속 장소가 저장되지 않았습니다');
  var carFriend = find(car, 'gwangju-friend');
  if (!carFriend || !carFriend.place || carFriend.place.lat !== friend.place.lat || carFriend.place.lng !== friend.place.lng) {
    throw new Error('차량 응답에 친구 약속 좌표가 반영되지 않았습니다');
  }
}
