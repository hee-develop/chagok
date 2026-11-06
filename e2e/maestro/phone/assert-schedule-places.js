var setup = json(http.get(SERVER_URL + '/schedules/places').body).schedules;
var car = json(http.get(SERVER_URL + '/schedules/today').body).schedules;
var lunch = null;
var dentist = null;
for (var i = 0; i < setup.length; i++) {
  if (setup[i].id === 'gwangju-lunch') lunch = setup[i];
  if (setup[i].id === 'gwangju-dentist') dentist = setup[i];
}
if (!lunch || !lunch.place || lunch.place.name !== '광주 육전집') throw new Error('폰 일정 장소가 저장되지 않았습니다');
if (!dentist || !dentist.noTravel) throw new Error('치과 이동 없음이 저장되지 않았습니다');
var carLunch = null;
for (var j = 0; j < car.length; j++) {
  if (car[j].id === 'gwangju-dentist') throw new Error('이동 없음 일정이 차량 응답에 남았습니다');
  if (car[j].id === 'gwangju-lunch') carLunch = car[j];
}
if (!carLunch || !carLunch.place || carLunch.place.lat !== lunch.place.lat || carLunch.place.lng !== lunch.place.lng) {
  throw new Error('차량 응답에 같은 장소 좌표가 반영되지 않았습니다');
}
