# 차–폰 연결(QR · 6자리 번호)

PT 대본의 "폰에서 일정·주소·채비를 넣고 → 마지막에 차 화면 QR을 찍어 연결 → 이어지는 차 탑승 브리핑이 방금 넣은 내용으로 말함"입니다.
회원가입은 없고, 차는 설치 때 만든 익명 차 id 하나로 서버에 연결 코드를 받습니다. 지금 서버는 목 사용자 한 명이라 연결은 "이 차가 연결됐는가"만 가르고, 일정은 그 한 사용자의 것을 그대로 씁니다.

## 흐름

1. 차가 연결 전이면 서버에서 코드(숫자 6자리, 10분)를 받아 **연결 카드**를 띄웁니다. QR에는 `chagok://pair?code=123456`이 담기고 번호는 `123 456`으로 보입니다.
2. 폰 첫 설정 4단계(`/setup/pair-car`)에서 [QR 찍기](카메라)나 번호 입력으로 서버에 코드를 보냅니다.
3. 차는 2초마다 연결됐는지 묻다가 연결되면 저장하고, 카드를 접고, 일정을 다시 받은 뒤 **첫 탑승 브리핑**을 합니다(정차 중일 때. 주행 중이면 다음 탑승).

## 서버 API (`server/src/routes/pairing.ts`)

- `POST /pairing/codes` `{ carId }` → `{ code, expiresAt, qr }`. 그 차의 이전 코드는 버리고, 살아 있는 다른 차의 코드와 겹치지 않게 냅니다.
- `GET /pairing/cars/:carId` → `{ paired, pairedAt, codeActive }`. `codeActive`는 이 차에 살아 있는 코드가 있는가입니다.
- `POST /pairing/claim` `{ code }`(숫자 6자리) → `{ carId, pairedAt }`. 쓴 코드는 버립니다. 없거나 만료된 코드는 404, 모양이 틀리면 400.
- `DELETE /pairing/cars/:carId` → 연결을 풉니다(데모 초기화). 응답은 상태와 같습니다.
- 저장은 메모리입니다. 서버를 다시 켜도 차는 연결된 채로 둡니다(차가 연결 여부를 저장하고 다시 묻지 않음).

## 차 (`car/`)

- `PairingController`(전용 스레드): 연결 카드가 보일 수 있을 때(앱이 앞, 정차, Suspend 아님)만 돕니다. 코드 받기 → 2초마다 연결 확인, 만료 30초 전 새 코드, 서버가 이 차의 코드를 모르면(`codeActive: false`, 서버 재시작) 바로 새 코드. 서버에 닿지 않으면 5·10·20·40·60초로 늘려 다시 합니다. 멈췄다 다시 켜면 받아 둔 코드가 살아 있는지부터 봅니다. 로그에는 차 id·코드를 남기지 않습니다.
- `ChagokStore`: 익명 차 id(UUID, 사람·차량 정보 없음)와 연결 여부.
- `DriveSession`: 연결 전에는 탑승해도 탑승을 소진하지 않고 연결 카드만 둡니다(말하지 않음, 버튼 없음, 시간이 지나도 접지 않음). 주행하면 바로 접고 다시 서면 다시 보입니다. 새 코드가 오면 카드를 바꿉니다.
  - `Event.PairingCodeIssued` → 카드, `Event.Paired(brief = true)` → 카드 접기 + 일정 다시 받기 + 탑승 판단, `Event.Unpaired` → 떠 있던 카드를 접고 연결 전으로.
- 연결 카드: `Phrases.pairingCard`("휴대폰과 연결해 주세요." + "휴대폰 차곡 앱에서 QR을 찍거나 번호를 넣어 주세요."), `TileView.Pairing`(흰 바탕 QR 200dp, ZXing core로 그림 + 번호 `R.id.pairing_code`).

## 폰 (`phone/src/features/pair-car/`)

- `PairCarScreen`: [QR 찍기](expo-camera `CameraView`, QR만) → 차곡 QR이면 바로 연결, 아니면 '차곡 차 화면의 QR이 아니에요'. 카메라를 거부하면 번호를 넣으라고 안내합니다.
- 번호 입력은 숫자만 6자리(`123 456`처럼 넣어도 됨). [연결하기] → 성공하면 '✓ 차와 연결됐어요'와 [완료](3단계 일정 목록으로).
- 404는 '번호가 맞지 않거나 시간이 지났어요…'(새 번호를 넣게 함), 네트워크 실패는 [다시 시도]로 같은 번호를 다시 보냅니다. 요청은 기존 10초 제한(`requestWithTimeout`).

## 데모·E2E

- debug 빌드 `chagok-debug://signal?paired=true|false`(가장 먼저 처리). `true`는 말없이 연결된 것으로 두고, `false`는 서버에서도 풀고 새 코드로 연결 카드를 띄웁니다. 연결 상태는 차에 남습니다.
- 연결 카드가 없는 기존 차량 Maestro flow는 시작 신호에 `paired=true`를 넣습니다. 계측 테스트는 `setUp`에서 `host.setPaired(true)`, 연결 서버는 `FakePairingClient`입니다.
- PT 시연 전 초기화: `paired=false&now=…`로 연결 카드부터 시작합니다.

## 검증

- `pnpm server:test`(`server/test/pairing.test.ts`), 차량 단위 `DriveSessionPairingTest`, 계측 `PairingTest`, Maestro `e2e/maestro/car/pairing.yaml`(화면의 번호를 읽어 `claim-pairing.js`가 서버에 보냄. `SERVER_URL`은 `-e`로만 넣는다 — flow env에 기본값을 두면 runScript가 그 값을 받는다), 폰 Maestro `e2e/maestro/phone/pair-car.yaml`(서버에서 코드를 받아 번호로 넣음), `pnpm phone:test`(`PairCarScreen.test.tsx`, `pairCode.test.ts`)
- 실제 폰 카메라로 차 화면 QR을 찍는 것은 수동 확인입니다(에뮬레이터 카메라는 가상 장면).
