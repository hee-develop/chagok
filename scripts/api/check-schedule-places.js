// postman request의 --script-post-request에 넘긴다. 전용 로컬 검증 서버에서 실행한다.
pm.test('일정별 장소 수정 API가 정상 응답한다', () => pm.response.to.have.status(200));
pm.test('한 일정에만 장소와 좌표가 저장된다', () => {
  const s = pm.response.json();
  pm.expect(s.id).to.equal('gwangju-friend');
  pm.expect(s.place).to.deep.equal({ name: '광주 육전집', lat: 35.1595, lng: 126.8526 });
  pm.expect(s.noTravel).to.equal(false);
});
