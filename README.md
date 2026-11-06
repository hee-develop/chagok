# 차곡

일정은 폰에서 읽고, 판단은 차에서 한다. Pleos Connect 차량 앱 + 폰 앱(RN) + 서버로 이루어져 있습니다.

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
- `PUT /calendars/selection`은 `{ selectedIds, revision }`을 받아 저장하고(`GET`으로 조회), `GET /schedules/today`는 저장된 선택(없으면 `defaultSelected`) 캘린더의 일정만 내려줍니다. 일정의 `calendarId`는 `fixtures/schedules/gwangju-day.json`에 있습니다.
- `revision`은 폰이 보내는 단조 증가 정수이고, 서버는 저장된 값보다 작은 요청을 저장하지 않고 현재 저장값을 200으로 돌려줍니다. 저장 중 '나중에 할게요'로 취소한 요청도 서버에는 이미 반영됐을 수 있습니다.

## 폰 앱

검증(단위 테스트 외 E2E·스크린샷)은 Android 기준입니다. iOS는 검증하지 않습니다.

```bash
pnpm phone:start       # Expo Go 앱으로 QR 스캔
pnpm phone:test        # jest-expo + @testing-library/react-native 단위 테스트
pnpm typecheck         # 서버와 폰 앱 타입체크
pnpm e2e:phone         # Android E2E (아래)
```

서버 주소는 `EXPO_PUBLIC_API_URL`로 바꿀 수 있고, 없으면 `http://localhost:8787`을 씁니다. Android 에뮬레이터에서는 호스트가 `10.0.2.2`입니다.

라우트는 `phone/src/app/`(Expo Router)에 있고, 첫 설정 1단계는 `src/features/calendar-select/`입니다. 캘린더 데이터는 `CalendarSource` 인터페이스의 목 구현이며, 고른 결과는 서버에 저장하고 화면을 다시 열면 서버에서 복원합니다. 폰 앱은 Android·iOS 네이티브만 대상으로 하며 웹 타깃은 없습니다(`.pnpmfile.cjs`가 `react-dom` peer를 제거합니다).

### E2E (Android)

`pnpm e2e:phone`은 AVD `Pixel_10_Pro_XL`을 `-port 5556`(`emulator-5556`)으로 띄우고(이미 떠 있으면 그대로 사용), Expo Go를 설치한 뒤 서버(기본 8788)와 Metro(기본 8082)를 띄워 `e2e/maestro/phone/calendar-select.yaml`을 실행합니다. 끝나면 서버·Metro와 스크립트가 띄운 에뮬레이터를 정리합니다. `emulator-5554`(Pleos 차량 에뮬레이터)는 건드리지 않습니다.

- 스크린샷: `.e2e-shots/phone/` (`E2E_SHOT_DIR`로 변경. 저장소 루트 아래만 허용)
- flow는 KIA 선택 저장 전후로 `GET /schedules/today`에 `KIA vs 두산`이 없다가 생기는지도 확인합니다
- Maestro는 `~/.maestro/bin/maestro`를 씁니다(`MAESTRO`로 변경)
- 포트·AVD 등은 `scripts/e2e-phone.sh` 상단 주석 참고

## 차량 앱

사전 준비 (이 맥에는 2026-10-29에 설치 완료)

- Pleos Connect Emulator v2.1.0 이미지: `system-images;android-34;pleos_car_emulator;arm64-v8a`
- AVD `Pleos_Connect_v2_1` (Cold boot, RAM 4GB)
- 회사망(Zscaler)에서는 `nexus-playground.pleos.ai` 인증서를 JDK가 신뢰하지 못한다.
  `~/.gradle/gradle.properties`에 Zscaler 루트를 더한 truststore를 지정해 두었다.

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

- `pnpm e2e:car`는 debug 앱 설치 → 서버(watch 없이 `tsx src/index.ts`, 8787) 시작 → `e2e/maestro/car/boarding-briefing.yaml`, `depart-route.yaml` 순서로 실행 → 서버 종료(프로세스 그룹째)를 한다. 에뮬레이터 시간대를 서울로 잠시 바꿨다가 되돌린다(원래 값이 비어 있었으면 UTC로 두고 비운다). 스크린샷은 실행마다 새로 만드는 `e2e/output/car/<실행 시각>/shots/`(git 제외)에 남는다. `E2E_FRESH_INSTALL=1`을 주면 앱을 지우고 설치한 상태로 돈다. 기기가 여럿이면 `ANDROID_SERIAL`을 지정한다.
- 일정 데이터는 `fixtures/schedules/gwangju-day.json`(프로토타입 '광주 직관 하루')이고, 기본값은 저장소 루트의 `fixtures/` 아래 이 파일이다. `FIXTURE_PATH`로 바꿀 수 있고, 절대 경로는 그대로, 상대 경로는 작업 폴더가 아니라 **저장소 루트 기준**으로 읽는다(예: `FIXTURE_PATH=fixtures/schedules/gwangju-day.json`). 형식이 틀리면(place의 lat·lng 숫자, memo·locationText 문자열 또는 null, attendees 문자열 배열) 서버가 시작할 때 오류로 멈춘다. 서버가 시작할 때 읽어 `GET /schedules/today?at=<ISO8601>`로 내려준다. 차량 앱 단위·계측 테스트도 같은 파일을 읽는다.
- debug 빌드에만 신호 주입 통로가 있다. `adb shell am start -a android.intent.action.VIEW -d "chagok-debug://signal?gear=D"`처럼 `now`(ISO8601, 데모 시계·초기화), `gear`(P·R·N·D), `ignition`, `restricted`, `enter`, `board`를 줄 수 있다. 출발 제안 → 길안내용으로 `trip`(소요 시간 초, `none`=모름, `real`=실제 내비), `route`(`ok`·`fail`·`real`: 길안내 요청 결과), `listen`(`off`면 실제 STT를 열지 않음), `heard`(들은 말, 퍼센트 인코딩)도 준다. 이 값들은 debug 빌드에만 있고 release에는 없다. 실제 내비 경로 시작과 음성 인식은 회사망 밖에서 사람이 확인한다(`docs/sdk-check.md`). debug 빌드만 평문 HTTP로 `10.0.2.2:8787`(PC의 서버)에 붙는다.
