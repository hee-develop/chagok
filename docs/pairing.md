# 차–폰 연결(QR · 6자리 번호)

PT 대본의 "폰에서 일정·주소·채비를 넣고 → 마지막에 차 화면 QR을 찍어 연결 → 이어지는 차 탑승 브리핑이 방금 넣은 내용으로 말함"입니다.
회원가입은 없고 QR 연결이 곧 계정입니다(정책서 10.1·10.9·11장). 한 차에 폰 여러 대를 연결할 수 있고, 폰 한 대가 **운전자 자리** 하나입니다.
일정·캘린더 선택·장소 보정·채비·자주 가는 곳·가족 요청은 자리별로 따로 쌓입니다.

## 자리 모델 (`server/src/seats.ts`, `seatData.ts`, `seatScope.ts`)

- `Car { carId, carToken, lastSelectedSeatId }`: 차 하나. `carToken`은 차만 알고 차 쪽 API에 씁니다. 차가 처음 코드를 받을 때 만들어 한 번 알려 줍니다.
- `Seat { seatId, carId, name, phoneId, phoneToken, pleosProfileId, btDeviceId, pairedAt, lastEventsAt, lastPresenceAt, presence }`: 자리 이름은 폰 기기 이름이고 같은 차에 겹치면 ` 2`를 붙입니다(빈 이름은 '내 폰', 40자 상한). `lastEventsAt`은 마지막으로 일정을 받은 시각, `lastPresenceAt`·`presence`는 폰이 차 블루투스에 붙었다·떨어졌다고 알린 마지막 시각과 상태입니다.
- 지난번 고른 자리: 차가 `PUT /drivers/selected`로 정하고, 고른 적이 없으면 '가장 최근에 연결한 자리'로 내려 줍니다(정책서 10.1 ④).
- 자리 데이터(`SeatData`): 일정(`EventsStore`)·캘린더 선택·자주 가는 곳·가족 요청·일정별 장소 보정과 채비. 앞으로 생길 장소 기억·도착 횟수·이동 없음 기억 저장소도 여기에 붙입니다(자리를 지우면 함께 지워짐).
- 한 차에 폰은 8대(`MAX_SEATS_PER_CAR`), 서버가 아는 차는 200대(`MAX_CARS`)까지입니다. 저장은 메모리이고 서버를 다시 켜면 모두 사라집니다.

### 요청이 어느 자리를 다루는가

폰 토큰·차 토큰은 `Authorization: Bearer <토큰>`으로 보냅니다(서버가 만든 64자 16진수).

| 요청 | 자리 |
| --- | --- |
| 쓰기(`PUT /events`, `PUT /calendars/selection`, `PUT /schedules/:id/place`·`care`, `POST /schedules/:id/family-request`, 자주 가는 곳 `PUT`·`POST`) | 폰 토큰이 있으면 그 자리. **토큰이 없으면 '기본 자리'**(연결 전 폰·옛 클라이언트·픽스처·데모 경로). 모르는 토큰(다른 폰으로 바뀜·끊김·차곡 초기화)이나 이상한 Authorization 형식은 **401**이고 기본 자리로 흘리지 않습니다 |
| 읽기(`GET /events`, `/schedules/today`·`/places`, `/calendars/selection`, `/places/favorites`, `/family/requests`) + `driver=<seatId>` | 그 자리. 그 자리를 가진 차의 토큰(또는 그 자리 폰의 토큰)이 있어야 하고, 토큰이 없으면 401, 남의 자리·없는 자리는 403 |
| 읽기, 폰 토큰만 | 그 자리 |
| 읽기, 자리 지정 없음 | **호환 규칙**: 가장 최근에 연결한 자리(연결된 자리가 없으면 기본 자리). 자리를 모르는 현재 차 앱이 새 폰이 보낸 일정을 계속 받게 하는 규칙이다. 차 앱이 `driver`를 보내게 되면 `createApp({ legacyDriverFallback: false })`로 끄고 기본 자리만 보게 한다 |

- 기본 자리: 연결 전(첫 설정 1~3단계)에 폰이 토큰 없이 보낸 일정·선택·보정·채비·자주 가는 곳이 모입니다. **첫 새 자리가 생기면 이 데이터를 그 자리가 이어받고** 기본 자리는 처음 상태(픽스처 출처)로 돌아갑니다. 그래서 "방금 넣은 내용으로 브리핑"이 유지됩니다. 폰 바꾸기·같은 폰의 재연결은 이어받지 않습니다.
- 일정을 받은 적 없는 자리는 예전처럼 픽스처 일정을 쓰고(데모·차량 E2E 경로, 변경 금지), 한 번이라도 받았으면 그 일정만 씁니다(0건이어도).
- `DELETE /events`(같은 기기만, 개발·데모용): 폰 토큰이 있으면 그 자리만, 없으면 기본 자리와 '자리 지정 없이 읽는 자리'를 비웁니다.

## 흐름

1. 차가 코드(숫자 6자리, **5분**)를 받아 **연결 카드**를 띄웁니다. QR에는 `chagok://pair?code=123456`이 담기고 번호는 `123 456`으로 보입니다. 새 운전자는 `mode: new`, 폰 바꾸기는 `mode: replace`+`seatId`입니다(차 설정 화면은 차 쪽 묶음에서).
2. 폰 첫 설정 4단계(`/setup/pair-car`)에서 [QR 찍기](카메라)나 번호 입력으로 서버에 코드와 **기기 이름**을 보냅니다. 서버는 폰 토큰을 주고, 폰은 `expo-secure-store`에 저장해 이후 모든 요청에 붙입니다.
3. 차는 연결됐는지 묻다가 연결되면 저장하고, 카드를 접고, 일정을 다시 받은 뒤 **첫 탑승 브리핑**을 합니다(정차 중일 때. 주행 중이면 다음 탑승).

## 서버 API (정책서 이름: `server/src/routes/pair.ts`)

차 쪽 API는 `Authorization: Bearer <carToken>`이 필요하고, 폰 쪽은 `Bearer <phoneToken>`입니다. 오류 본문은 `{ error, reason? }`입니다.

### 차

- `POST /pair/code` 본문(모두 생략 가능, 빈 본문 가능): `{ carId?, mode?: "new"|"replace", seatId?, btDeviceId?, pleosProfileId? }`
  - 응답 200: `{ carId, carToken, code, expiresAt, expiresInSeconds, qr, mode, seatId }`. `carToken`은 **차를 처음 만든 응답(또는 토큰을 잃은 미연결 차를 다시 등록한 응답)에만** 실리고 그 밖에는 `null`입니다. `seatId`는 replace일 때 바꿀 자리입니다. 그 차의 이전 코드는 버리고, 살아 있는 다른 차의 코드와 겹치지 않게 냅니다.
  - `btDeviceId`·`pleosProfileId`는 짝짓는 순간 차가 읽은 값이고 연결되는 자리에 묶입니다(replace는 새 폰의 블루투스 기기로 바뀌고 없으면 비움, 프로필은 안 주면 유지).
  - 차 정하기: 토큰이 있으면 그 차(본문 `carId`가 다르면 403). 토큰이 없고 모르는 차면 새로 만듭니다(본문 `carId`를 쓰고 없으면 서버가 정함). 토큰이 없는데 아는 차이면, 자리가 없는 차는 새 토큰으로 이어 쓰게 하고 자리가 있는 차는 401입니다.
  - 오류: 400(본문 모양), 401(차 토큰), 404 `unknown-seat`(이 차에 없는 자리), 409 `seat-limit`, 429 `too-many-cars`.
- `GET /pair/status` → `{ state: "none"|"waiting"|"claimed"|"expired", expiresAt, mode, seatId }`. 마지막으로 낸 코드의 상태이고 `claimed`면 `seatId`가 연결된 자리입니다. 서버를 다시 켜면 `none`이라 차는 새 코드를 받습니다.
- `GET /drivers` → `{ carId, seats: [{ seatId, name, phoneId, pleosProfileId, btDeviceId, pairedAt, lastEventsAt, lastPresenceAt, presence }], present: [{ seatId, at }], lastSelectedSeatId, serverTime }`. 자리는 연결한 순서이고 토큰은 나오지 않습니다. `present`는 차 블루투스에 붙었다고 알려 온 자리(최근에 알린 순)이며 '10분 안인지'는 `serverTime`과 `at`으로 차가 판단합니다(정책서 5장 ③).
- `PUT /drivers/selected` `{ seatId }` → `{ lastSelectedSeatId }`. 이 차의 자리가 아니면 404.
- `DELETE /car` → `{ removedSeats }`. 차곡 초기화: 그 차의 모든 자리·코드와 자리 데이터를 지웁니다. 차 id·토큰은 남아 새 코드를 낼 수 있습니다. 다른 차는 그대로입니다.
- 일정 읽기는 `GET /events?date=&driver=<seatId>`·`GET /schedules/today?driver=<seatId>`(응답 형식은 그대로)에 차 토큰을 붙입니다.

### 폰

- `POST /pair/claim` `{ code, name? }` → 200 `{ carId, seatId, name, phoneToken, pairedAt, mode }`. `name`은 폰 기기 이름(자리 이름), 없으면 '내 폰'.
  - 새 운전자(`mode: "new"`): 새 자리를 만들고 연결 전 기본 자리 데이터를 이어받습니다. 요청에 이 차의 **같은 자리 폰 토큰**이 실려 있으면(같은 폰의 재연결) 자리를 늘리지 않고 토큰만 새로 받습니다.
  - 폰 바꾸기(`mode: "replace"`): 같은 자리를 이어받습니다. **옛 폰의 토큰은 바로 무효(401)**, 옛 폰의 일정·캘린더 선택은 비우고, 자주 가는 곳·가족 요청 같은 **기억은 그대로** 둡니다. 자리 이름은 새 폰 이름으로 바뀝니다.
  - 오류: 400(본문), 404(없거나 만료된 코드), 409 `seat-limit`, 429 `locked`(아래).
- `GET /pair` → `{ paired: true, carId, seatId, name, pairedAt, lastEventsAt, presence, lastPresenceAt }`. 토큰이 끊기거나 바뀌었으면 401.
- `DELETE /pair` → `{ disconnected: true, seatId }`. 차 연결 끊기: 그 자리의 연결·일정·기억을 바로 지우고 차 목록에서 뺍니다. 그 자리가 '지난번 고른 자리'였으면 최근 연결 자리로 돌아갑니다. 다른 자리는 그대로입니다.
- `POST /presence` `{ connected: boolean }` → `{ seatId, connected, at }`. 차 블루투스에 붙었다·떨어졌다 알림(갤럭시 폰 앱 몫. 아직 폰에서 부르는 곳은 없고 서버만 있습니다).

### 코드 시도 제한

- 코드는 6자리 숫자이고 **5분** 안에 한 번만 씁니다(`CODE_TTL_MS`).
- 틀린(없는·만료된) 코드를 한 요청 주소에서 60초 안에 5번 넣으면 그 주소의 claim을 60초 막고 **429** `{ reason: "locked", retryAfterSeconds }`와 `Retry-After`를 줍니다. 잠긴 동안은 맞는 코드도 막고 잠금을 늘리지 않습니다. 맞히면 그 주소의 실패 횟수를 지웁니다. `/pair/claim`과 옛 `/pairing/claim`이 같은 횟수를 씁니다.
- 요청 주소는 node 서버의 연결 주소입니다(`createApp({ clientAddress })`로 바꿈). 프록시 뒤에서는 모든 요청이 한 주소로 보이므로 배포할 때 바꿔야 하며 `X-Forwarded-For`는 속일 수 있어 기본으로 믿지 않습니다. 알 수 없으면 `unknown` 하나로 묶습니다.

## 옛 경로(호환, 현재 차 앱이 씀) (`routes/pairing.ts`)

차 id만으로 부르는 경로입니다. 같은 저장소(자리 모델)를 쓰고, 응답에 새 필드를 더했을 뿐 옛 필드는 그대로입니다.

- `POST /pairing/codes` `{ carId }` → `{ code, expiresAt, qr, carToken }`. 언제나 새 운전자용 코드입니다. `carToken`은 차를 처음 만든 응답에만 있고 그 뒤엔 `null`입니다.
- `GET /pairing/cars/:carId` → `{ paired, pairedAt, codeActive }`. `paired`는 이 차에 연결된 자리가 하나라도 있는가, `pairedAt`은 가장 최근 연결 시각입니다.
- `POST /pairing/claim` `{ code, name? }` → `{ carId, pairedAt, seatId, name, phoneToken }`. 없거나 만료된 코드는 404, 모양이 틀리면 400.
- `DELETE /pairing/cars/:carId` → 그 차의 모든 자리와 서버 데이터를 지우고 상태를 돌려줍니다(데모 초기화. 새 API의 `DELETE /car`와 같음).
- 이 경로는 차 토큰 없이 carId만 믿습니다(기존 결정). 차 앱이 `/pair/*`·`/drivers`로 옮기면 없앨 수 있습니다.

## 차 (`car/`)

현재 차 앱은 옛 경로(`/pairing/*`)와 자리를 모르는 읽기(`driver` 없음)를 씁니다. 운전자 판단(정책서 5장 2번)·차 설정의 '새 운전자/폰 바꾸기'·`driver=` 읽기는 차 쪽 묶음이 `/pair/*`·`/drivers`·`/presence`에 이어 붙입니다(차 토큰은 `POST /pair/code` 응답에서 받아 Keystore로 저장).

- `PairingController`(전용 스레드): 연결 카드가 보일 수 있을 때(앱이 앞, 정차, Suspend 아님)만 돕니다. 코드 받기 → 2초마다 연결 확인, 만료 30초 전 새 코드(코드는 5분), 서버가 이 차의 코드를 모르면(`codeActive: false`, 서버 재시작) 바로 새 코드. 서버에 닿지 않으면 5·10·20·40·60초로 늘려 다시 합니다. 멈췄다 다시 켜면 받아 둔 코드가 살아 있는지부터 봅니다. 로그에는 차 id·코드를 남기지 않습니다.
- `ChagokStore`: 익명 차 id(UUID, 사람·차량 정보 없음)와 연결 여부.
- `DriveSession`: 연결 전에는 탑승해도 탑승을 소진하지 않고 연결 카드만 둡니다(말하지 않음, 버튼 없음, 시간이 지나도 접지 않음). 주행하면 바로 접고 다시 서면 다시 보입니다. 새 코드가 오면 카드를 바꿉니다.
  - `Event.PairingCodeIssued` → 카드, `Event.Paired(brief = true)` → 카드 접기 + 일정 다시 받기 + 탑승 판단, `Event.Unpaired` → 떠 있던 카드를 접고 연결 전으로.
- 연결 카드: `Phrases.pairingCard`("휴대폰과 연결해 주세요." + "휴대폰 차곡 앱에서 QR을 찍거나 번호를 넣어 주세요."), `TileView.Pairing`(흰 바탕 QR 200dp, ZXing core로 그림 + 번호 `R.id.pairing_code`).

## 폰 (`phone/src/features/pair-car/`)

- `PairCarScreen`: [QR 찍기](expo-camera `CameraView`, QR만) → 차곡 QR이면 바로 연결, 아니면 '차곡 차 화면의 QR이 아니에요'. 카메라를 거부하면 번호를 넣으라고 안내합니다.
- 번호 입력은 숫자만 6자리(`123 456`처럼 넣어도 됨). [연결하기] → 성공하면 '✓ 차와 연결됐어요'와 [완료](3단계 일정 목록으로).
- 연결할 때 기기 이름(`expo-device`의 기기 이름 → 모델 이름 → '내 폰', 40자)을 자리 이름으로 보내고, 응답의 폰 토큰은 `expo-secure-store`(`phone/src/api/session.ts`)에 저장합니다. 이후 Hono RPC 클라이언트(`phone/src/api/client.ts`)가 모든 요청에 `Authorization: Bearer`를 붙입니다. 서버가 토큰을 401로 거절하면(다른 폰으로 바뀜·끊김·차곡 초기화) 토큰을 버려 연결 전 상태(기본 자리)로 돌아갑니다. 저장소를 읽지 못해도 그 실행 동안은 메모리 값으로 동작합니다.
- `pairingApi.disconnect`(`DELETE /pair`)는 API만 있고 화면은 없습니다(설정 화면 묶음이 붙임). 성공하거나 401이면 토큰을 버립니다.
- 404는 '번호가 맞지 않거나 시간이 지났어요…'(새 번호를 넣게 함), 네트워크 실패는 [다시 시도]로 같은 번호를 다시 보냅니다. 요청은 기존 10초 제한(`requestWithTimeout`).

## 데모·E2E

- debug 빌드 `chagok-debug://signal?paired=true|false`(가장 먼저 처리). `true`는 말없이 연결된 것으로 두고, `false`는 서버에서도 풀고 새 코드로 연결 카드를 띄웁니다. 연결 상태는 차에 남습니다. 서버의 `DELETE /pairing/cars/:carId`는 그 차의 모든 자리를 지웁니다.
- 연결 카드가 없는 기존 차량 Maestro flow는 시작 신호에 `paired=true`를 넣습니다. 계측 테스트는 `setUp`에서 `host.setPaired(true)`, 연결 서버는 `FakePairingClient`입니다.
- PT 시연 전 초기화: `paired=false&now=…`로 연결 카드부터 시작합니다.

## 검증

- `pnpm server:test`(`server/test/seats.test.ts`: 자리 둘의 격리·폰 바꾸기·끊기·`DELETE /car`·코드 5분 만료(`createApp({ now })`)·시도 제한·기본 자리 호환, `server/test/pairing.test.ts`: 옛 경로), 차량 단위 `DriveSessionPairingTest`, 계측 `PairingTest`, Maestro `e2e/maestro/car/pairing.yaml`(화면의 번호를 읽어 `claim-pairing.js`가 서버에 보냄. `SERVER_URL`은 `-e`로만 넣는다 — flow env에 기본값을 두면 runScript가 그 값을 받는다), 폰 Maestro `e2e/maestro/phone/pair-car.yaml`(서버에서 코드를 받아 번호로 넣음), `pnpm phone:test`(`PairCarScreen.test.tsx`, `pairCode.test.ts`, `pairingApi.test.ts`, `deviceName.test.ts`, `session.test.ts`)
- 실제 폰 카메라로 차 화면 QR을 찍는 것은 수동 확인입니다(에뮬레이터 카메라는 가상 장면).
