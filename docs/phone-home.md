# 폰 아래 탭과 오늘(홈) 화면

정책서 10.7의 폰 화면 구성 중 **아래 탭 네 개(오늘 · 가족 · 장소 · 설정)** 와 **오늘(홈) 화면**입니다(작업 묶음 J5a).
서버는 건드리지 않고 기존 API(`GET /schedules/places`, `PUT /schedules/:id/place`·`care`, `GET /pairing/cars/:carId`, 가족 보내기)만 씁니다.

## 앱을 열면

`phone/src/app/(tabs)/_layout.tsx`가 저장소의 첫 설정 완료 표시(`chagok.firstSetupDone.v1`)를 읽어 가른다.

- 표시가 있으면 탭(오늘·가족·장소·설정 순서)으로 들어간다. `/`는 오늘 탭이다(예전 `app/index.tsx` 리다이렉트는 없앴다).
- 표시가 없으면(처음이거나 읽지 못함) 기존 첫 설정 1단계(`/setup/calendar`)로 보낸다. 읽는 동안은 배경색만 그린다.
- **표시를 남기는 때**: 4단계(`/setup/pair-car`)에 닿았을 때. 1~3단계를 끝냈거나 건너뛰어야 4단계에 닿으므로 '끝냈거나 건너뜀'과 같다. 4단계에서 연결하지 않고 나가도 탭의 [차 연결하기]로 다시 연결할 수 있다.
- 4단계 [완료]는 기존 코드가 `/setup/fill-places`로 `replace`한다. 3단계 라우트(`setup/fill-places.tsx`)가 새로 열렸는데 표시가 이미 있으면 쌓인 설정 화면을 닫고 탭으로 간다(`router.dismissAll` + `replace('/')`). 3단계를 처음 보는 중이거나 4단계에서 뒤로 돌아올 때는 표시가 없거나 화면이 다시 만들어지지 않아 그대로다.
- 저장소는 `@react-native-async-storage/async-storage`(Expo Go 내장)이고 `src/storage/keyValueStore.ts`가 감싼다. 비밀 값은 두지 않는다.

## 탭

| 탭 | 라우트 | 구현 | 내용 |
| --- | --- | --- | --- |
| 오늘 | `(tabs)/index.tsx` | `features/today/TodayScreen` | 차 연결 상태, 꺼진 권한 안내, 장소 빈 일정 배너, 오늘 일정, 다른 날 장소 빈 일정, 받은 가족 요청(빈 상태만) |
| 가족 | `(tabs)/family.tsx` | `features/family/FamilyTabScreen` | 보내기 입구(→ 오늘 탭), 보낸 요청 목록, 가족 묶기 자리 |
| 장소 | `(tabs)/places.tsx` | `features/places/PlacesScreen mode="tab"` | 자주 가는 곳(2단계 화면 재사용), 기억한 장소·이동 없음 목록 자리 |
| 설정 | `(tabs)/settings.tsx` | `features/settings/SettingsScreen` | 주행 중 고정 안내, 차 연결 입구, 캘린더 고르기 입구, 권한 상태 |

스위치(플러스 모드·늦을 때 연락·음성만)는 다음 묶음(J5b)이다. **'캘린더에 장소 적기'는 만들지 않는다**(사용자가 뺀 기능).

## 오늘 탭

- **오늘 일정**: `GET /schedules/places` 응답의 `anchor`(서버가 말하는 오늘)를 서울 날짜로 보고, 시작이 그 날짜이거나 전날 시작해 anchor에 아직 끝나지 않은 일정(`/schedules/today`와 같은 규칙, `features/today/todaySchedules.ts`)을 시작순으로 보인다. 이동 없음 일정은 줄(머리)을 흐리게(`opacity` 0.55) 보이고 글로도 '이동 없음 · 온라인 회의'를 적는다.
- **장소 빈 일정**: 위 배너는 오늘 + 다른 날(아직 끝나지 않은) 일정 중 `place === null && !noTravel`인 수다. 오늘이 아닌 빈 일정은 '다른 날 장소가 빈 일정' 구역에 날짜와 함께 모은다. 장소가 정해지면 그 구역에서 빠진다.
- **일정을 누르면** 그 자리에서 펼쳐져 3단계 카드와 같은 줄(`features/fill-places/ScheduleActions`)이 나온다: 장소 넣기·변경, 이동 없음, '여기 맞아요', 채비 넣기·수정, 가족에게 보내기. 장소 검색·채비·가족 화면은 기존 `/setup/schedule-place-search`·`schedule-care`·`family-send` 라우트를 `from=today`로 열어 단계 표시('3 / 4') 없이 보이고, 닫으면 오늘 탭으로 돌아온다(탭은 포커스를 얻을 때 일정을 다시 읽는다).
- 저장·조회는 3단계와 같은 훅(`features/fill-places/useSchedulePlaces`)이다: 10초 제한(`requestWithTimeout`), 새 조회가 시작되면 이전 조회 취소, 응답을 반영하기 전에 그 요청의 controller가 아직 현재 것인지 확인, 저장은 한 번에 하나, 4xx는 일정이 바뀐 것이라 다시 읽기.
- **차 연결 상태**: 연결할 때(`setup/pair-car` 라우트가 `recordPairedCar`로 api를 감싸) 받은 차 id를 폰에 남기고, `GET /pairing/cars/:carId`의 `paired`로 연결됨/안 됨을 보인다. 차 id가 없으면 서버에 묻지 않고 '연결 안 됨'이다. 확인 실패는 '연결 안 됨'으로 단정하지 않고 오류 상태(다시 확인)로 둔다. 연결 API가 바뀌면 `features/today/carConnection.ts`의 `CarConnectionSource` 구현만 바꾸면 된다.
- **꺼진 권한 안내**: 앱이 실제로 쓰는 캘린더·카메라만. 꺼진 것마다 '켜면 이게 돼요' 한 줄과 [켜기](다시 물을 수 있을 때) 또는 [설정 열기]. 차와 이미 연결돼 있으면 카메라 안내는 숨긴다. 앱이 앞으로 돌아올 때(설정에서 켜고 온 경우)와 탭이 포커스를 얻을 때 다시 읽는다. `EXPO_PUBLIC_CALENDAR_SOURCE=mock`이면 캘린더는 권한이 필요 없다.
- **받은 가족 요청**: 서버에 받는 쪽 API가 없어 빈 상태 문구만 둔다(J10b가 채움).

### 상태 5종

| 상태 | 오늘 | 가족 | 장소 | 설정 |
| --- | --- | --- | --- | --- |
| 로딩 | 일정·연결 구역별 진행 표시 | 보낸 요청 진행 표시 | 기존(2단계) | 연결·권한 구역별 진행 표시 |
| 빈 | '오늘은 차로 갈 일정이 없어요.' | '아직 보낸 요청이 없어요.' | 기억한 장소·이동 없음 빈 문구 | 해당 없음 |
| 오류 | [다시 시도], 연결은 [다시 확인] | [다시 시도] | 기존(2단계) | 연결 [다시 확인], 권한 [다시 확인] |
| 권한 없음 | 캘린더 꺼짐이면 일정을 요청하지 않고 [켜기]/[설정 열기] | 같음 | 해당 없음(서버 검색만 씀) | 권한 구역에 상태와 버튼 |
| 정상 | 일정·배너·연결 상태 | 보낸 요청 목록 | 자주 가는 곳 | 안내·입구·권한 |

## 파일

- 공용으로 뽑은 것: `features/fill-places/ScheduleActions.tsx`(3단계 카드의 장소·채비·가족 줄), `useSchedulePlaces.ts`(조회·저장 훅), `scheduleFormat.ts`, `ui/TabScreen.tsx`·`ui/blocks.tsx`(탭 공통 틀·구역·상태 블록). 3단계 화면(`FillPlacesScreen`)도 같은 컴포넌트·훅을 쓴다(동작·글자·testID 그대로).
- `SetupHeader`의 `step`은 선택값이다. 없으면 로고만 보인다. `ScheduleCareScreen`·`FamilySendScreen`·`PlaceSearchScreen`은 `standalone`이면 단계 표시를 빼고 되돌아갈 곳이 없을 때 `/`로 간다.
- 문구는 `phone/src/i18n/ko.ts`(`tabs`·`permissions`·`carConnection`·`today`·`familyTab`·`placesTab`·`settings`).

## 알려진 한계(다음 묶음이 이어 붙일 곳)

- 설정 탭의 [캘린더 고르기]와 오늘 탭의 [차 연결하기]는 기존 1단계·4단계 화면을 그대로 연다. 그 화면들이 단계 표시('1 / 4'·'4 / 4')와 다음 단계 이동(1단계 저장 뒤 2단계로 push)을 코드에 박고 있어 탭에서 열어도 그대로 보인다. `calendar-select`(J2)·`pair-car`(J1)가 `standalone`·`onDone` 같은 속성을 받으면 이 문서의 `from` 방식으로 맞춘다.
- 4단계 [완료]가 3단계로 `replace`하는 동작은 위 라우트 보정으로 가린 것이다. `PairCarScreen`이 완료 뒤 이동을 속성(`onDone`)으로 받게 되면 `setup/pair-car.tsx`에서 `/`로 보내고 3단계 라우트의 보정은 지운다.
- 가족 탭의 보낸 요청은 일정 응답의 `familyRequests`로 만든다(서버에 목록 API 없음). 묶기·요청 4종·공유(J10b)는 자리만 있다.
- 장소 탭의 기억한 장소·이동 없음 목록(J2b)은 자리만 있다. 서버에 이동 없음 일정만 모아 주는 API가 없다.

## 검증

- `pnpm typecheck`, `pnpm phone:test`, `pnpm --filter @chagok/phone lint --max-warnings 0`
- jest: 탭 진입 분기(`src/__tests__/tabsLayout.test.tsx`, `setupRoutes.test.tsx`, `features/entry`), 오늘 탭(`features/today/__tests__`), 가족·설정·장소 탭, 공유 화면 `standalone`.
- Maestro `e2e/maestro/phone/today-tabs.yaml`: `E2E_FLOWS=today-tabs pnpm e2e:phone`(기준 시각이 고정된 `fixtures/schedules/pt-day.json`을 스크립트가 기본으로 쓴다). 기존 flow(`calendar-select`·`places`·`fill-places`·`pair-car`)는 첫 설정 화면에 직접 들어가는 경로·글자·testID가 그대로다.
