#!/usr/bin/env bash
# 새로 실행한 목 서버를 대상으로 한다. 점심 장소와 치과의 이동 없음 상태를 저장한다.
# 예: bash scripts/api/verify-fill-places.sh http://127.0.0.1:8792
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_URL="${1:-http://127.0.0.1:8792}"
postman request PUT "$BASE_URL/schedules/gwangju-lunch/place" \
  -H 'Content-Type:application/json' --body '{"placeId":"mock-yukjeon"}' \
  --script-post-request "@$ROOT/scripts/api/check-schedule-places.js" --timeout 10000
postman request PUT "$BASE_URL/schedules/gwangju-dentist/place" \
  -H 'Content-Type:application/json' --body '{"noTravel":true}' \
  --script-post-request 'pm.test("이동 없음 저장", () => { pm.response.to.have.status(200); pm.expect(pm.response.json().noTravel).to.equal(true); });' --timeout 10000
postman request "$BASE_URL/schedules/today" \
  --script-post-request 'pm.test("차량 일정 반영", () => { pm.response.to.have.status(200); const items = pm.response.json().schedules; pm.expect(items.find(s => s.id === "gwangju-lunch").place).to.deep.equal({ name: "광주 육전집", lat: 35.1595, lng: 126.8526 }); pm.expect(items.some(s => s.id === "gwangju-dentist")).to.equal(false); });' --timeout 10000
postman request "$BASE_URL/schedules/places" \
  --script-post-request 'pm.test("저장값 재조회", () => { pm.response.to.have.status(200); const items = pm.response.json().schedules; pm.expect(items.find(s => s.id === "gwangju-lunch").place.name).to.equal("광주 육전집"); pm.expect(items.filter(s => !s.place && !s.noTravel)).to.have.lengthOf(0); });' --timeout 10000
