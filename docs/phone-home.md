# 폰 아래 탭과 오늘(홈) 화면

정책서 10.7의 폰 화면 구성 중 **아래 탭 네 개(오늘 · 가족 · 장소 · 설정)** 와 **오늘(홈) 화면**입니다(작업 묶음 J5a).
서버는 건드리지 않고 기존 API(`GET /schedules/places`, `PUT /schedules/:id/place`·`care`, `GET /pair`(차 연결 상태), 가족 보내기)만 씁니다.

## 앱을 열면

`phone/src/app/(tabs)/_layout.tsx`가 저장소의 첫 설정 완료 표시(`chagok.firstSetupDone.v1`)를 읽어 가른다.

- 표시가 있으면 탭(오늘·가족·장소·설정 순서)으로 들어간다. `/`는 오늘 탭이다(예전 `app/index.tsx` 리다이렉트는 없앴다).
- 표시가 없으면(처음이거나 읽지 못함) 기존 첫 설정 1단계(`/setup/calendar`)로 보낸다. 읽는 동안은 배경색만 그린다.
- **표시를 남기는 때**: 4단계(`/setup/pair-car`)에서 **[건너뛰기](연결 전)나 [완료](연결 뒤)를 눌렀을 때**. `PairCarScreen`의 `onSkip`·`onDone`을 `setup/pair-car.tsx`가 받아 표시를 남기고 쌓인 설정 화면을 모두 닫아(`router.dismissAll`, 닫을 것이 없으면 생략) `replace('/')`로 오늘 탭을 새로 연다. 연결하지 않아도 홈으로 간다(탭의 [차 연결하기]로 나중에 연결). 4단계에 닿기만 한 것은 끝낸 것으로 치지 않는다.
- 저장소에 쓰지 못해도 그 실행 동안은 메모리 표시(`setupGate.ts`)로 탭에 간다. 다음에 앱을 열 때 첫 설정이 한 번 더 보일 뿐이다.
- 3단계 라우트(`setup/fill-places.tsx`)는 표시를 보지 않는다(예전 보정은 3단계 진입 때 빈 화면이 깜빡이고 엉뚱한 탭 이동을 일으켜 지웠다).
- 저장소는 `@react-native-async-storage/async-storage`(Expo Go 내장, 2.2.0 하나)이고 `src/storage/keyValueStore.ts`가 부르는 유일한 곳이다. '이동 일정이에요' 예외 이름(`travelExceptions.ts`)도 같은 래퍼를 쓴다. 비밀 값은 두지 않는다(폰 토큰은 expo-secure-store).

## 탭

| 탭 | 라우트 | 구현 | 내용 |
| --- | --- | --- | --- |
| 오늘 | `(tabs)/index.tsx` | `features/today/TodayScreen` | 차 연결 상태, 꺼진 권한 안내, 장소 빈 일정 배너, 오늘 일정, 다른 날 장소 빈 일정, 받은 가족 요청(빈 상태만) |
| 가족 | `(tabs)/family.tsx` | `features/family/FamilyTabScreen` | 보내기 입구(→ 오늘 탭), 보낸 요청 목록, 가족 묶기 자리 |
| 장소 | `(tabs)/places.tsx` | `features/places/PlacesScreen mode="tab"` | 자주 가는 곳(2단계 화면 재사용), 기억한 장소·이동 없음 목록 자리 |
| 설정 | `(tabs)/settings.tsx` | `features/settings/SettingsScreen` | 주행 중 고정 안내, 차 연결 입구, 캘린더 고르기 입구, 권한 상태 |

스위치(플러스 모드·늦을 때 연락·음성만)는 다음 묶음(J5b)이다. **'캘린더에 장소 적기'는 만들지 않는다**(사용자가 뺀 기능).

## 오늘 탭

- **오늘 일정**: `GET /schedules/places` 응답의 `anchor`(서버가 말하는 오늘)를 서울 날짜로 보고, 시작이 그 날짜이거나 전날 시작해 anchor에 아직 끝나지 않은 일정(`/schedules/today`와 같은 규칙, `features/today/todaySchedules.ts`)을 시작순으로 보인다. 서버가 아는 이동 없음 일정(서버 안전망이 거른 것)과 **폰이 읽을 때 거른 일정**(온라인·건물 안·종일 판정, 서버로 보내지 않아 폰 로컬 목록 `useFilteredEvents`에만 있음)은 '이동 없음 · 온라인 회의' 글과 함께 흐리게 보인다(정책서 6장 '이동 아닌 일정'). 흐림은 `opacity`가 아니라 글자·배경 색(`colors.dimmed`·`colors.notice`)으로 낮춰 상태 글자 대비가 4.5:1 이상이다.
- **거른 일정을 누르면**(`FilteredRow`) 3단계와 같은 확인('이동 일정으로 바꿀까요?', `TravelConfirmBox`)이 나오고 [바꾸기]를 눌러야 이동 일정으로 바뀐다(`useTravelMark`). 바꾼 직후 10초 동안 '되돌리기'와 실패 안내(`TravelMarkNotice`)가 일정 구역 아래에 보이고, 바뀌면 서버 목록을 다시 읽는다. 서버 일정과 거른 줄은 id가 같으면 서버 줄만 보인다(`mergeScheduleItems`).
- **줄의 접근성**: 줄 이름(`accessibilityLabel`)은 '제목 시간 상태'(예: '주간 회의 15:00 이동 없음 · 온라인 회의', '육전집 점심 13:00 장소 없음')이고 펼치기·접기는 `accessibilityHint`다. 펼침 상태는 `accessibilityState.expanded`.
- **장소 빈 일정**: 위 배너는 오늘 + 다른 날(아직 끝나지 않은) 일정 중 `place === null && !noTravel`인 수다. 오늘이 아닌 빈 일정은 '다른 날 장소가 빈 일정' 구역에 날짜와 함께 모은다. 장소가 정해지면 그 구역에서 빠진다.
- **일정을 누르면** 그 자리에서 펼쳐져 3단계 카드와 같은 줄(`features/fill-places/ScheduleActions`)이 나온다: 장소 넣기·변경, 이동 없음, '여기 맞아요', 채비 넣기·수정, 가족에게 보내기. 장소 검색·채비·가족 화면은 기존 `/setup/schedule-place-search`·`schedule-care`·`family-send` 라우트를 `from=today`로 열어 단계 표시('3 / 4') 없이 보이고, 닫으면 오늘 탭으로 돌아온다(탭은 포커스를 얻을 때 일정을 다시 읽는다).
- 저장·조회는 3단계와 같은 훅(`features/fill-places/useSchedulePlaces`)이다: 10초 제한(`requestWithTimeout`), 새 조회가 시작되면 이전 조회 취소, 응답을 반영하기 전에 그 요청의 controller가 아직 현재 것인지 확인(늦게 온 응답은 버림), 저장은 한 번에 하나, 4xx는 일정이 바뀐 것이라 다시 읽기. 탭을 오갈 때(포커스를 잃을 때) **조회만 취소하고 진행 중인 저장은 끝까지 보낸다**(언마운트 때만 취소). 저장이 끝나기 전에 다시 포커스를 얻으면 그 저장이 끝난 뒤에 읽는다. 이미 읽은 목록은 다시 읽는 동안 그대로 보여 깜빡이지 않는다.
- **저장 오류**: 4xx(일정이 바뀜)는 같은 저장을 다시 보내면 안 되므로 문구와 [닫기]만 둔다(목록은 이미 다시 읽는 중). 그 밖의 실패(네트워크·5xx)는 [다시 시도].
- **차 연결 상태**: 폰 토큰으로 `GET /pair`(`pairingApi.status()`)를 묻는다. 200이면 '✓ 차와 연결돼 있어요'와 자리 이름(이 폰의 기기 이름)·연결 시각, 401(토큰이 없거나 서버가 모름·끊김)이면 '연결되지 않았어요'. 그 밖의 확인 실패는 '연결 안 됨'으로 단정하지 않고 오류 상태(다시 확인)로 둔다. J1부터 폰 응답에 차 id가 없어 폰은 차 id를 저장하지 않는다. 예전 버전이 남긴 `chagok.pairedCarId.v1`는 상태를 처음 확인할 때 한 번 지운다(`LEGACY_PAIRED_CAR_KEY`). 이미 결과가 있으면 다시 확인하는 동안 직전 결과를 둔다.
- **꺼진 권한 안내**(정책 10.4: **홈 맨 위**, 그 아래가 차 연결 상태): 홈에는 **거부한 권한만** 보인다. 캘린더는 홈에 꼭 필요하므로 아직 묻지 않은 상태(`ask`)에서도 [켜기]를 두고, 카메라는 한 번도 묻지 않았으면 보이지 않으며 거부(`denied`)했고 아직 연결 전일 때만 [설정 열기]로 보인다. 앱이 앞으로 돌아올 때(설정에서 켜고 온 경우)와 탭이 포커스를 얻을 때 다시 읽고, 다시 읽다 실패해도 직전 결과를 유지해 화면이 출렁이지 않는다. 설정 탭은 켜진 것까지 모두 보인다. `EXPO_PUBLIC_CALENDAR_SOURCE=mock`이면 캘린더는 권한이 필요 없다.
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

- 공용으로 뽑은 것: `features/fill-places/ScheduleActions.tsx`(3단계 카드의 장소·채비·가족 줄), `useSchedulePlaces.ts`(조회·저장 훅), `scheduleItems.ts`(서버 일정과 거른 일정 합치기), `scheduleFormat.ts`, `ui/TabScreen.tsx`·`ui/blocks.tsx`(탭 공통 틀·구역·상태 블록). 3단계 화면(`FillPlacesScreen`)도 같은 컴포넌트·훅에 J2의 거른 줄·확인·되돌리기(`FilteredEventCard`·`TravelMarkNotice`·`useTravelMark`·`useFilteredEvents`)를 얹은 것이다(동작·글자·testID 그대로). 확인 상자는 `FilteredEventCard.tsx`의 `TravelConfirmBox`로 뽑아 오늘 탭도 쓴다.
- 오늘 탭 줄: `features/today/ScheduleHead.tsx`(머리), `ScheduleRow.tsx`(서버 일정), `FilteredRow.tsx`(폰이 거른 일정).
- `SetupHeader`의 `step`은 선택값이다. 없으면 로고만 보인다.
- **탭에서 연 화면은 단계 표시 없이 열리고 끝나면 탭으로 돌아온다**(`standalone`): `ScheduleCareScreen`·`FamilySendScreen`·`PlaceSearchScreen`(오늘·장소 탭), `CalendarSelectScreen`(설정 탭 [캘린더 고르기], `from=tab`, 저장하면 2단계 대신 이전 화면으로, [나중에 할게요]는 [닫기]), `PairCarScreen`(오늘·설정 탭 [차 연결하기], `from=tab`, [완료]는 이전 화면으로). 라우트(`setup/*.tsx`)가 `from` 파라미터를 보고 `standalone`을 준다. 첫 설정 흐름의 글자·testID는 그대로다.
- 문구는 `phone/src/i18n/ko.ts`(`tabs`·`permissions`·`carConnection`·`today`·`familyTab`·`placesTab`·`settings`).
- 테스트 도우미(가짜 api·권한·연결)는 `src/__tests__/support/todaySupport.ts`(jest 설정이 `/__tests__/support/`를 테스트로 세지 않게 제외한다).

## 알려진 한계(다음 묶음이 이어 붙일 곳)

- 가족 탭의 보낸 요청은 일정 응답의 `familyRequests`로 만든다(서버에 목록 API 없음). 묶기·요청 4종·공유(J10b)는 자리만 있다.
- 장소 탭의 기억한 장소·이동 없음 목록(J2b)은 자리만 있다. 서버에 이동 없음 일정만 모아 주는 API가 없다. 오늘 탭의 거른 줄이 쓰는 `useFilteredEvents`·`travelExceptions`가 그 목록의 폰 쪽 출처다.
- 설정 탭의 스위치(플러스 모드·늦을 때 연락·음성만)는 J5b가 `features/settings/SettingsScreen.tsx`에 구역을 더해 붙인다. 알림함(받은 가족 요청)은 `TodayScreen`의 `family-inbox` 구역을 채운다.
- 4단계 건너뛰기 글자는 J1의 `strings.pairCar.skip`('건너뛰기')을 그대로 쓴다. 나머지 건너뛰기 버튼('나중에 할게요')과 글자를 맞출지는 정하지 않았다.
- 3단계 카드의 거른 줄은 J2의 `opacity` 흐림(`FilteredEventCard`)을 그대로 두었다. 대비 4.5:1을 지키는 색 방식은 오늘 탭에만 적용했다.

## 검증

- `pnpm typecheck`, `pnpm phone:test`, `pnpm --filter @chagok/phone lint --max-warnings 0`
- jest: 탭 진입 분기(`src/__tests__/tabsLayout.test.tsx`, `setupRoutes.test.tsx`, `features/entry`), 오늘 탭(`features/today/__tests__`: 상태 5종·권한·연결·거른 일정·4xx 저장·포커스 때 다시 읽기·늦은 응답 버리기·저장 중 탭 전환), 가족·설정·장소 탭, 공유 화면 `standalone`(채비·가족·검색·캘린더 고르기·차 연결).
- Maestro `e2e/maestro/phone/today-tabs.yaml`: `E2E_FLOWS=today-tabs pnpm e2e:phone`(기준 시각이 고정된 `fixtures/schedules/pt-day.json`을 스크립트가 기본으로 쓴다). 기존 flow(`calendar-select`·`places`·`fill-places`·`pair-car`)는 첫 설정 화면에 직접 들어가는 경로·글자·testID가 그대로다.
