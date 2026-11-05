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
pnpm server:dev        # http://localhost:8787 , GET /health → {"ok":true}
pnpm server:test
pnpm typecheck         # 서버와 폰 앱 타입체크
```

## 폰 앱

```bash
pnpm phone:start       # Expo Go 앱으로 QR 스캔
```

서버 주소는 `EXPO_PUBLIC_API_URL`로 바꿀 수 있고, 없으면 `http://localhost:8787`을 씁니다.

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
| 차량 앱 계측 E2E | `cd car && ANDROID_SERIAL=emulator-5554 ./gradlew :app:connectedDebugAndroidTest` | 에뮬레이터. 가짜 신호·고정 시계(09:20)·픽스처 일정을 쓰므로 서버는 필요 없다 |
| 차량 앱 Maestro E2E | `pnpm e2e:car` | 에뮬레이터, [Maestro](https://get.maestro.mobile.dev) |

- `pnpm e2e:car`는 debug 앱 설치 → 서버(watch 없이 `tsx src/index.ts`, 8787) 시작 → `e2e/maestro/car/boarding-briefing.yaml` 실행 → 서버 종료(프로세스 그룹째)를 한다. 에뮬레이터 시간대를 서울로 잠시 바꿨다가 되돌린다(원래 값이 비어 있었으면 UTC로 두고 비운다). 스크린샷은 실행마다 새로 만드는 `e2e/output/car/<실행 시각>/shots/`(git 제외)에 남는다. `E2E_FRESH_INSTALL=1`을 주면 앱을 지우고 설치한 상태로 돈다. 기기가 여럿이면 `ANDROID_SERIAL`을 지정한다.
- 일정 데이터는 `fixtures/schedules/gwangju-day.json`(프로토타입 '광주 직관 하루')이고, 기본값은 저장소 루트의 `fixtures/` 아래 이 파일이다. `FIXTURE_PATH`로 바꿀 수 있고, 절대 경로는 그대로, 상대 경로는 작업 폴더가 아니라 **저장소 루트 기준**으로 읽는다(예: `FIXTURE_PATH=fixtures/schedules/gwangju-day.json`). 형식이 틀리면(place의 lat·lng 숫자, memo·locationText 문자열 또는 null, attendees 문자열 배열) 서버가 시작할 때 오류로 멈춘다. 서버가 시작할 때 읽어 `GET /schedules/today?at=<ISO8601>`로 내려준다. 차량 앱 단위·계측 테스트도 같은 파일을 읽는다.
- debug 빌드에만 신호 주입 통로가 있다. `adb shell am start -a android.intent.action.VIEW -d "chagok-debug://signal?gear=D"`처럼 `now`(ISO8601, 데모 시계·초기화), `gear`(P·R·N·D), `ignition`, `restricted`, `enter`, `board`를 줄 수 있다. debug 빌드만 평문 HTTP로 `10.0.2.2:8787`(PC의 서버)에 붙는다.
