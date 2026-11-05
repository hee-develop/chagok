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
