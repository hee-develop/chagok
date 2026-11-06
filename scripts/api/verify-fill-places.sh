#!/usr/bin/env bash
# 새로 띄운 로컬 목 서버(127.0.0.1 또는 localhost)에서 친구 약속 장소와 치과의 기억한 장소 저장, 차량 응답의 날짜 기준을 확인한다.
# 예: bash scripts/api/verify-fill-places.sh http://127.0.0.1:8792
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_URL="${1:-http://127.0.0.1:8792}"
case "$BASE_URL" in
  http://127.0.0.1|http://127.0.0.1:*|http://localhost|http://localhost:*) ;;
  *) echo "로컬 서버(127.0.0.1, localhost)만 대상으로 합니다: $BASE_URL" >&2; exit 2 ;;
esac
TODAY='?at=2026-11-06T09:20:00%2B09:00'
postman request "$BASE_URL/schedules/places$TODAY" \
  --script-post-request 'pm.test("치과 기억한 장소 후보", () => { pm.response.to.have.status(200); const items = pm.response.json().schedules; pm.expect(items.find(s => s.id === "gwangju-dentist").suggestion).to.deep.equal({ placeId: "mock-dentist", name: "예시치과의원" }); pm.expect(items.filter(s => !s.place && !s.noTravel)).to.have.lengthOf(2); });' --timeout 10000
postman request PUT "$BASE_URL/schedules/gwangju-friend/place" \
  -H 'Content-Type:application/json' --body '{"placeId":"mock-yukjeon"}' \
  --script-post-request "@$ROOT/scripts/api/check-schedule-places.js" --timeout 10000
postman request PUT "$BASE_URL/schedules/gwangju-dentist/place" \
  -H 'Content-Type:application/json' --body '{"placeId":"mock-dentist"}' \
  --script-post-request 'pm.test("후보 저장", () => { pm.response.to.have.status(200); pm.expect(pm.response.json().place.name).to.equal("예시치과의원"); });' --timeout 10000
postman request "$BASE_URL/schedules/today$TODAY" \
  --script-post-request 'pm.test("차량 일정 반영", () => { pm.response.to.have.status(200); const items = pm.response.json().schedules; pm.expect(items.find(s => s.id === "gwangju-friend").place).to.deep.equal({ name: "광주 육전집", lat: 35.1595, lng: 126.8526 }); pm.expect(items.some(s => s.id === "gwangju-dentist")).to.equal(false); });' --timeout 10000
postman request "$BASE_URL/schedules/places$TODAY" \
  --script-post-request 'pm.test("저장값 재조회", () => { pm.response.to.have.status(200); const items = pm.response.json().schedules; pm.expect(items.filter(s => !s.place && !s.noTravel)).to.have.lengthOf(0); pm.expect(items.find(s => s.id === "gwangju-dentist").suggestion).to.equal(null); });' --timeout 10000
