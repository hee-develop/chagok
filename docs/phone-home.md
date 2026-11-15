# 폰 아래 탭과 오늘(홈) 화면

정책서 10.7의 폰 화면 구성 중 **아래 탭 네 개(오늘 · 가족 · 장소 · 설정)** 와 **오늘(홈) 화면**입니다(작업 묶음 J5a).
서버는 건드리지 않고 기존 API(`GET /schedules/places`, `PUT /schedules/:id/place`·`care`, `GET /pair`(차 연결 상태), 가족 보내기, `GET /notifications`(알림함 폴링, J7), `GET`·`DELETE /places/memory`(기억한 장소, J3))만 씁니다.

## 앱을 열면

`phone/src/app/(tabs)/_layout.tsx`가 저장소의 첫 설정 완료 표시(`chagok.firstSetupDone.v1`)를 읽어 가른다.

- 표시가 있으면 탭(오늘·가족·장소·설정 순서)으로 들어간다. `/`는 오늘 탭이다(예전 `app/index.tsx` 리다이렉트는 없앴다).
- 표시가 없으면(처음이거나 읽지 못함) 기존 첫 설정 1단계(`/setup/calendar`)로 보낸다. 읽는 동안은 배경색만 그린다.
- **표시를 남기는 때**: 5단계(차 연결, `/setup/pair-car`)에서 **[건너뛰기](연결 전)나 [완료](연결 뒤)를 눌렀을 때**(`finishSetup()`). 같은 자리에서 **알림 권한을 한 번 묻는다**(정책 10.4 '첫 설정 끝', `askNotificationPermissionOnce()`, 창을 기다리지 않음). 탭에서 연 연결 화면은 연결에 성공했을 때 묻는다. `PairCarScreen`의 `onSkip`·`onDone`을 `setup/pair-car.tsx`가 받아 표시를 남기고 쌓인 설정 화면을 모두 닫아(`router.dismissAll`, 닫을 것이 없으면 생략) `replace('/')`로 오늘 탭을 새로 연다. 연결하지 않아도 홈으로 간다(탭의 [차 연결하기]로 나중에 연결). 5단계(와 그 앞의 4단계 '말 거는 방법')에 닿기만 한 것은 끝낸 것으로 치지 않는다.
- 저장소에 쓰지 못해도 그 실행 동안은 메모리 표시(`setupGate.ts`)로 탭에 간다. 다음에 앱을 열 때 첫 설정이 한 번 더 보일 뿐이다.
- 3단계 라우트(`setup/fill-places.tsx`)는 표시를 보지 않는다(예전 보정은 3단계 진입 때 빈 화면이 깜빡이고 엉뚱한 탭 이동을 일으켜 지웠다).
- 저장소는 `@react-native-async-storage/async-storage`(Expo Go 내장, 2.2.0 하나)이고 `src/storage/keyValueStore.ts`가 부르는 유일한 곳이다. '이동 일정이에요' 예외 이름(`travelExceptions.ts`)도 같은 래퍼를 쓴다. 비밀 값은 두지 않는다(폰 토큰은 expo-secure-store).

## 탭

| 탭 | 라우트 | 구현 | 내용 |
| --- | --- | --- | --- |
| 오늘 | `(tabs)/index.tsx` | `features/today/TodayScreen` | 알림함(읽지 않은 알림), 꺼진 권한·일정을 보낼 수 없는 이유 안내, 차 연결 상태, 장소 빈 일정 배너, 오늘 일정, 다른 날 장소 빈 일정, 받은 가족 요청(빈 상태만) |
| 가족 | `(tabs)/family.tsx` | `features/family/FamilyTabScreen` | 보내기 입구(→ 오늘 탭), 보낸 요청 목록, 가족 묶기 자리 |
| 장소 | `(tabs)/places.tsx` | `features/places/PlacesScreen mode="tab"` | 자주 가는 곳(2단계 화면 재사용, **단골 줄마다 [삭제]·확인**, `RemoveOtherConfirm`), **기억한 장소 목록·지우기**(`RememberedPlaces`), **이동 없음 목록·지우기**(`features/skips/SkipList`, 정책 10.8) |
| 설정 | `(tabs)/settings.tsx` | `features/settings/SettingsScreen` | 주행 중 고정 안내, 스위치(플러스 모드·늦을 때 연락·화면 없이 음성만), 차 연결 상태·끊기, 캘린더 고르기·장소 탭 입구, 권한 상태 (`docs/settings.md`) |

스위치(플러스 모드·늦을 때 연락·음성만)와 차 연결 끊기는 J5b에서 붙었다(계약·상태는 `docs/settings.md`). **'캘린더에 장소 적기'는 만들지 않는다**(사용자가 뺀 기능).

## 오늘 탭

- **오늘 일정**: `GET /schedules/places` 응답의 `anchor`(서버가 말하는 오늘)를 서울 날짜로 보고, 시작이 그 날짜이거나 전날 시작해 anchor에 아직 끝나지 않은 일정(`/schedules/today`와 같은 규칙, `features/today/todaySchedules.ts`)을 시작순으로 보인다. 서버가 아는 이동 없음 일정(서버 안전망이 거른 것)과 **폰이 읽을 때 거른 일정**(온라인·건물 안·종일 판정, 서버로 보내지 않아 폰 로컬 목록 `useFilteredEvents`에만 있음)은 '이동 없음 · 온라인 회의' 글과 함께 흐리게 보인다(정책서 6장 '이동 아닌 일정'). 흐림은 `opacity`가 아니라 글자·배경 색(`colors.dimmed`·`colors.notice`)으로 낮춰 상태 글자 대비가 4.5:1 이상이다.
- **거른 일정을 누르면**(`FilteredRow`) 3단계와 같은 확인('이동 일정으로 바꿀까요?', `TravelConfirmBox`)이 나오고 [바꾸기]를 눌러야 이동 일정으로 바뀐다(`useTravelMark`). 바꾼 직후 10초 동안 '되돌리기'와 실패 안내(`TravelMarkNotice`)가 일정 구역 아래에 보이고, 바뀌면 서버 목록을 다시 읽는다. 서버 일정과 거른 줄은 id가 같으면 서버 줄만 보인다(`mergeScheduleItems`).
- **줄의 접근성**: 줄 이름(`accessibilityLabel`)은 '제목 시간 상태'(예: '주간 회의 15:00 이동 없음 · 온라인 회의', '육전집 점심 13:00 장소 없음')이고 펼치기·접기는 `accessibilityHint`다. 펼침 상태는 `accessibilityState.expanded`.
- **장소 빈 일정**: 위 배너는 오늘 + 다른 날(아직 끝나지 않은) 일정 중 `place === null && !noTravel`인 수다. 오늘이 아닌 빈 일정은 '다른 날 장소가 빈 일정' 구역에 날짜와 함께 모은다. 장소가 정해지면 그 구역에서 빠진다.
- **일정을 누르면** 그 자리에서 펼쳐져 3단계 카드와 같은 줄(`features/fill-places/ScheduleActions`)이 나온다: 장소 넣기·변경, 이동 없음, '여기 맞아요', 채비 넣기·수정, 가족에게 보내기. 장소 검색·채비·가족 화면은 기존 `/setup/schedule-place-search`·`schedule-care`·`family-send` 라우트를 `from=today`로 열어 단계 표시('3 / 5') 없이 보이고, 닫으면 오늘 탭으로 돌아온다(탭은 포커스를 얻을 때 일정을 다시 읽는다).
- 저장·조회는 3단계와 같은 훅(`features/fill-places/useSchedulePlaces`)이다: 10초 제한(`requestWithTimeout`), 새 조회가 시작되면 이전 조회 취소, 응답을 반영하기 전에 그 요청의 controller가 아직 현재 것인지 확인(늦게 온 응답은 버림), 저장은 한 번에 하나, 4xx는 일정이 바뀐 것이라 다시 읽기. 탭을 오갈 때(포커스를 잃을 때) **조회만 취소하고 진행 중인 저장은 끝까지 보낸다**(언마운트 때만 취소). 저장이 끝나기 전에 다시 포커스를 얻으면 그 저장이 끝난 뒤에 읽는다. 이미 읽은 목록은 다시 읽는 동안 그대로 보여 깜빡이지 않는다.
- **저장 오류**: 4xx(일정이 바뀜)는 같은 저장을 다시 보내면 안 되므로 문구와 [닫기]만 둔다(목록은 이미 다시 읽는 중). 그 밖의 실패(네트워크·5xx)는 [다시 시도].
- **차 연결 상태**: 폰 토큰으로 `GET /pair`(`pairingApi.status()`)를 묻는다. 200이면 '✓ 차와 연결돼 있어요'와 자리 이름(이 폰의 기기 이름)·연결 시각, 401(토큰이 없거나 서버가 모름·끊김)이면 '연결되지 않았어요'. 그 밖의 확인 실패는 '연결 안 됨'으로 단정하지 않고 오류 상태(다시 확인)로 둔다. J1부터 폰 응답에 차 id가 없어 폰은 차 id를 저장하지 않는다. 예전 버전이 남긴 `chagok.pairedCarId.v1`는 상태를 처음 확인할 때 한 번 지운다(`LEGACY_PAIRED_CAR_KEY`). 이미 결과가 있으면 다시 확인하는 동안 직전 결과를 둔다.
- **맨 위(위에서 아래 순서)**: ① **알림함**(`InboxSection`, J7 `useInbox()`의 읽지 않은 알림. 줄을 누르면 `handleNotificationTap`으로 종류별 처리(예: `events-stale`은 일정을 다시 보내 보고 못 보내면 캘린더 고르기로)와 읽음, 읽으면 줄이 사라진다. 둘 이상이면 [모두 읽음]. 없으면 구역이 없다) ② **권한·보낼 수 없는 이유 안내** ③ 차 연결 상태. 알림 권한을 거부해도 알림은 이 ①에 쌓인다.
- **꺼진 권한 안내**(정책 10.4: **홈 맨 위**): 홈에는 **거부한 권한만** 보인다. **연락처**는 '늦을 때 연락'이 **켜져 있을 때만**, 거부했을 때 '연락처를 켜면 늦을 때 연락할 상대를 미리 찾아 둘 수 있어요…' + [설정 열기]로 보인다(`useContactsGuide`: 설정을 읽는 중·못 읽음·아직 안 물음·꺼 둠이면 보이지 않는다). 캘린더는 홈에 꼭 필요하므로 아직 묻지 않은 상태(`ask`)에서도 [켜기]를 두고, 카메라는 한 번도 묻지 않았으면 보이지 않으며 거부(`denied`)했고 아직 연결 전일 때만 [설정 열기]로 보인다. **알림**도 같은 규칙이다: 첫 설정 끝에 한 번 묻고, 거부(`denied`)했을 때만 '켜면 이게 돼요' 한 줄과 [설정 열기]가 남는다(아직 안 물었으면 홈에는 안 보임, 설정 탭은 모두 보임). 일정 동기화가 일정을 보낼 수 없는 이유를 알려 오면(`useEventSendBlock()`) 같은 구역에 보인다: `no-selection`은 '고른 캘린더가 없어요' + [캘린더 고르기](설정 탭과 같은 standalone 화면), `permission-denied`는 권한 목록이 아직 켜짐이어도 캘린더 안내(`events-stale` 알림은 이 폰에서 쌓지 않고 이 안내로 대신한다, `docs/notifications.md`). 앱이 앞으로 돌아올 때(설정에서 켜고 온 경우)와 탭이 포커스를 얻을 때 다시 읽고, 다시 읽다 실패해도 직전 결과를 유지해 화면이 출렁이지 않는다. 설정 탭은 켜진 것까지 모두 보인다. `EXPO_PUBLIC_CALENDAR_SOURCE=mock`이면 캘린더는 권한이 필요 없다.
- **받은 가족 요청**: 서버에 받는 쪽 API가 없어 빈 상태 문구만 둔다(J10b가 채움).

### 상태 5종

| 상태 | 오늘 | 가족 | 장소 | 설정 |
| --- | --- | --- | --- | --- |
| 로딩 | 일정·연결 구역별 진행 표시 | 보낸 요청 진행 표시 | 기존(2단계), 기억한 장소 진행 표시 | 스위치·연결·권한 구역별 진행 표시 |
| 빈 | '오늘은 차로 갈 일정이 없어요.'(알림함은 비면 구역이 없음) | '아직 보낸 요청이 없어요.' | 기억한 장소·이동 없음 빈 문구('이동 없음으로 기억한 일정이 없어요.') | 해당 없음 |
| 오류 | [다시 시도], 연결은 [다시 확인] | [다시 시도] | 기존(2단계), 기억한 장소 [다시 시도]·지우기 실패 안내 | 스위치 [다시 시도]·저장 실패(되돌림), 연결 [다시 확인]·끊기 실패, 권한 [다시 확인] |
| 권한 없음 | 캘린더 꺼짐이면 일정을 요청하지 않고 [켜기]/[설정 열기] | 같음 | 해당 없음(서버 검색만 씀) | 권한 구역에 상태와 버튼, 연락처는 '늦을 때 연락' 줄 아래 안내 |
| 정상 | 알림함·일정·배너·연결 상태 | 보낸 요청 목록 | 자주 가는 곳·기억한 장소(지우기는 확인을 거침) | 안내·스위치·연결 끊기·입구·권한(캘린더·카메라·알림) |

## 파일

- 공용으로 뽑은 것: `features/fill-places/ScheduleActions.tsx`(3단계 카드의 장소·채비·가족 줄. '여기 맞아요'는 J3의 `confirmChange`: 목 후보는 id로, 지난번 기억(`placeId: null`)은 `suggestion.place` 스냅숏으로 저장), `useSchedulePlaces.ts`(조회·저장 훅), `scheduleItems.ts`(서버 일정과 거른 일정 합치기), `scheduleFormat.ts`, `ui/TabScreen.tsx`·`ui/blocks.tsx`(탭 공통 틀·구역·상태 블록). 3단계 화면(`FillPlacesScreen`)도 같은 컴포넌트·훅에 J2의 거른 줄·확인·되돌리기(`FilteredEventCard`·`TravelMarkNotice`·`useTravelMark`·`useFilteredEvents`)를 얹은 것이다(동작·글자·testID 그대로). 확인 상자는 `FilteredEventCard.tsx`의 `TravelConfirmBox`로 뽑아 오늘 탭도 쓴다.
- 오늘 탭 줄: `features/today/ScheduleHead.tsx`(머리), `ScheduleRow.tsx`(서버 일정), `FilteredRow.tsx`(폰이 거른 일정).
- `SetupHeader`의 `step`은 선택값이다. 없으면 로고만 보인다. 첫 설정은 **5단계**다(캘린더 → 자주 가는 곳 → 장소 빈 일정 → 말 거는 방법(`setup/talk`) → 차 연결, `SETUP_TOTAL_STEPS`).
- **탭에서 연 화면은 단계 표시 없이 열리고 끝나면 탭으로 돌아온다**(`standalone`): `ScheduleCareScreen`·`FamilySendScreen`·`PlaceSearchScreen`(오늘·장소 탭), `CalendarSelectScreen`(설정 탭 [캘린더 고르기], `from=tab`, 저장하면 2단계 대신 이전 화면으로, [나중에 할게요]는 [닫기]), `PairCarScreen`(오늘·설정 탭 [차 연결하기], `from=tab`, [완료]는 이전 화면으로). 라우트(`setup/*.tsx`)가 `from` 파라미터를 보고 `standalone`을 준다. 첫 설정 흐름의 글자·testID는 그대로다.
- 문구는 `phone/src/i18n/ko.ts`(`tabs`·`permissions`·`carConnection`·`today`·`familyTab`·`placesTab`·`settings`).
- 테스트 도우미(가짜 api·권한·연결)는 `src/__tests__/support/todaySupport.ts`(jest 설정이 `/__tests__/support/`를 테스트로 세지 않게 제외한다).

## 알려진 한계(다음 묶음이 이어 붙일 곳)

- 가족 탭의 보낸 요청은 일정 응답의 `familyRequests`로 만든다(서버에 목록 API 없음). 묶기·요청 4종·공유(J10b)는 자리만 있다.
- 장소 탭의 이동 없음 목록은 `SkipList`(J2b)가 `GET·PUT /skips`의 이름 목록을 보이고 지운다(기억한 이름이라 같은 이름 일정은 차에 안 간다. 지우면 다시 간다). 폰 캐시는 `features/skips/skipMemory.ts`이고 서버가 기억 상한이라 거절하면 목록 위에 '가득 찼어요' 안내가 뜬다. 오늘 탭·3단계는 **[이동 없음] 안내와 10초 [되돌리기]**(`useSchedulePlaces`의 `skipNotice`·`NoTravelNotices`)를 같이 쓰고, 이름으로 기억해 폰이 거른 일정은 거른 줄('이동 없음 · 이동 없음으로 기억')로 보이며 [이동 일정이에요]는 그 기억을 지운다(`useTravelMark`의 `lines[].reason`). 기억한 장소(J3)는 `RememberedPlaces`로 붙었다.
- 설정 탭의 스위치·차 연결 끊기는 J5b로 붙었다(`docs/settings.md`). 받은 가족 요청(J10b)은 `TodayScreen`의 `family-inbox` 구역을 채우고, 새 알림 종류의 누름 처리는 `registerTapHandler(kind, ...)`로 더한다(알림함 줄이 같은 처리를 부른다).
- 5단계(차 연결) 건너뛰기 글자는 J1의 `strings.pairCar.skip`('건너뛰기')을 그대로 쓴다. 4단계 '말 거는 방법'의 [건너뛰기]도 같은 글자다. 3단계의 '나중에 할게요'와 글자를 맞출지는 정하지 않았다.
- 3단계 카드의 거른 줄은 J2의 `opacity` 흐림(`FilteredEventCard`)을 그대로 두었다. 대비 4.5:1을 지키는 색 방식은 오늘 탭에만 적용했다.

## 검증

- `pnpm typecheck`, `pnpm phone:test`, `pnpm --filter @chagok/phone lint --max-warnings 0`
- jest: 탭 진입 분기(`src/__tests__/tabsLayout.test.tsx`, `setupRoutes.test.tsx`, `features/entry`), 오늘 탭(`features/today/__tests__`: 상태 5종·권한·연결·거른 일정·4xx 저장·포커스 때 다시 읽기·늦은 응답 버리기·저장 중 탭 전환), 가족·설정·장소 탭, 공유 화면 `standalone`(채비·가족·검색·캘린더 고르기·차 연결).
- 설정 탭·말 거는 방법 단계 테스트는 `features/settings/__tests__`(`docs/settings.md`).
- Maestro `e2e/maestro/phone/today-tabs.yaml`: `E2E_FLOWS=today-tabs pnpm e2e:phone`(기준 시각이 고정된 `fixtures/schedules/pt-day.json`을 스크립트가 기본으로 쓴다). 기존 flow(`calendar-select`·`places`·`fill-places`·`pair-car`)는 첫 설정 화면에 직접 들어가는 경로·글자·testID가 그대로다.
