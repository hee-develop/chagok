# 차–폰 연결(QR · 6자리 번호)

PT 대본의 "폰에서 일정·주소·채비를 넣고 → 마지막에 차 화면 QR을 찍어 연결 → 이어지는 차 탑승 브리핑이 방금 넣은 내용으로 말함"입니다.
회원가입은 없고 QR 연결이 곧 계정입니다(정책서 10.1·10.9·11장). 한 차에 폰 여러 대를 연결할 수 있고, 폰 한 대가 **운전자 자리** 하나입니다.
일정·캘린더 선택·장소 보정·채비·자주 가는 곳·가족 요청은 자리별로 따로 쌓입니다.

## 자리 모델 (`server/src/seats.ts`, `seatData.ts`, `seatScope.ts`)

- `Car { carId, carToken, lastSelectedSeatId, createdAt, lastActiveAt }`: 차 하나. `carToken`은 차만 알고 차 쪽 API에 씁니다. 차가 처음 코드를 받을 때 만들어 **한 번만** 알려 주고, **다시 내주지 않습니다**: 토큰을 잃은 차는 새 `carId`로 다시 등록하고, 자리 없는 옛 차는 TTL로 지워집니다.
- `Seat { seatId, carId, name, phoneId, phoneToken, pleosProfileId, btDeviceId, pairedAt, lastEventsAt, lastPresenceAt, presence }`: 자리 이름은 폰 기기 이름이고 같은 차에 겹치면 ` 2`를 붙입니다(빈 이름은 '내 폰', 40자 상한). `lastEventsAt`은 마지막으로 일정을 받은 시각, `lastPresenceAt`·`presence`는 폰이 차 블루투스에 붙었다·떨어졌다고 알린 마지막 시각과 상태입니다. **한 폰은 한 자리만** 가집니다: 다른 자리(다른 차 포함)의 토큰을 든 폰이 새 차에 연결하거나 다른 자리를 이어받으면 예전 자리는 끊깁니다(그 자리 삭제).
- 지난번 고른 자리: 차가 `PUT /drivers/selected`로 정하고, 고른 적이 없으면 '가장 최근에 연결한 자리'로 내려 줍니다(정책서 10.1 ④).
- 자리 데이터(`SeatData`): 일정(`EventsStore`)·캘린더 선택·자주 가는 곳·가족 요청·일정별 장소 보정과 채비. 앞으로 생길 장소 기억·도착 횟수·이동 없음 기억 저장소도 여기에 붙입니다(자리를 지우면 함께 지워짐).
- **연결 전 버킷**: 아직 토큰이 없는 폰(첫 설정 1~3단계)의 데이터는 그 폰의 **기기 id별 버킷**(`SeatData`와 같은 모양)에 쌓이고, `POST /pair/claim`(옛 `/pairing/claim` 포함) 때 **그 요청의 기기 id 버킷만** 새 자리로 옮겨집니다. 버킷은 500개까지(차면 새 기기의 쓰기는 429 `capacity`, 있는 버킷은 안 밀어냄), 7일(`BUCKET_TTL_MS`) 동안 쓰지도 읽지도 않으면 버려집니다.
- 용량(모두 메모리, 서버를 다시 켜면 사라짐): 한 차에 폰 8대(`MAX_SEATS_PER_CAR`), 서버가 아는 차 200대(`MAX_CARS`), 서버 전체 일정 저장 32MB(`MAX_TOTAL_EVENT_BYTES`, 넘기는 `PUT /events`는 429 `capacity`).

### 요청이 어느 자리를 다루는가

폰 토큰·차 토큰은 `Authorization: Bearer <토큰>`(서버가 만든 64자 16진수), 폰의 기기 id는 `X-Chagok-Device: <id>`(폰이 첫 실행 때 만든 난수, 영문·숫자·`-`·`_` 22~64자. 모양이 틀리면 **400** `bad-device`. 로그에 남기지 않음)로 보냅니다.

| 식별 | 쓰기(`PUT /events`, `PUT /calendars/selection`, `PUT /schedules/:id/place`·`care`, `POST /schedules/:id/family-request`, 자주 가는 곳 `PUT`·`POST`) | 읽기(`GET /events`, `/schedules/today`·`/places`, `/calendars/selection`, `/places/favorites`, `/family/requests`) |
| --- | --- | --- |
| 폰 토큰 | 그 자리(기기 id는 자리를 정하는 데 안 씀) | 그 자리 |
| 모르는 폰 토큰(바뀜·끊김·초기화)·이상한 Authorization 형식 | **401**(기기 id 버킷이나 기본 자리로 흘리지 않음. 폰이 토큰을 버리고 같은 요청을 기기 id만으로 한 번 다시 보냄) | 401 |
| 토큰 없음 + 기기 id | 그 기기의 연결 전 버킷(없으면 만듦, 가득 차면 429) | 그 기기의 버킷(없으면 빈 응답, 만들지 않음) |
| `driver=<seatId>` + 차 토큰(또는 그 자리 폰 토큰) | — | 그 자리. 토큰이 없으면 401, 남의 자리·없는 자리는 403 |
| 차 토큰만(`driver` 없음) | — | **그 차 안에서만** '지난번 고른 자리(없으면 가장 최근에 연결한 자리)'. 그 차에 자리가 없으면 기본 자리 |
| **식별 없음**(토큰·기기 id 모두 없음) | **기본 자리** | **옛 차 앱 호환 읽기**: **자리가 있는 차가 정확히 하나일 때만** 그 차의 지난번 고른 자리(없으면 가장 최근 자리), 그 밖에는(자리 있는 차가 없거나 둘 이상) **기본 자리** |

- 호환 읽기의 범위: 자리를 모르는 현재 차 앱(`driver`·차 토큰 없이 읽음)이 새 폰이 보낸 일정을 계속 받게 하는 규칙입니다. 자리 있는 차가 둘 이상이면 어느 차의 읽기인지 알 수 없어 **다른 사람의 자리로 보내지 않고** 기본 자리를 줍니다. 차 앱이 `driver`를 보내게 되면 `createApp({ legacyDriverFallback: false })`로 끄고(차 토큰만 있는 읽기도 기본 자리) 기본 자리만 보게 합니다. 한계: 식별 없이 읽는 다른 클라이언트(예: 기기 id를 아직 안 보내는 옛 폰 빌드)는 자리 있는 차가 하나뿐일 때 그 자리를 읽을 수 있습니다. 새 폰은 늘 기기 id를 보내므로 해당하지 않습니다.
- 기본 자리: **식별이 전혀 없는 요청**(픽스처·데모·차량 E2E·Maestro 경로, 변경 금지)이 읽고 씁니다. **어떤 새 자리도 기본 자리 데이터를 이어받지 않습니다**(예전의 '기본 자리 이어받기'는 없어졌습니다).
- **픽스처는 기본 자리에서만** 씁니다. 실제 자리(연결된 자리·연결 전 버킷)는 일정을 받은 적이 없어도 픽스처로 떨어지지 않고 **0건**입니다. 폰 바꾸기는 옛 폰의 일정·캘린더 선택을 '받았고 0건' 상태로 비웁니다(기억은 유지).
- `DELETE /events`(같은 기기만, 개발·데모용): 폰 토큰이 있으면 그 자리만, 기기 id만 있으면 그 버킷만, 식별이 없으면 기본 자리와 '식별 없이 읽는 자리'를 받은 적 없는 상태로 되돌립니다(기본 자리는 픽스처 복귀, 실제 자리는 0건).
- 데모·폰 E2E 서버: `createApp({ fixtureSeats: true })`(환경 변수 `FIXTURE_SEATS=1`)를 켜면 일정을 받은 적 없는 실제 자리·버킷도 픽스처로 떨어집니다(목 캘린더로 도는 폰 E2E·PT 시연·차량 Maestro가 쓰는 서버. `scripts/e2e-car.sh`, `pnpm demo:pt server`가 켬). 기본은 꺼짐이고 실제 사용자 서버에서는 켜지 않습니다. 폰 E2E(`scripts/e2e-phone.sh`)는 Maestro가 서버를 기기 id 없이 직접 읽으므로 폰 번들에 `EXPO_PUBLIC_DEVICE_ID=none`을 넣어 기기 id를 끄고 기본 자리에서 돕니다.

## 흐름

1. 차가 코드(숫자 6자리, **5분**)를 받아 **연결 카드**를 띄웁니다. QR에는 `chagok://pair?code=123456`이 담기고 번호는 `123 456`으로 보입니다. 새 운전자는 `mode: new`, 폰 바꾸기는 `mode: replace`+`seatId`입니다(차 설정 화면은 차 쪽 묶음에서).
2. 폰 첫 설정 4단계(`/setup/pair-car`)에서 [QR 찍기](카메라)나 번호 입력으로 서버에 코드와 **기기 이름**을 보냅니다. 서버는 폰 토큰을 주고(이 폰의 기기 id 버킷에 모아 둔 연결 전 데이터가 새 자리로 옮겨짐), 폰은 `expo-secure-store`에 저장해 이후 모든 요청에 붙입니다.
3. 차는 연결됐는지 묻다가 연결되면 저장하고, 카드를 접고, 일정을 다시 받은 뒤 **첫 탑승 브리핑**을 합니다(정차 중일 때. 주행 중이면 다음 탑승).

## 서버 API (정책서 이름: `server/src/routes/pair.ts`)

차 쪽 API는 `Authorization: Bearer <carToken>`이 필요하고, 폰 쪽은 `Bearer <phoneToken>`입니다. 오류 본문은 `{ error, reason? }`입니다.

### 차

- `POST /pair/code` 본문(모두 생략 가능, 빈 본문 가능): `{ carId?, mode?: "new"|"replace", seatId?, btDeviceId?, pleosProfileId? }`
  - 응답 200: `{ carId, carToken, code, expiresAt, expiresInSeconds, qr, mode, seatId }`. `carToken`은 **차를 처음 만든 응답에만** 실리고 그 밖에는 `null`입니다(토큰 재발급 없음). `seatId`는 replace일 때 바꿀 자리입니다. 그 차의 이전 코드는 버리고, 살아 있는 다른 차의 코드와 겹치지 않게 냅니다.
  - `btDeviceId`·`pleosProfileId`는 짝짓는 순간 차가 읽은 값이고 연결되는 자리에 묶입니다(replace는 새 폰의 블루투스 기기로 바뀌고 없으면 비움, 프로필은 안 주면 유지).
  - 차 정하기: 토큰이 있으면 그 차(본문 `carId`가 다르면 403). 토큰이 없고 모르는 차면 새로 만듭니다(본문 `carId`를 쓰고 없으면 서버가 정함). **토큰이 없는데 아는 차이면 자리가 있든 없든 401**입니다(`carId`만으로 토큰을 바꿀 수 없음. 토큰을 잃은 차는 새 `carId`로 다시 등록).
  - 차 생성 제한: 한 요청 주소가 10분에 10대까지(`MAX_CAR_CREATES_PER_SOURCE`), 서버 전체 200대. 자리가 없는 차는 마지막 코드 발급 뒤 코드 만료(5분)에 1시간(`SEATLESS_CAR_TTL_MS`)이 더 지나면 지웁니다(자리가 있는 차는 지우지 않음).
  - 오류: 400(본문 모양), 401(차 토큰), 404 `unknown-seat`(이 차에 없는 자리), 409 `seat-limit`, 429 `too-many-cars`·`rate-limited`.
- `GET /pair/status` → `{ state: "none"|"waiting"|"claimed"|"expired", expiresAt, mode, seatId }`. 마지막으로 낸 코드의 상태이고 `claimed`면 `seatId`가 연결된 자리입니다. 서버를 다시 켜면 `none`이라 차는 새 코드를 받습니다.
- `GET /drivers` → `{ carId, seats: [{ seatId, name, phoneId, pleosProfileId, btDeviceId, pairedAt, lastEventsAt, lastPresenceAt, presence }], present: [{ seatId, at }], lastSelectedSeatId, serverTime }`. 자리는 연결한 순서이고 토큰은 나오지 않습니다. `present`는 차 블루투스에 붙었다고 알려 온 자리(최근에 알린 순)이며 '10분 안인지'는 `serverTime`과 `at`으로 차가 판단합니다(정책서 5장 ③).
- `PUT /drivers/selected` `{ seatId }` → `{ lastSelectedSeatId }`. 이 차의 자리가 아니면 404.
- `DELETE /car` → `{ removedSeats }`. 차곡 초기화: 그 차의 모든 자리·코드와 자리 데이터를 지웁니다. 차 id·토큰은 남아 새 코드를 낼 수 있습니다. 다른 차는 그대로입니다.
- 일정 읽기는 `GET /events?date=&driver=<seatId>`·`GET /schedules/today?driver=<seatId>`(응답 형식은 그대로)에 차 토큰을 붙입니다.

### 폰

- `POST /pair/claim` `{ code, name? }`(+ 헤더 `X-Chagok-Device`) → 200 `{ seatId, name, phoneToken, pairedAt, mode }`. `name`은 폰 기기 이름(자리 이름), 없으면 '내 폰'. **응답에 `carId`는 없습니다**(차 id는 옛 경로에서 차를 가리키는 열쇠라 차만 압니다).
  - 새 운전자(`mode: "new"`): 새 자리를 만들고 **이 요청의 기기 id 버킷**(연결 전 데이터)만 이어받습니다(기기 id가 없으면 빈 자리, 기본 자리·다른 폰의 버킷은 안 가져감). 요청에 이 차의 **같은 자리 폰 토큰**이 실려 있으면(같은 폰의 재연결) 자리를 늘리지 않고 토큰만 새로 받습니다. 다른 차의 자리를 가진 폰이면 예전 자리를 끊고(삭제) 새 자리를 만듭니다.
  - 폰 바꾸기(`mode: "replace"`): 같은 자리를 이어받습니다. **옛 폰의 토큰은 바로 무효(401)**, 옛 폰의 일정·캘린더 선택·보정·채비는 버려 '받았고 0건' 상태가 되고(픽스처로 떨어지지 않음), 자주 가는 곳·가족 요청 같은 **기억은 그대로** 둡니다. 새 폰의 버킷이 있으면 그 일정·캘린더 선택·보정·채비만 반영합니다(버킷의 자주 가는 곳은 안 씀). 자리 이름은 새 폰 이름으로 바뀌고, 그 폰이 다른 자리를 가지고 있었다면 그 자리는 끊깁니다.
  - 오류: 400(본문·기기 id), 404(없거나 만료된 코드), 409 `seat-limit`, 429 `locked`(아래).
- `GET /pair` → 200 `{ paired: true, seatId, name, pairedAt, lastEventsAt, presence, lastPresenceAt }`(연결됨: 자리 이름·연결 시각) / 401(연결 안 됨: 토큰이 없거나 끊기거나 바뀜). `carId`는 주지 않습니다. 폰은 `pairingApi.status`로 부릅니다.
- `DELETE /pair` → `{ disconnected: true, seatId }`. 차 연결 끊기: 그 자리의 연결·일정·기억을 바로 지우고 차 목록에서 뺍니다. 그 자리가 '지난번 고른 자리'였으면 최근 연결 자리로 돌아갑니다. 다른 자리는 그대로입니다.
- `POST /presence` `{ connected: boolean }` → `{ seatId, connected, at }`. 차 블루투스에 붙었다·떨어졌다 알림(갤럭시 폰 앱 몫. 아직 폰에서 부르는 곳은 없고 서버만 있습니다).

### 코드 시도 제한

- 코드는 6자리 숫자이고 **5분** 안에 한 번만 씁니다(`CODE_TTL_MS`).
- 틀린(없는·만료된) 코드를 한 요청 주소에서 60초 안에 5번 넣으면 그 주소의 claim을 60초 막고 **429** `{ reason: "locked", retryAfterSeconds }`와 `Retry-After`를 줍니다. 잠긴 동안은 맞는 코드도 막고 잠금을 늘리지 않습니다. 맞히면 그 주소의 실패 횟수를 지웁니다. `/pair/claim`과 옛 `/pairing/claim`이 같은 횟수를 씁니다.
- **실패 기록 표가 차면(주소 100개, `MAX_TRACKED_SOURCES`) 새 주소의 시도를 잠금으로 봅니다**(fail-closed). 주소를 많이 만들어 표를 채워도 실패가 세지지 않는 새 주소로 코드를 찍어 볼 수 없습니다.
- **서버 전체**에서 60초 안에 틀린 코드가 120번(`MAX_GLOBAL_FAILURES`) 쌓이면 모든 주소의 claim을 그 창이 지날 때까지 막습니다(주소를 바꿔 가며 찍는 공격).
- 어떤 잠금도 `Retry-After` 60초(`MAX_LOCK_MS`)를 넘지 않습니다(표가 차 있거나 전체 상한에 걸린 동안 정상 사용자도 최대 60초 429를 볼 수 있음).
- 요청 주소는 node 서버의 연결 주소입니다(`createApp({ clientAddress })`로 바꿈). 프록시 뒤에서는 모든 요청이 한 주소로 보이므로 배포할 때 바꿔야 하며 `X-Forwarded-For`는 속일 수 있어 기본으로 믿지 않습니다. 알 수 없으면 `unknown` 하나로 묶습니다.

## 옛 경로(호환, 현재 차 앱이 씀) (`routes/pairing.ts`)

차 id만으로 부르는 경로입니다. 같은 저장소(자리 모델)를 쓰고, 응답에 새 필드를 더하고 **폰이 받는 응답에서 `carId`를 뺐을 뿐** 나머지는 그대로입니다.

- `POST /pairing/codes` `{ carId }` → `{ code, expiresAt, qr, carToken }`. 언제나 새 운전자용 코드입니다. `carToken`은 차를 처음 만든 응답에만 있고 그 뒤엔 `null`입니다. 모르는 `carId`면 차를 만듭니다(주소별 속도 제한). **자리가 이미 있는 차**는 그 차의 토큰(`Authorization`)이 있거나 **같은 기기(루프백) 요청**일 때만 받고, 아니면 401입니다. 자리가 없는 차는 예전처럼 `carId`만으로 받습니다.
- `GET /pairing/cars/:carId` → `{ paired, pairedAt, codeActive }`. `paired`는 이 차에 연결된 자리가 하나라도 있는가, `pairedAt`은 가장 최근 연결 시각입니다. 읽기 전용이라 `carId`만으로 됩니다(차 앱이 몇 초마다 부름).
- `POST /pairing/claim` `{ code, name? }`(+ `X-Chagok-Device`) → `{ pairedAt, seatId, name, phoneToken }`. 없거나 만료된 코드는 404, 모양이 틀리면 400.
- `DELETE /pairing/cars/:carId` → 그 차의 모든 자리와 서버 데이터를 지우고 상태를 돌려줍니다(데모 초기화. 새 API의 `DELETE /car`와 같음). 자리가 있는 차는 `POST /pairing/codes`와 같은 조건(차 토큰 또는 같은 기기)에서만 지웁니다. 자리가 없으면 `carId`만으로 됩니다.
- 같은 기기 판정은 `/events`의 `EVENTS_LOOPBACK_ONLY`와 같은 함수(`createApp({ isLoopback })`, 기본은 node 서버의 연결 주소가 `127.0.0.1`·`::1`인지)입니다. 에뮬레이터의 차 앱(`10.0.2.2`)과 Maestro는 호스트 루프백으로 들어오므로 데모·E2E는 그대로 됩니다. **리버스 프록시 뒤에서는 모든 요청이 루프백으로 보이므로 배포할 때 이 함수를 바꿔야 합니다.**
- 이 경로는 차 앱이 `/pair/*`·`/drivers`로 옮기면 없앱니다. 현재 차 앱의 호출(`flow/Pairing.kt`: `POST /pairing/codes`, `GET`·`DELETE /pairing/cars/{carId}`, 차 토큰·`driver` 없는 읽기)은 위 규칙에서 그대로 동작합니다(차 앱·`car/`는 이번에 안 바꿨습니다).

## 차 (`car/`)

현재 차 앱은 옛 경로(`/pairing/*`, `car/`의 `flow/Pairing.kt`)와 자리를 모르는 읽기(`driver`·차 토큰 없음)를 씁니다. 운전자 판단(정책서 5장 2번)·차 설정의 '새 운전자/폰 바꾸기'·`driver=` 읽기는 차 쪽 묶음이 `/pair/*`·`/drivers`·`/presence`에 이어 붙입니다(차 토큰은 `POST /pair/code` 응답에서 받아 Keystore로 저장).

- `PairingController`(전용 스레드): 연결 카드가 보일 수 있을 때(앱이 앞, 정차, Suspend 아님)만 돕니다. 코드 받기 → 2초마다 연결 확인, 만료 30초 전 새 코드(코드는 5분), 서버가 이 차의 코드를 모르면(`codeActive: false`, 서버 재시작) 바로 새 코드. 서버에 닿지 않으면 5·10·20·40·60초로 늘려 다시 합니다. 멈췄다 다시 켜면 받아 둔 코드가 살아 있는지부터 봅니다. 로그에는 차 id·코드를 남기지 않습니다.
- `ChagokStore`: 익명 차 id(UUID, 사람·차량 정보 없음)와 연결 여부.
- `DriveSession`: 연결 전에는 탑승해도 탑승을 소진하지 않고 연결 카드만 둡니다(말하지 않음, 버튼 없음, 시간이 지나도 접지 않음). 주행하면 바로 접고 다시 서면 다시 보입니다. 새 코드가 오면 카드를 바꿉니다.
  - `Event.PairingCodeIssued` → 카드, `Event.Paired(brief = true)` → 카드 접기 + 일정 다시 받기 + 탑승 판단, `Event.Unpaired` → 떠 있던 카드를 접고 연결 전으로.
- 연결 카드: `Phrases.pairingCard`("휴대폰과 연결해 주세요." + "휴대폰 차곡 앱에서 QR을 찍거나 번호를 넣어 주세요."), `TileView.Pairing`(흰 바탕 QR 200dp, ZXing core로 그림 + 번호 `R.id.pairing_code`).

## 폰 (`phone/src/features/pair-car/`)

- `PairCarScreen`: [QR 찍기](expo-camera `CameraView`, QR만) → 차곡 QR이면 바로 연결, 아니면 '차곡 차 화면의 QR이 아니에요'. 카메라를 거부하면 번호를 넣으라고 안내합니다.
- 번호 입력은 숫자만 6자리(`123 456`처럼 넣어도 됨). [연결하기] → 성공하면 '✓ 차와 연결됐어요'와 [완료](3단계 일정 목록으로).
- 연결할 때 기기 이름(`expo-device`의 기기 이름 → 모델 이름 → '내 폰', 40자)을 자리 이름으로 보내고, 응답의 폰 토큰은 `expo-secure-store`(`phone/src/api/session.ts`)에 저장합니다. 저장소를 읽지 못해도 그 실행 동안은 메모리 값으로 동작합니다.
- **기기 id**: 첫 실행 때 암호학적 난수(`expo-crypto`, 16바이트 = 16진수 32자)를 만들어 `expo-secure-store`에 저장하고(토큰과 같은 곳), Hono RPC 클라이언트(`phone/src/api/client.ts`)가 **모든 요청에** `X-Chagok-Device`로 붙입니다. 토큰이 있으면 `Authorization: Bearer`도 붙입니다. 서버는 토큰이 없을 때 이 id로 이 폰만의 연결 전 버킷을 읽고 씁니다(서버 규칙은 위 표).
- **401 재전송**: 서버가 토큰을 401로 거절하면(다른 폰으로 바뀜·끊김·차곡 초기화) 토큰을 버리고 **같은 요청을 토큰 없이(기기 id만으로) 한 번 다시 보냅니다**(그 사이 새 토큰이 생겼으면 그 토큰으로. 다시 보낸 요청이 또 401이면 그대로 돌려줌. 본문이 문자열이 아니면 안 다시 보냄). 그래서 방금 요청이 연결 전 상태로 이어지고 이후 요청은 처음부터 토큰이 없습니다. `withSessionReset`과 `hc`를 서버 앱에 실제로 묶은 테스트가 `phone/src/api/__tests__/clientWiring.test.ts`입니다.
- `pairingApi.status`(`GET /pair`): 200이면 자리 이름·연결 시각, 401이면 `null`(연결 안 됨), 그 밖의 오류는 던집니다. 연결 상태를 보이는 화면(J5a 폰 탭)이 이것을 씁니다. `pairingApi.disconnect`(`DELETE /pair`)는 API만 있고 화면은 없습니다(설정 화면 묶음이 붙임). 성공하거나 401이면 토큰을 버립니다.
- `PairCarScreen` 선택 속성: `onSkip`을 주면 연결하기 전에 누를 수 있는 [건너뛰기]를 보이고 누르면 부릅니다. `onDone`을 주면 연결된 뒤 [완료]가 기본 이동(3단계 목록) 대신 이것을 부릅니다. 둘 다 없으면 지금 동작 그대로입니다(글자·testID 그대로).
- 안내 문구: 404는 '번호가 맞지 않거나 시간이 지났어요…'(새 번호를 넣게 함), 409 `seat-limit`은 '이 차에는 더 연결할 수 없어요…', 429 `locked`는 '번호를 여러 번 잘못 넣었어요. 잠시 뒤 다시 해 주세요.'(둘 다 [다시 시도] 없음), 네트워크 실패는 [다시 시도]로 같은 번호를 다시 보냅니다. 요청은 기존 10초 제한(`requestWithTimeout`).
- 기본 서버 주소 `http://localhost:8787`(`EXPO_PUBLIC_API_URL`)은 **개발용**입니다. 폰 토큰·기기 id·일정이 오가므로 **배포할 때는 HTTPS 서버 주소가 필요**합니다(평문 HTTP는 같은 망의 다른 기기가 토큰·일정을 볼 수 있음).

## 데모·E2E

- debug 빌드 `chagok-debug://signal?paired=true|false`(가장 먼저 처리). `true`는 말없이 연결된 것으로 두고, `false`는 서버에서도 풀고 새 코드로 연결 카드를 띄웁니다. 연결 상태는 차에 남습니다. 서버의 `DELETE /pairing/cars/:carId`는 그 차의 모든 자리를 지웁니다.
- 차량 Maestro(`scripts/e2e-car.sh`)와 PT 시연 서버(`pnpm demo:pt server`)는 `FIXTURE_SEATS=1`로 뜹니다: `pairing.yaml`이 옛 경로로 연결한 자리(일정을 받은 적 없음)도 이어지는 flow에서 픽스처를 써야 하기 때문입니다. 이 설정이 없는 서버에서는 연결된 자리가 일정을 받기 전까지 0건입니다. 폰 E2E(`scripts/e2e-phone.sh`)는 폰 번들에 `EXPO_PUBLIC_DEVICE_ID=none`을 넣어 기기 id 없이 기본 자리에서 돕니다.
- 연결 카드가 없는 기존 차량 Maestro flow는 시작 신호에 `paired=true`를 넣습니다. 계측 테스트는 `setUp`에서 `host.setPaired(true)`, 연결 서버는 `FakePairingClient`입니다.
- PT 시연 전 초기화: `paired=false&now=…`로 연결 카드부터 시작합니다.

## 검증

- `pnpm server:test`(`server/test/seats.test.ts`: 자리 둘의 격리·폰 바꾸기·끊기·`DELETE /car`·코드 5분 만료(`createApp({ now })`)·시도 제한·기본 자리 호환, `server/test/pairing-isolation.test.ts`: 연결 전 버킷·기본 자리·옛 차 앱 호환 읽기·옛 경로 권한·남용 방지·토큰 재발급 없음·한 폰 한 자리, `server/test/pairing.test.ts`: 옛 경로), 차량 단위 `DriveSessionPairingTest`, 계측 `PairingTest`, Maestro `e2e/maestro/car/pairing.yaml`(화면의 번호를 읽어 `claim-pairing.js`가 서버에 보냄. `SERVER_URL`은 `-e`로만 넣는다 — flow env에 기본값을 두면 runScript가 그 값을 받는다), 폰 Maestro `e2e/maestro/phone/pair-car.yaml`(서버에서 코드를 받아 번호로 넣음), `pnpm phone:test`(`PairCarScreen.test.tsx`, `pairCode.test.ts`, `pairingApi.test.ts`, `deviceName.test.ts`, `session.test.ts`, `clientWiring.test.ts`)
- 실제 폰 카메라로 차 화면 QR을 찍는 것은 수동 확인입니다(에뮬레이터 카메라는 가상 장면).

## 정책서와 다른 점·이번에 하지 않은 것

정책서 10.1·10.9·11장과 다르거나 아직 없는 부분입니다.

- **푸시 토큰 등록·30일 미사용 자리 정리는 다른 묶음**입니다(이 묶음에는 없음). 자리는 연결을 끊거나 `DELETE /car`·옛 초기화로만 지워집니다. 예외로 자리 없는 차와 쓰지 않은 연결 전 버킷은 TTL로 정리됩니다.
- **정책서에 없는 경로를 추가했습니다**: `GET /pair`(폰의 연결 상태), `GET /pair/status`(차가 마지막 코드의 상태를 봄), 옛 `/pairing/*`(현재 차 앱 호환), `GET /drivers`·`PUT /drivers/selected`·`POST /presence`·`DELETE /car`.
- **옛 차 앱 호환 규칙의 범위**: 자리 있는 차가 정확히 하나일 때만 그 차의 지난번 고른 자리(없으면 최근 자리)이고, 차 토큰만 있고 `driver`가 없는 읽기는 그 차 안에서만 같은 규칙, 그 밖에는 기본 자리입니다(표 참고). 차 앱이 `driver`를 보내면 `legacyDriverFallback: false`로 끕니다.
- **폰 바꾸기 뒤에는 0건**: 옛 폰의 일정·캘린더 선택을 '받았고 0건'으로 비우고(픽스처로 떨어지지 않음), 새 폰이 일정을 보내기 전까지 차는 일정 없음으로 판단합니다. 새 폰의 연결 전 버킷이 있으면 그 일정을 반영합니다.
- 기본 자리 '이어받기'를 없앴습니다: 식별 없이 쌓인 데이터(데모·옛 클라이언트)는 새 자리로 가지 않고, 폰의 연결 전 데이터는 기기 id 버킷으로 옮겨집니다.
- 연결 전 폰 데이터를 기기 id로 나누는 것은 정책서에 없는 설계입니다(연결 전 폰이 서로의 데이터를 보지 못하게 함). 기기 id는 사용자 식별이 아니라 이 앱 설치 하나를 가리키는 난수이고 로그·응답에 남기지 않습니다.
- 보안 한계: 저장은 메모리뿐이고 TLS는 서버가 하지 않습니다(위 HTTPS 안내). 프록시 뒤에서는 `clientAddress`·`isLoopback`을 바꿔야 코드 시도 제한과 옛 경로 권한이 맞게 동작합니다.
