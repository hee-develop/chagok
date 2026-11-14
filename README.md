# 차곡

일정은 폰에서 읽고, 판단은 차에서 한다. Pleos Connect 차량 앱 + 폰 앱(RN) + 서버로 이루어져 있습니다.

## 지금 되는 것 (2026-11-14, 에뮬레이터 기준)

- **폰 첫 설정**: 캘린더 고르기(실제 Android 캘린더) → 자주 가는 곳 → 일정별 장소 보정 · 채비 한 줄 · 가족에게 보내기('전달됨') → 차 화면 QR이나 6자리 번호로 차와 연결
- **차 탑승 브리핑**: 오늘 일정과 채비를 읽고 "출발할까요?"를 묻고, "응"이면 내비 길안내를 시작한다. 늦었으면 같이 묻고, 일정이 없거나 여유가 많으면 자주 가는 곳을 후보로 보인다
- **도착 → 다음 일정**: 내비 도착 알림이나 P단 + 일정 장소 300m 안이면 도착으로 보고, 다시 타면 다음 일정을 한 줄로 묻는다
- **주행 중**: 말하지 않고 다음 일정 칩 한 줄만 보인다
- **아직 안 됨**: 실제 내비 · 음성 인식 실측(지금은 debug 신호 주입으로 확인), 서버 배포(HTTPS) · DB 저장, 장소 검색 API(카카오 로컬), 하차 카드, 가족 요청 받는 쪽

| 폴더 | 내용 | 스택 |
| --- | --- | --- |
| `car/` | 차량 앱 (`com.chagok.car`) | Kotlin, Pleos Connect SDK, AAOS Car API. 독립 Gradle 프로젝트 |
| `phone/` | 폰 앱 (`@chagok/phone`) | Expo SDK 58, React Native 0.88 |
| `server/` | 서버 (`@chagok/server`) | TypeScript, Hono, Node 런타임 |
| `docs/sdk-check.md` | 기획서 기능별 SDK 구현 가능 여부와 에뮬레이터 실측 결과 | |

JS 쪽(`phone/`, `server/`)은 pnpm 워크스페이스입니다. 폰 앱은 서버의 라우트 타입을 Hono RPC 클라이언트(`phone/src/api/client.ts`)로 가져다 씁니다.

## 처음 설치

Node 22.13 이상이 필요합니다. pnpm은 Node에 들어 있는 corepack으로 씁니다.

```bash
corepack enable pnpm   # 한 번만. 버전은 package.json의 packageManager를 따른다
pnpm install           # 루트에서 실행
```

## 서버

```bash
pnpm server:dev        # http://127.0.0.1:8787 , GET /health → {"ok":true}
pnpm server:test
pnpm typecheck         # 서버와 폰 앱 타입체크
```

서버는 기본으로 `127.0.0.1`에만 바인딩합니다. 같은 네트워크의 다른 기기에서 접근해야 할 때만 `HOST=0.0.0.0`으로 엽니다. Android 에뮬레이터의 `10.0.2.2`는 호스트 루프백으로 연결되므로 기본값으로 접근됩니다.

- 목 캘린더 6개는 `fixtures/calendars/mock-device.json` 한 파일이 단일 출처이고, 폰 앱과 서버가 같은 파일을 읽습니다.
- `PUT /calendars/selection`은 `{ selectedIds, revision }`을 받아 저장하고(`GET`으로 조회), `GET /schedules/today`는 저장된 선택(없으면 `defaultSelected`) 캘린더의 일정 중 `at`(없으면 현재)의 Asia/Seoul 날짜 일정만 내려줍니다(전날 시작해 아직 안 끝난 일정 포함). 일정의 `calendarId`는 `fixtures/schedules/gwangju-day.json`에 있습니다.
- 장소는 `fixtures/places/mock-places.json`(검색 대상)과 `suggestions.json`('캘린더에서 자주 나온 곳' 고정 추천)이 단일 출처입니다. `GET /places/search?q=`(이름·주소 부분 일치, 최대 10개, q 50자 상한, 빈 q는 400), `GET /places/suggestions`, `GET /places/favorites`(`{ home, work, others, revision }`), `PUT /places/favorites/home`·`/work`(`{ placeId|null }`), `POST /places/favorites/others`(`{ placeId }`)를 둡니다. 쓰기 요청은 자리 하나만 바꾸고 전체 상태를 돌려주며, 같은 장소가 다른 자리에 있으면 서버가 옮깁니다. others 최대 20, 이미 추가한 장소·모르는 id는 400이고 `revision`은 서버가 올립니다. 차량 앱은 `GET /schedules/today`의 `favorites`(집 → 회사 → 추가한 순서)로 받아 '어디로 갈까요?' 후보로 씁니다([목적지 후보 문서](docs/destination-candidates.md)).
- `PUT /events`(폰이 오늘·내일 일정 전체를 교체. 본문 1MB·일정 200개·필드 길이 상한, 시각은 오프셋 있는 ISO8601, 오늘·내일(서울) 밖 일정은 거름)와 `GET /events?date=YYYY-MM-DD`(저장값 확인)를 둡니다. `DELETE /events`(같은 기기 요청만, 개발·데모용)는 폰 일정을 비워 픽스처 출처로 되돌립니다. 폰이 한 번이라도 일정을 보냈으면 `/schedules/today`·`/schedules/places`는 그 일정(선택 캘린더 필터·서울 날짜 규칙·3단계 보정 적용)을 쓰고, 한 번도 안 보냈으면 지금처럼 픽스처를 씁니다(데모·차량 E2E 경로). 선택은 `source`(`mock`|`device`)를 함께 저장하며 일정 출처와 같을 때만 적용합니다. 폰 일정의 장소는 목 장소 이름과 정규화해 완전히 같을 때만 좌표를 확정하고, 일부만 겹치거나 지난번 기억(제목)과 맞으면 `suggestion`(확인 필요)으로만 내립니다. 날짜가 지난 일정은 읽을 때·교체할 때 지웁니다. **주의**: 폰 앱을 8787 서버에 붙이면 데모·차량 E2E가 폰 일정을 받으니 `GET /events`의 `receivedAt`이 null인지 확인하고(값이 있으면 `curl -X DELETE http://127.0.0.1:8787/events`), `HOST=0.0.0.0`으로 열 때는 `EVENTS_LOOPBACK_ONLY=1`을 함께 주세요. 계약은 [폰 캘린더 연결 문서](docs/calendar-sync.md)를 따릅니다.
- `revision`은 폰이 보내는 단조 증가 정수이고, 서버는 저장된 값보다 작은 요청을 저장하지 않고 현재 저장값을 200으로 돌려줍니다. 저장 중 '나중에 할게요'로 취소한 요청도 서버에는 이미 반영됐을 수 있습니다.

## 폰 앱

검증(단위 테스트 외 E2E·스크린샷)은 Android 기준입니다. iOS는 검증하지 않습니다.

```bash
pnpm phone:start       # Expo Go 앱으로 QR 스캔
pnpm phone:test        # jest-expo + @testing-library/react-native 단위 테스트
pnpm --filter @chagok/phone lint --max-warnings 0 # Expo ESLint
pnpm typecheck         # 서버와 폰 앱 타입체크
pnpm e2e:phone         # Android E2E (아래)
```

서버 주소는 `EXPO_PUBLIC_API_URL`로 바꿀 수 있고, 없으면 `http://localhost:8787`을 씁니다. Android 에뮬레이터에서는 `adb reverse tcp:8787 tcp:8787`로 기기의 `127.0.0.1:8787`을 호스트에 이은 뒤 `EXPO_PUBLIC_API_URL=http://127.0.0.1:8787`을 씁니다(Expo Go가 `10.0.2.2`에 붙지 못하는 경우가 있었습니다).

라우트는 `phone/src/app/`(Expo Router)에 있고, 첫 설정 1단계는 `src/features/calendar-select/`, 2단계 '자주 가는 곳'(`setup/places`, 장소 검색 `setup/place-search`)은 `src/features/places/`입니다. 3단계(`setup/fill-places`, `src/features/fill-places/`)는 선택한 캘린더의 일반 일정을 보여 주고 장소 검색·저장과 이동 없음을 지원합니다. 원본 캘린더 대신 서버에 일정별 보정값을 저장하며 차량용 일정 응답에도 반영됩니다. 4단계(`setup/talk`)는 제목만 있는 연결 화면입니다. 자세한 계약과 범위는 [장소 채우기 문서](docs/fill-places.md)를 참고해 주세요. 요청 10초 제한(`requestWithTimeout`)은 `src/api/request.ts`를 두 기능이 같이 쓰고, revision 시계는 캘린더만 씁니다(2단계의 revision은 서버가 매깁니다). 캘린더는 `CalendarSource` 인터페이스 뒤에 두고, `EXPO_PUBLIC_CALENDAR_SOURCE=mock|device`로 고릅니다(기본 device = 실제 Android 캘린더를 `expo-calendar`로 읽음, 권한을 거부하면 목으로 넘어가지 않고 허용 안내만 보임. mock은 테스트·E2E용). 폰 앱은 Android·iOS 네이티브만 대상으로 하며 웹 타깃은 없습니다(`.pnpmfile.cjs`가 `react-dom` peer를 제거합니다).

### E2E (Android)

`pnpm e2e:phone`은 AVD `Pixel_10_Pro_XL`을 `-port 5556`(`emulator-5556`)으로 띄우고(이미 떠 있으면 그대로 사용), Expo Go를 설치한 뒤 서버(기본 8788)와 Metro(기본 8082)를 띄웁니다. 기기의 `127.0.0.1`에 두 포트를 `adb reverse`로 잇고 앱은 `exp://127.0.0.1:<Metro>`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:<서버>`로 접속합니다. `pnpm e2e:phone`은 Metro를 `EXPO_PUBLIC_CALENDAR_SOURCE=mock`으로 띄웁니다. 이어서 `e2e/maestro/phone/calendar-select.yaml`, `places.yaml`(2단계 직접 진입), `fill-places.yaml`(3단계 직접 진입)을 차례로 실행합니다. 서버는 기본 일정 `fixtures/schedules/gwangju-day.json`(장소가 빈 일반 일정 '친구 약속'·'치과')을 읽으며, `E2E_FIXTURE_PATH`로 바꿀 수 있습니다. `E2E_FLOWS=fill-places`처럼 실행 범위를 선택할 수 있습니다. 끝나면 서버·Metro·이 스크립트가 만든 reverse 규칙·스크립트가 띄운 에뮬레이터를 정리합니다. 다른 작업이 쓰는 에뮬레이터·포트와 겹치지 않게 `E2E_AVD`, `E2E_ANDROID_PORT`, `E2E_METRO_PORT`, `E2E_SERVER_PORT`로 바꿔 돌릴 수 있습니다(reverse 규칙이 이미 있는 포트는 쓰지 않고 멈춥니다). `emulator-5554`(Pleos 차량 에뮬레이터)는 건드리지 않습니다.

- 스크린샷: `.e2e-shots/phone/<flow 이름>/` (`E2E_SHOT_DIR`로 변경. 저장소 루트 아래만 허용)
- flow는 KIA 선택 저장 전후로 `GET /schedules/today`에 `KIA vs 두산`이 없다가 생기는지도 확인합니다
- fill-places flow는 이동 없음, 지난번 장소 '여기 맞아요', 장소 검색·변경, 차량 응답의 좌표·일정 제외, 4단계 이동과 복귀 후 복원을 검증합니다. Gboard 필기 입력은 테스트 중만 끄고 종료 시 원래 설정으로 돌립니다.
- places flow는 서버의 `GET /places/favorites`로 집·추가 장소 저장도 확인합니다. Maestro `assertVisible`·`tapOn` 글자는 정규식 전체 일치라 `[ ] ( ) +`는 `\`로 막습니다
- 실제 기기 캘린더 flow는 기본 목록에 없고 `E2E_FLOWS=device-calendar pnpm e2e:phone`으로 따로 돌립니다(항상 마지막에 실행). `scripts/seed-phone-calendar.sh`로 에뮬레이터에 로컬 캘린더·일정을 심고 Metro를 device 출처로 다시 띄우며, 끝나면 심은 캘린더를 지웁니다.
- Maestro는 `~/.maestro/bin/maestro`를 씁니다(`MAESTRO`로 변경)
- 포트·AVD 등은 `scripts/e2e-phone.sh` 상단 주석 참고

## 차량 앱

사전 준비

- Pleos Connect Emulator v2.1.0 이미지: `system-images;android-34;pleos_car_emulator;arm64-v8a`
- AVD `Pleos_Connect_v2_1` (Cold boot, RAM 4GB)

```bash
# 1. 에뮬레이터 실행 (또는 Android Studio Device Manager)
~/Library/Android/sdk/emulator/emulator -avd Pleos_Connect_v2_1 -no-snapshot-save

# 2. 빌드·설치·실행 (폰이 adb에 같이 붙어 있으면 ANDROID_SERIAL로 에뮬레이터 지정)
cd car
ANDROID_SERIAL=emulator-5554 ./gradlew :app:installDebug
adb -s emulator-5554 shell am start -n com.chagok.car/.MainActivity

# 단위 테스트
./gradlew :app:testDebugUnitTest
```

Android Studio에서는 `car/` 폴더를 열고 Run 하면 된다.

## 테스트

| 종류 | 명령 | 필요한 것 |
| --- | --- | --- |
| 서버 단위 | `pnpm server:test` | |
| 타입체크 | `pnpm typecheck` | |
| 차량 앱 단위(JVM) | `pnpm car:test` 또는 `cd car && ./gradlew :app:testDebugUnitTest` | |
| 차량 앱 계측 E2E | `cd car && ANDROID_SERIAL=emulator-5554 ./gradlew :app:connectedDebugAndroidTest` | 에뮬레이터. 가짜 신호·가짜 STT·가짜 내비·고정 시계(09:20)·픽스처 일정을 쓰므로 서버는 필요 없다 |
| 차량 앱 Maestro E2E | `pnpm e2e:car` | 에뮬레이터, [Maestro](https://get.maestro.mobile.dev) |

- `pnpm e2e:car`는 debug 앱 설치 → 서버(watch 없이 `tsx src/index.ts`, 8787) 시작 → `e2e/maestro/car/boarding-briefing.yaml`, `depart-route.yaml` 순서로 실행 → 서버 종료(프로세스 그룹째)를 한다. 에뮬레이터 시간대를 서울로 잠시 바꿨다가 되돌린다(원래 값이 비어 있었으면 UTC로 두고 비운다). 스크린샷은 실행마다 새로 만드는 `e2e/output/car/<실행 시각>/shots/`(git 제외)에 남는다. `E2E_FRESH_INSTALL=1`을 주면 앱을 지우고 설치한 상태로 돈다. 기기가 여럿이면 `ANDROID_SERIAL`을 지정한다. 8787이 이미 쓰이고 있으면 `PORT=8790 pnpm e2e:car`처럼 포트를 바꾼다(서버와 debug 앱 모두 그 포트로 맞춘다). 이렇게 돌린 뒤에는 설치된 debug 앱이 그 포트를 기억하므로, 기본 서버(8787)로 직접 확인하기 전에 `./gradlew :app:installDebug`로 다시 설치한다. Gradle로 직접 설치할 때도 `ANDROID_SERIAL`을 꼭 지정한다(없으면 연결된 모든 기기에 설치된다).
- 일정 데이터는 `fixtures/schedules/gwangju-day.json`(프로토타입 '광주 직관 하루')이고, 기본값은 저장소 루트의 `fixtures/` 아래 이 파일이다. `FIXTURE_PATH`로 바꿀 수 있고, 절대 경로는 그대로, 상대 경로는 작업 폴더가 아니라 **저장소 루트 기준**으로 읽는다(예: `FIXTURE_PATH=fixtures/schedules/gwangju-day.json`). 형식이 틀리면(place의 lat·lng 숫자, memo·locationText 문자열 또는 null, attendees 문자열 배열) 서버가 시작할 때 오류로 멈춘다. 서버가 시작할 때 읽어 `GET /schedules/today?at=<ISO8601>`로 내려준다. 차량 앱 단위·계측 테스트도 같은 파일을 읽는다.
- debug 빌드에만 신호 주입 통로가 있다. `adb shell am start -a android.intent.action.VIEW -d "chagok-debug://signal?gear=D"`처럼 `now`(ISO8601, 데모 시계·초기화), `gear`(P·R·N·D), `ignition`, `restricted`, `enter`, `board`를 줄 수 있다. 출발 제안 → 길안내용으로 `trip`(소요 시간 초, `none`=모름, `real`=실제 내비), `route`(`ok`·`fail`·`real`: 길안내 요청 결과), `listen`(`off`면 실제 STT를 열지 않음), `heard`(들은 말, 퍼센트 인코딩)도 준다. 이 값들은 debug 빌드에만 있고 release에는 없다. 실제 내비 경로 시작과 음성 인식은 사람이 따로 확인한다(`docs/sdk-check.md`). debug 빌드만 평문 HTTP로 `10.0.2.2:8787`(PC의 서버)에 붙는다.
