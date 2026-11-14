# 폰 첫 설정 3단계: 장소 빈 일정 채우기

기준 시안은 화면 시안 아티팩트(https://claude.ai/artifact/SSfNbsMaGZyVG3X6AG6Gnt)의 폰 페이지 '3 장소 빈 일정 채우기'입니다.
선택한 캘린더의 일반 일정을 시간순으로 표시하고, 종일 일정은 이동 대상에서 제외합니다.
장소를 채워도 원본 캘린더는 수정하지 않고 차곡 서버에 일정별 보정값을 저장합니다.

## API 계약

기존 Hono RPC 타입을 클라이언트 계약으로 사용합니다. 데이터는 운전자 자리별(폰 토큰이 있으면 그 자리, 없으면 연결 전 기본 자리, `docs/pairing.md`)이고
인스턴스별 메모리 저장이며 서버 재시작 시 초기화됩니다. 실사용자 영속 저장은 이번 범위 밖입니다.
보정값의 키는 일정 id뿐입니다. 목 픽스처는 날마다 같은 id를 쓰므로 이 전제가 성립하지만,
실제 캘린더 연동에서는 반복 일정의 인스턴스 id(일정 id + 시작 시각 등)로 키를 바꿔야 합니다.

- `GET /schedules/places`: 선택한 캘린더의 종일이 아닌 일정 전체를 시작순으로 반환합니다.
  `{ anchor, schedules: [{ id, title, start, end, locationText, place, noTravel, noTravelReason, care, suggestion }] }`.
  `care`는 앱에서 적은 채비 한 줄(없으면 `null`)이고 카드 아래 채비 줄과 `PUT /schedules/:id/care`는 `docs/care.md`를 따릅니다.
  `noTravelReason`은 서버가 온라인 회의·회의실이라 저절로 이동 없음으로 본 이유(`online`|`meetingRoom`)이고, 보정이 있거나 해당하지 않으면 `null`입니다(규칙은 `docs/calendar-sync.md`). 화면은 이유가 있는 이동 없음 카드를 흐리게 보이고 '이동 없음 · 온라인 회의'처럼 이유를 붙입니다.
  `place`는 `{ name, lat, lng } | null`입니다. 빈 개수는 `place === null && !noTravel`이며 후보가 있는 일정도 셉니다.
  `suggestion`은 `{ placeId, name } | null`로, 장소가 비고 이동 없음이 아닌 일정 중 제목이 기억한 장소와
  같은 일정에만 채웁니다. 기억한 장소는 `fixtures/places/remembered.json`(일정 제목 → 목 장소 id)입니다.
  '여기 맞아요'는 이 `placeId`를 아래 `PUT`으로 저장합니다. 기억 후보가 틀리면 같은 카드의
  '이동 없음'·'장소 넣기'로 직접 고를 수 있게 후보 박스 아래에 그 줄을 함께 둡니다.
- `PUT /schedules/:id/place`: `{ placeId: string | null }` 또는 `{ noTravel: true }` 중 하나를 받습니다.
  장소 id는 기존 목 장소 검색·추천 목록에서 검증합니다. `null`은 저장한 보정을 지웁니다.
  장소 지정은 해당 일정만 바꾸고 이동 없음 표시를 해제합니다. 이동 없음은 장소를 비우고
  차량 대상에서 제외합니다. 둘 다 원본 픽스처는 수정하지 않습니다.
  성공 응답은 `{ id, locationText, place, noTravel, noTravelReason }`이며 같은 요청을 재전송해도 결과가 같습니다.
- 오류: 잘못된 본문·장소 id는 400, 없거나 선택 해제한 일정은 404,
  종일 일정은 409, 본문 64KiB 초과는 413입니다. 실패 시 저장 상태는 바뀌지 않습니다.
- `GET /schedules/today`: 기존 응답 형식을 유지하고 같은 보정값을 반영합니다.
  이동 없음 일정은 차량 응답에서 제외합니다. 기존 `at` 검증과 상대 시각 계산은 유지합니다.
  '오늘'은 `at`(없으면 현재 시각)의 Asia/Seoul 날짜입니다. 시작이 그 날짜인 일정과, 전날 시작해
  `at` 시각에 아직 끝나지 않은 일정(차량 앱이 자정을 넘겨 끝나지 않은 일정을 유지하는 규칙과 같음)만
  내려줍니다. 다음 날 이후 일정은 뺍니다. `GET /schedules/places`는 날짜와 무관하게 선택한 캘린더의
  일반 일정을 모두 보여 줍니다.

## 화면과 검증 범위

시안의 카드, 장소 검색, 이동 없음, 처리 완료·빈 목록, 오류 재시도와 4단계 진입을 구현합니다.
4단계는 제목만 있는 연결 화면입니다. 다음 단계로 가거나 나중에 진행해도 저장된 장소는 유지됩니다.
조회·저장에는 기존 10초 제한과 요청 취소 방식을 쓰며 검색 복귀 시 다시 조회합니다.
검색 저장에 실패하면 검색 화면에 머물고, 상태가 바뀐 일정(4xx)은 목록을 다시 확인하도록 안내합니다.

기본 `gwangju-day.json`에 장소가 빈 일반 일정 '친구 약속'(오늘 저녁)과 '치과'(이틀 뒤)가 있고,
기존 일정과 장소는 그대로라 차량 브리핑 첫 장면(데모 기준 시각 09:20 KST)은 바뀌지 않습니다. 기준 시각이 늦으면 '오늘' 범위를 넘는 저녁 일정(콩물 픽업, 친구 약속)은 차량 응답에서 빠집니다. 치과는 다른 날이라 차량 응답에
들어가지 않으며 기억한 장소(예시치과의원) 후보가 붙습니다.

## 재현 명령

- `pnpm typecheck`, `pnpm --filter @chagok/phone lint --max-warnings 0`
- `pnpm server:test`, `pnpm phone:test --runInBand`
- `pnpm e2e:phone`: Android에서 첫 설정 1·2·3단계 회귀 검증
- `E2E_FLOWS=fill-places pnpm e2e:phone`: 3단계만 검증(`calendar-select`, `places`, `fill-places`만 허용)
- 새 서버를 `PORT=8792 pnpm server:dev`로 띄운 뒤
  `bash scripts/api/verify-fill-places.sh http://127.0.0.1:8792`: Postman으로 실서버 저장·차량 응답·재조회 검증(127.0.0.1·localhost만 허용)

Postman 워크스페이스 초기화 없이 URL 요청 검증을 사용합니다. 부정 요청·캘린더 선택 해제·종일 일정·
상태 격리는 서버 테스트로 검증합니다. 서버 응답 반영과 Android 화면을 검증하며 실제 차량 내비 동작은 별도입니다.
