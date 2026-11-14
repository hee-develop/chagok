# 차곡

Pleos Connect(현대차그룹 AAOS 기반 인포테인먼트) 차량 앱 사이드 프로젝트입니다.

## 구조

- `car/`: 차량 앱. Kotlin 네이티브 + Pleos Connect SDK. 독립 Gradle 프로젝트이고 패키지는 `com.chagok.car`
- `phone/`: 휴대폰 앱. React Native(Expo). 패키지는 `@chagok/phone`
- `server/`: 서버. TypeScript + Hono, Node 런타임. 패키지는 `@chagok/server`
- `docs/`: 기획·설계 문서
- `fixtures/`: 목 데이터(`fixtures/schedules/gwangju-day.json`은 서버와 차량 앱 테스트 공용, `calendars/`·`places/`는 폰 앱·서버, `family/`는 서버)
- `e2e/`: Maestro flow(`e2e/maestro/car/`). 산출물은 `e2e/output/`(git 제외)
- JS 쪽(`phone/`, `server/`)은 pnpm 워크스페이스로 묶여 있습니다. 설치는 루트에서 `pnpm install`로 하고, 폰 앱은 서버의 라우트 타입(`AppType`)을 Hono RPC 클라이언트로 가져다 씁니다.

## 폰 앱·서버(JS)

- 설치는 루트에서 `pnpm install`. Expo 패키지는 `pnpm exec expo install`로 추가하고, 라우트는 `phone/src/app/`(Expo Router)에 둡니다.
- 확인: `pnpm typecheck`, `pnpm server:test`, `pnpm phone:test`, `pnpm --filter @chagok/phone lint --max-warnings 0`. E2E는 `pnpm e2e:phone`(Maestro, Expo Go).
- 검증은 Android 기준입니다. Android 에뮬레이터는 `Pixel_10_Pro_XL`을 `-port 5556`으로 쓰고, `emulator-5554`(Pleos 차량 에뮬레이터)는 건드리지 않습니다. adb는 항상 `-s`로 기기를 지정합니다.
- 웹 타깃을 다시 넣을 때는 `.pnpmfile.cjs` 훅을 지우고 다시 설치한다(react-dom이 자동 설치되는 버전이 SDK 58의 react와 맞지 않아 훅으로 제거해 두었다).
- Android 에뮬레이터의 Expo Go가 `10.0.2.2`에 붙지 못하는 경우가 있어, E2E는 `adb reverse`로 Metro·서버 포트를 기기 `127.0.0.1`에 잇고 `exp://127.0.0.1:<metro>`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:<server>`를 씁니다(`scripts/e2e-phone.sh`). 이미 떠 있는 에뮬레이터·포트를 건드리지 않게 `E2E_AVD`·`E2E_ANDROID_PORT`·`E2E_METRO_PORT`·`E2E_SERVER_PORT`로 바꿔 돌립니다.
- 장소 목 데이터(검색 대상·추천)는 `fixtures/places/`가 단일 출처입니다(서버만 읽음). 폰 앱의 요청 10초 제한은 `phone/src/api/request.ts`의 `requestWithTimeout`을 캘린더와 2단계가 같이 씁니다. 캘린더 저장만 폰이 보내는 revision(`createRevisionClock`)을 쓰고, 2단계(자주 가는 곳)의 revision은 서버가 매기며 폰은 비교하지 않습니다. 오래된 응답은 저장을 한 번에 하나만 두고, 새 조회가 시작되면 이전 조회를 취소하고, 응답을 화면에 반영하기 전에 그 요청의 controller가 아직 현재 것인지 확인해서 막습니다.
- 첫 설정 3단계(`phone/src/features/fill-places/`)는 `GET /schedules/places`, `PUT /schedules/:id/place`로 일정별 장소 보정·이동 없음을 저장한다. 원본 캘린더를 수정하지 않으며, 보정은 `/schedules/today`에 반영하고 이동 없음은 차량 응답에서 뺀다. 4단계(`phone/src/features/pair-car/`)는 차 화면의 QR(expo-camera)이나 6자리 번호로 차와 연결한다(`POST /pair/claim`, 기기 이름을 자리 이름으로 보내고 받은 폰 토큰을 `expo-secure-store`에 저장해 `phone/src/api/client.ts`가 모든 요청에 `Authorization: Bearer`로 붙인다). 계약은 `docs/pairing.md`. 일정 제목으로 기억한 장소(`fixtures/places/remembered.json`)는 `GET /schedules/places`의 `suggestion`으로 내려 '여기 맞아요'가 기존 `PUT`으로 저장한다. 계약은 `docs/fill-places.md`를 따른다. 온라인 회의·회의실 일정은 서버(`server/src/noTravel.ts`)가 저절로 이동 없음으로 보고 `noTravelReason`을 붙이며, 3단계는 그 카드를 흐리게 보인다(장소를 넣으면 다시 차로 간다). 3단계 카드의 채비 줄에서 일정마다 채비 한 줄을 적고(`PUT /schedules/:id/care`, 서버에만 저장), 차는 그날 첫 탑승에 오늘 일정들의 앱 채비를 모아 메모보다 먼저 읽는다. 계약은 `docs/care.md`. 같은 카드의 가족 줄에서 일정을 미리 묶어 둔 가족(`fixtures/family/members.json`)에게 보내면(`POST /schedules/:id/family-request`) 서버가 보낼 때의 일정 내용을 저장하고 '전달됨'으로 돌려준다. 받는 쪽은 아직 프로토타입이다. 계약은 `docs/family-send.md`.
- 목 캘린더는 `fixtures/calendars/mock-device.json`이 단일 출처입니다(폰 앱·서버 공용). 일정 픽스처를 바꾸면 차량 테스트 도우미(`FixtureResponses`)가 같은 기본 선택 규칙을 따릅니다.
- 캘린더 출처는 `EXPO_PUBLIC_CALENDAR_SOURCE=mock|device`(기본 device = `expo-calendar/legacy`로 실제 Android 캘린더 읽기, mock = 테스트·E2E용 목). 권한을 거부하면 목으로 넘어가지 않고 허용 안내만 보여 줍니다. `scripts/e2e-phone.sh`는 mock을 명시하고, 실제 캘린더 flow는 `E2E_FLOWS=device-calendar`(`scripts/seed-phone-calendar.sh`가 에뮬레이터에 캘린더를 심고 끝나면 지움)로 따로 돌립니다. expo-calendar 새 객체 API는 Expo Go에서 안 되므로 legacy를 씁니다.
- 폰은 device 출처에서 앱을 열 때·앞으로 올 때·선택 저장 직후 고른 캘린더의 오늘·내일(서울) 일정을 `PUT /events`로 동시에 하나만 보냅니다(`phone/src/features/calendar-sync/`). 서버는 `PUT /events`·`GET /events?date=`·`DELETE /events`(같은 기기만, 폰 일정 비우고 픽스처 복귀. `server/src/routes/events.ts`)로 메모리에 두고 날짜가 지나면 지웁니다. `/schedules/today`·`/places`는 폰이 한 번이라도 보냈으면 폰 일정(보정 → 목 장소 이름 정규화 완전 일치만 좌표 확정, 일부 일치·제목 기억은 `suggestion` → null), 안 보냈으면 픽스처(데모·차량 E2E 경로, 변경 금지)입니다. 선택은 `source`(`mock`|`device`)를 저장하고 일정 출처와 같을 때만 적용합니다. 폰 앱을 8787 서버에 붙이면 데모·차량 E2E가 폰 일정을 받으니 `GET /events`의 `receivedAt`이 null인지 확인하고, `HOST=0.0.0.0`이면 `EVENTS_LOOPBACK_ONLY=1`을 줍니다. 서버 시계는 `createApp({ now })`로 주입해 시간 의존 테스트를 고정합니다. 실제 캘린더 id 선택은 `PUT /calendars/selection`에 `source: "device"`로 보냅니다. 계약: `docs/calendar-sync.md`.
- 운전자 자리(`server/src/seats.ts` `SeatStore`, 자리별 데이터 `seatData.ts`, 요청이 다루는 자리를 정하는 `seatScope.ts`): 한 차에 폰 여러 대(폰 한 대 = 자리 하나), 일정·캘린더 선택·장소 보정·채비·자주 가는 곳·가족 요청이 자리별로 따로 쌓이고 저장은 메모리다. 새 저장소(장소 기억·도착 횟수 등)는 `SeatData`에 붙인다. **쓰기는 폰 토큰이 있으면 그 자리, 토큰 없이 `X-Chagok-Device`(폰이 첫 실행 때 만든 난수)만 있으면 그 기기의 '연결 전 버킷', 식별이 전혀 없으면 '기본 자리'**(픽스처·데모·차량 E2E 경로, 변경 금지)이고 모르는 토큰은 401(폰은 토큰을 버리고 같은 요청을 기기 id만으로 한 번 다시 보냄)이며, `claim`은 **그 요청의 기기 id 버킷만** 새 자리로 옮긴다(기본 자리 이어받기 없음). **픽스처는 기본 자리에서만** 쓰고 실제 자리·버킷은 일정을 받은 적 없어도 0건이다(데모·폰 E2E 서버만 `FIXTURE_SEATS=1`). 읽기는 `driver=<seatId>`(차 토큰 필요)·폰 토큰·차 토큰(그 차 안의 지난번 고른 자리)·기기 id·식별 없음 순이고, 식별 없는 읽기는 자리를 모르는 현재 차 앱을 위해 **자리 있는 차가 정확히 하나일 때만** 그 차의 지난번 고른 자리를 본다(그 밖에는 기본 자리, `createApp({ legacyDriverFallback })`, 차 앱이 `driver`를 보내면 끈다). 폰 바꾸기는 같은 자리를 이어받아 옛 토큰을 무효로 하고 일정·캘린더 선택을 '받았고 0건'으로 비우며, 폰의 연결 끊기(`DELETE /pair`)는 그 자리 데이터를 지우고, 차의 `DELETE /car`는 그 차의 모든 자리를 지운다. 6자리 코드는 5분이고 틀린 코드를 한 요청 주소(`createApp({ clientAddress })`)가 1분에 5번 넣으면 1분 막는다. 차 토큰은 다시 내주지 않고(잃으면 새 carId), 코드 실패 표가 차면 새 주소를 잠그며 서버 전체 분당 실패 상한·차 생성 속도 제한·일정 저장 용량 상한이 있다. 옛 `/pairing/*`(차 id만, 현재 차 앱이 씀)는 같은 저장소 위의 호환 경로이고, 자리가 있는 차의 코드 발급·초기화는 차 토큰이나 같은 기기(루프백, `createApp({ isLoopback })`)만 된다. 폰이 받는 응답에는 `carId`가 없다. 계약은 `docs/pairing.md`.
- 서버 라우트는 `server/src/routes/`에 파일별로 두고 `app.ts`에서 `.route()`로 체이닝 연결해 RPC 타입 추론을 유지합니다.

## 차량 앱 구현 현황

- 휴대폰 연결: 연결 전에는 탑승해도 브리핑 없이 연결 카드(QR·6자리 번호)만 두고, 폰이 연결하면 일정을 다시 받아 첫 탑승 브리핑을 한다. 익명 차 id와 연결 여부는 차에 저장한다. 서버는 운전자 자리 모델이지만 현재 차 앱은 옛 `/pairing/*`와 자리 지정 없는 읽기만 쓴다(운전자 판단·`driver=`·차 토큰은 아직 없음). 계약은 `docs/pairing.md`.
- 탑승 브리핑, 출발 제안 → 길안내(수락·보류·거절·듣기 8초·늦게 탐도 출발 제안과 같이 묻기·후보 고르기)까지 들어가 있습니다.
- '어디로 갈까요?' 후보: 폰에서 저장한 자주 가는 곳을 `GET /schedules/today`의 `favorites`로 받아 일정 없음·여유 많음 카드에 후보 타일(최대 3줄)로 보이고, 1번 후보가 주 버튼이다. 줄 누름·이름·"첫/두/세 번째"로 고른다. 계약은 `docs/destination-candidates.md`.
- 도착 판단 → 다음 일정: 내비 목적지 도착 알림(차곡이 길안내한 일정) 또는 P단 + 대상 일정 장소 300m 안(위치는 내비에 묻는다)이면 도착으로 바꾸고, 잠깐 정차(10분)가 지나 다시 타면 다음 일정을 한 줄로 묻는다(재탑승). 도착 알림 순간에는 말하지 않고, 하차 카드가 그 말을 맡는다. 계약은 `docs/arrival.md`.
- 주행 중 다음 일정 칩(`NextChip`, main·release 포함): `DriveSession`이 주행(motion=DRIVING)이라고 판단하고 폰과 연결돼 있고 Suspend가 아니며 다음 일정(`DayPlan.target()`: 도착·건너뜀·종일 제외)이 있을 때만 창 왼쪽 위(카드 열 밖, 여백 24)에 "다음 13:00 육전집 점심"을 정적인 글자로 보인다("다음"과 본문은 별도 글자, 간격 12). 정차하면 같은 이벤트에서 바로 숨기고, 도착하면 다음 일정으로 바뀐다. 이벤트 없이 시간만 흘러도 맞도록 칩이 보이는 동안 `Effect.ScheduleChipRecheck`(대상 일정이 끝나는 시각, `SessionHost`가 postDelayed → `Event.ChipRecheck`, 기기·데모 시계가 바뀌면 `Event.ClockChanged`로 다시 예약)로 다시 판단하고, 칩이 바뀌거나 숨겨지면 이전 타이머는 ID가 달라 무시된다. 일정을 받는 중(`ScheduleLoading`~`ScheduleLoaded`, 탑승 판단 중 다시 받기 포함)에는 칩을 바꾸지 않는다(정차·미연결·Suspend 숨김은 예외). 표시 전용이라 누를 수 없고 말·소리·애니메이션이 없다(주행 규제). 상태는 `Effect.ShowNextChip` → `UiState.nextChip`, 문구는 `Phrases.nextChipBody`다. 도착 예정은 시안 칩에 없고 내비 몫이라 넣지 않았다. 계약은 `docs/next-chip.md`.
- 하차 카드(일정 장소 하차): 도착이 기록된 뒤 **실제로 달린 다음 넣은 P단**에서 "도착 · 내리기 전" 카드를 한 번 말하고 `Rules.EXIT_CARD` 5초 뒤 닫는다. 내비 도착은 그 뒤 15분(`Rules.EXIT_PENDING_MAX`, 가안) 안의 P단에서, 이미 P단(달린 뒤, 넣은 지 15분 안)에서 온 내비 도착과 P단 위치(300m) 도착은 기록되는 그 시점에 바로 띄운다. 앱 시작 P단(UNKNOWN→P)이나 달리지 않고 넣은 P단은 카드 없이 대기를 버린다. 읽을 글은 일정의 앱 채비가 있으면 그것, 없으면 메모이고(`MemoNote.forExit`), 목록·한 단어면 "유니폼·응원봉·티켓 챙기세요!"(채비 타일·한 줄·[챙겼어요]), 문장형이면 "{일정} 메모에 ‘…’가 있어요."(앱 채비면 "채비에"), 길거나 여러 줄이면 "{일정} 메모가 있어요.", 없으면 "잘 다녀오세요."(버튼 없음)다(`Phrases.exitCard`). 대기는 `DriveSession.exitTargetId`+`exitArrivedAt`(Snapshot 저장)이고 15분 만료·새 길안내 수락·초기화·날짜 변경·시동 끔·연결 해제·진짜 탑승 판단 때 지운다. 카드가 떠 있을 때 탑승 신호는 잠깐 정차(P 뒤 10분 안)면 그대로 두고 아니면 접은 뒤 탑승을 판단하며, 다른 카드가 떠 있거나 연결 전이면 띄우지 않는다. debug 신호 `exitcard=<초>`는 E2E용으로 카드 시간만 늘린다(`real`로 복귀, release 없음). 집 하차는 다음 기능이다. 계약은 `docs/exit-card.md`.
- 아직 없음(다음 기능): 집 하차(위치 기반 집 도착 카드), 장소 키워드 검색.
- debug 전용 가짜 길안내(`car/app/src/debug/.../fakenavi/`, 계약 `docs/fake-navi.md`): 신호 `navi=fake|real`(기본 real)과 `drive=<초>`(가짜 경로 전체를 지나가는 실제 시간, 소수 가능, 기본 4.5초, 새로 시작하는 경로부터 적용), `progress=<0~1>`(진행률을 바로 옮김, 정차 중에도 동작), `advance=<분>`(데모 시계 앞으로, 1~10080분 밖이면 신호 전체 거부)과 디버그 줄 [가짜 내비]로 켠다(`exitcard=<초>`는 기존대로 하차 카드 시간만 늘린다). 화면은 시안(Drive·Main)대로다: 창 전체를 채우는 곡선 도로 지도에 흰 경로선(한 도로를 따라가다 교차점에서 갈아탐, 목적지 좌표로 고른 변형이라 같은 목적지면 같음), 원형 차 마커는 지도 View 정중앙에 고정이고 차가 움직이는 대신 지도가 움직이며(진행 방향이 위인 heading-up, 커브에서 지도가 최단 방향 지수 감쇠로 부드럽게 돔, 2배 확대), 경로 끝에는 목적지 핀이 서 있고, 카드가 뜨면 지도 위에 검정 50% 덮개를 깔고(하차 카드 "도착 · 내리기 전"일 때만 72%, `FakeNaviScrim`이 상태 칩 문구로 가름) 카드 열이 왼쪽 위(여백 24)로 간다(가짜 내비를 껐거나 release면 가로 가운데 그대로, 세로 창에서는 차이 없음). 길안내 패널은 왼쪽 아래에 "목적지 · {장소}", 큰 도착 시각, `"도착 · 3.1km 남음"`(km 앞 공백 없음, 10km 미만은 소수 한 자리)이고 도착하면 "{장소} 도착"이다(회전 안내는 없음, 카드가 뜨면 숨김). 시안 px는 앱의 디자인 px와 같은 단위라 `DesignScale`로 그대로 키운다. 가짜 내비를 켜면 `InjectedNavigator`(`DebugHooks`)가 소요 시간·길안내를 가짜 경로로 답하고(`trip`·`route` 주입값이 우선), 경로가 목적지에 닿으면(`FakeNaviSession.judgeArrival` 한 곳) `Event.DestinationArrived`를 세션에 넣어 도착 판단·주행 중 칩이 실제 내비와 같은 길로 이어진다. 달리는 동안 차 위치를 `Event.LocationChanged`로 넣고, P단 도착 판단의 위치 질문(`Effect.RequestLocation`)에는 가짜 경로가 있으면 그 위치로 답한다. 차는 주행 중이고 화면이 떠 있을 때만 가고 정차·`onPause`에서는 멈추며, 세션이 내비 어댑터를 멈추는 Suspend 동안도 멈춘다(위치·도착 이벤트 없음). `route=fail`은 이전 가짜 경로도 지우고, `loc`을 주입한 동안(`loc=real`로 해제)은 가짜 경로 위치 대신 주입 위치가 쓰인다. release에는 `FakeNavi`(카드 열 정렬을 늘 가운데로 돌려주는 스텁)·`FlowLog`·`DebugHooks`·`DebugRow` 스텁만 있다. 하차 카드(덮개 72%)와 위치·집 하차는 아직 없다.
- 흐름 로그: debug 빌드는 세션 이벤트·Effect를 `ChagokFlow` 태그로 한 줄씩 남긴다(`FlowLog`, 위치·연결 번호·들은 말 원문(`Heard`는 길이만)은 남기지 않고 카드 문구·일정 제목은 남음, release는 빈 스텁). 가짜 내비의 도착은 `ChagokFakeNavi` 태그로도 남는다.
- debug 빌드의 `chagok-debug://signal`로 휴대폰 연결(`paired`, 기존 flow는 `paired=true`로 시작)·소요 시간(`trip`)·경로 요청 결과(`route`)·들은 말(`heard`)·현재 위치(`loc`)·내비 도착(`arrived`)을 주입해 실제 내비·음성 인식 없이도 E2E가 돕니다. 실제 내비와 음성 인식은 `docs/sdk-check.md`의 수동 확인 목록입니다.

## Pleos 설계 가이드 점검

차량 앱(`car/`) 코드는 [Pleos Connect 앱 설계 가이드](https://document.pleos.ai/docs/pleos-only/vehicle-app-planning-guide/intro)와 [앱 개발 가이드](https://document.pleos.ai/docs/pleos-only/vehicle-app-developer-guide/intro)를 따라야 합니다. 준수 여부는 `pleos-guide-checker` 에이전트로 점검합니다.

- 정의: `.claude/agents/pleos-guide-checker.md`. 읽기 전용이라 코드를 고치지 않고 보고만 합니다.
- 부르는 법: 이 폴더에서 연 세션에서 `@agent-pleos-guide-checker <요청>`을 입력합니다. 범위를 주지 않으면 커밋하지 않은 변경분을 보고, 변경분이 없으면 차량 앱 모듈 전체를 봅니다.
- 다른 폴더의 세션에서 부를 때: `cd <저장소 경로> && claude -p "@agent-pleos-guide-checker 차량 앱 가이드 점검해줘"`처럼 별도 실행으로 부릅니다. 결과만 받고 이어서 대화할 수는 없습니다.
- 언제 부르나: 차량 앱 기능 하나를 끝냈을 때, 또는 화면·매니페스트·오디오·주행 규제·SDK 연동 코드를 바꿨을 때 부릅니다. 자동 실행 훅은 두지 않았습니다.
- 기준 원문: 2026-10-29 시점 원문은 각자 `.claude/pleos-guide-snapshot/`에 로컬로만 둡니다. Pleos 문서 원문이라 공개 저장소에 올리지 않습니다(`.gitignore`). 없으면 에이전트가 가이드 페이지를 WebFetch로 읽습니다. 가이드가 바뀌면 에이전트가 "가이드 변경 감지"로 알려 주는데, 이때 체크리스트(와 로컬 스냅샷)를 갱신합니다.

### 가이드에서 해석이 갈리는 지점

- 주행 중 사용 가능 선언(DO)을 매니페스트에 쓰는 방법은 Pleos 문서에 없습니다. 그래서 AAOS 방식(`distractionOptimized` meta-data)을 기준으로 점검합니다. 실제로 동작하는지는 에뮬레이터에서 확인해야 합니다.
- 지역별 주행 제한을 적용하는 주체를 두고 두 문서가 다르게 말합니다.
  - FAQ: 앱이 `product.sw.target_region`으로 지역별 UX 정책을 직접 적용해야 한다.
  - 주행 규제 개발 가이드: 플랫폼이 지역에 맞는 `ActiveRestrictions`를 내려주므로 앱은 그것만 반영하면 된다.
  - 그래서 지역 코드로 분기하는 코드는 위반으로 보지 않고 "확인 필요"로 다룹니다.

## 테스트와 E2E

- 서버: `pnpm server:test`, 전체 타입체크: `pnpm typecheck`
- 차량 앱 단위: `cd car && ./gradlew :app:testDebugUnitTest`
- 차량 앱 계측 E2E(에뮬레이터 필요, 서버 불필요): `cd car && ANDROID_SERIAL=emulator-5554 ./gradlew :app:connectedDebugAndroidTest`
- 차량 앱 Maestro E2E: `pnpm e2e:car` (debug 앱 설치, 서버 기동·종료까지 스크립트 `scripts/e2e-car.sh`가 한다. 서버는 watch 없이 `tsx src/index.ts`로 띄우고 프로세스 그룹째 종료한다). `E2E_FRESH_INSTALL=1 pnpm e2e:car`는 앱을 지우고 설치한 상태로 돈다. Maestro가 PATH에 없으면 `~/.maestro/bin/maestro`를 쓴다
- Maestro가 통과해도 원하는 화면이 떴는지는 이번 실행 폴더의 `e2e/output/car/<실행 시각>/shots/*.png`를 열어 눈으로 확인한다. 실행마다 폴더가 새로 생기므로 과거 실행분과 섞이지 않는다
- 신호 주입(`chagok-debug://signal?...`, `SignalInjectActivity`)과 평문 HTTP 허용(network security config)은 `car/app/src/debug`에만 둔다. release 빌드에 들어가면 안 된다. 신호 주입 Activity는 호출자가 `android.permission.DUMP`를 가져야 해서 adb shell(Maestro `openLink` 포함)만 부를 수 있다
- 가로·세로 창 확인: `adb shell am task resize <taskId> <left> <top> <right> <bottom>`으로 앱 창 크기를 바꾼다(taskId는 `adb shell dumpsys activity activities`의 `Task{… #<id> … com.chagok.car`). Pleos 에뮬레이터의 한 칸 창은 너비 약 848(portrait), 두 칸 창은 약 1682(landscape)다
- Maestro에서 `clearState`는 쓰지 않는다. 이 에뮬레이터는 앱이 사용자 10에서 돌아 데이터가 지워지지 않는다. 상태 초기화는 `chagok-debug://signal?now=...`(데모 초기화)로 한다
- 터미널 시나리오: `pnpm demo:car`(`scripts/demo-car.sh`)가 가짜 내비로 출발 제안 → 길안내 → 주행 → 도착 → 재탑승 한 줄 → 위치로 도착을 단계마다 신호로 넣고 `ChagokFlow` 로그를 기대 패턴과 비교해 ✓/✗를 낸다. 로그 문구(`FlowLog.kt`)를 바꾸면 스크립트의 기대 패턴도 고친다. 시작 때 `paired=true`로 두므로 PT 전에는 `pnpm demo:pt reset`을 한다. Maestro `fake-navi.yaml`(`pnpm e2e:car`의 마지막 flow)은 `navi=fake`로 수락 → 패널 → `progress=0.5` → 주행 도착 → 칩 → 정차를 확인한다
- PT 시연(12/3): `pnpm demo:pt server|reset|check|fallback`(`scripts/pt-demo.sh`). PT 일정은 `fixtures/schedules/pt-day.json`이고 픽스처의 `anchor`(고정 기준 시각, 12/3 08:50)로 폰과 차가 같은 시각을 본다. 진행표·대비책은 `docs/pt-demo.md`
- Maestro `assertVisible` 글자는 정규식 전체 일치다. 줄바꿈이 낀 문장은 `.*...*`로 받고, 시각·시간 사이 공백은 NBSP라 `.`로 받는다
