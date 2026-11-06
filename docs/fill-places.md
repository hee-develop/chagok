# 폰 첫 설정 3단계: 장소 빈 일정 채우기

기준 시안은 Claude 세션에서 읽어 둔 `project/phone/FillPlaces.dc.html`입니다.
선택한 캘린더의 일반 일정을 시간순으로 표시하고, 종일 일정은 이동 대상에서 제외합니다.
장소를 채워도 원본 캘린더는 수정하지 않고 차곡 서버에 일정별 보정값을 저장합니다.

## API 계약

기존 Hono RPC 타입을 클라이언트 계약으로 사용합니다. 기존과 같이 인증 없는 목 사용자 한 명,
인스턴스별 메모리 저장이며 서버 재시작 시 초기화됩니다. 실사용자 영속 저장은 이번 범위 밖입니다.

- `GET /schedules/places`: 선택한 캘린더의 종일이 아닌 일정 전체를 시작순으로 반환합니다.
  `{ anchor, schedules: [{ id, title, start, end, locationText, place, noTravel }] }`.
  `place`는 `{ name, lat, lng } | null`입니다. 빈 개수는 `place === null && !noTravel`입니다.
- `PUT /schedules/:id/place`: `{ placeId: string | null }` 또는 `{ noTravel: true }` 중 하나를 받습니다.
  장소 id는 기존 목 장소 검색·추천 목록에서 검증합니다. `null`은 저장한 보정을 지웁니다.
  장소 지정은 해당 일정만 바꾸고 이동 없음 표시를 해제합니다. 이동 없음은 장소를 비우고
  차량 대상에서 제외합니다. 둘 다 원본 픽스처는 수정하지 않습니다.
  성공 응답은 `{ id, locationText, place, noTravel }`이며 같은 요청을 재전송해도 결과가 같습니다.
- 오류: 잘못된 본문·장소 id는 400, 없거나 선택 해제한 일정은 404,
  종일 일정은 409, 본문 64KiB 초과는 413입니다. 실패 시 저장 상태는 바뀌지 않습니다.
- `GET /schedules/today`: 기존 응답 형식을 유지하고 같은 보정값을 반영합니다.
  이동 없음 일정은 차량 응답에서 제외합니다. 기존 `at` 검증과 상대 시각 계산은 유지합니다.

## 화면과 검증 범위

시안의 카드, 장소 검색, 이동 없음, 처리 완료·빈 목록, 오류 재시도와 4단계 진입을 구현합니다.
4단계는 제목만 있는 연결 화면입니다. 다음 단계로 가거나 나중에 진행해도 저장된 장소는 유지됩니다.
조회·저장에는 기존 10초 제한과 요청 취소 방식을 쓰며 검색 복귀 시 다시 조회합니다.
검색 저장에 실패하면 검색 화면에 머물고, 상태가 바뀐 일정(4xx)은 목록을 다시 확인하도록 안내합니다.

기본 `gwangju-day.json`에는 장소가 빈 일반 일정이 없습니다. 별도
`fill-places-day.json`은 기존 점심 일정의 장소를 비우고 치과 일정을 추가한 검증용 시나리오입니다.
`FIXTURE_PATH=fixtures/schedules/fill-places-day.json pnpm server:dev`로 직접 확인할 수 있습니다.
과거 장소 추천은 정책과 이력 데이터가 없어 이번 범위에서 보류합니다.

## 재현 명령

- `pnpm typecheck`, `pnpm --filter @chagok/phone lint --max-warnings 0`
- `pnpm server:test`, `pnpm phone:test --runInBand`
- `pnpm e2e:phone`: Android에서 첫 설정 1·2·3단계 회귀 검증
- `E2E_FLOWS=fill-places pnpm e2e:phone`: 새 단계만 검증
- 전용 서버를 `PORT=8792 FIXTURE_PATH=fixtures/schedules/fill-places-day.json pnpm server:dev`로 띄운 뒤
  `bash scripts/api/verify-fill-places.sh http://127.0.0.1:8792`: Postman으로 실서버 저장·차량 응답·재조회 검증(4요청, 5 assertions)

Postman 워크스페이스 초기화 없이 URL 요청 검증을 사용합니다. 부정 요청·캘린더 선택 해제·종일 일정·
상태 격리는 서버 테스트로 검증합니다. 서버 응답 반영과 Android 화면을 검증하며 실제 차량 내비 동작은 별도입니다.
