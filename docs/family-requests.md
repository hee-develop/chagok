# 가족 묶기와 가족 요청 (서버)

정책서 10.10 '가족 요청'·11장(가족, 가족 요청, 주행 상태, API 표, 정기 작업)·12장('들르기 묶는 거리', '픽업 곧 도착 알림')·13장('가족 초대 코드 유효 시간·인원 한도')의 **서버 쪽** 구현입니다(묶음 J10a).
폰 가족 탭(묶기·요청 만들기·상태·공유 화면)과 차 쪽(요청을 일정과 같은 판단 순서에 넣기, 전달·수락·도착 신호 보내기)은 이 계약을 부르는 다른 묶음입니다. 서버는 전달과 기억만 하고 판단은 하지 않습니다.

코드: `server/src/family/`(`groups.ts` 가족·구성원·초대·공유, `requests.ts` 검증·상태 전이 표, `service.ts` 요청·알림·주행 상태, `guard.ts` 자리 정하기, `jobs.ts` 정기 작업, `phrases.ts` 알림 문구, `limits.ts` 기준값)와 `server/src/routes/familyGroup.ts`·`routes/requests.ts`. 테스트는 `server/test/family-groups.test.ts`·`family-requests.test.ts`.

## 데이터 모델 (모두 메모리, 서버를 다시 켜면 사라짐)

| 데이터 | 내용 | 보관 |
| --- | --- | --- |
| 가족 | 가족 id, 구성원(들어온 순서), 초대 코드(하나, 24시간) | 구성원이 모두 나갈 때까지 |
| 구성원 | 구성원 id(`memberId`, 공개해도 되는 난수), 부르는 이름, 식별 키(자리 키 `s:<seatId>`·기기 id 키 `d:<deviceId>`), 마지막으로 쓴 시각 | 가족에서 나갈 때까지 |
| 도착 예정 공유 | 구성원별로 '내 도착 예정을 보여 주는 가족' 집합. 기본 꺼짐 | 가족에서 나갈 때까지(나간 사람과 얽힌 설정은 둘 다 지움) |
| 가족 요청 | 카테고리·카테고리별 항목·한 줄 메모·날짜·상태, 보낸 구성원, 받는 구성원 또는 '우리 차'(서버 안의 차 id), 만든·바꾼·완료 시각, 5분 전 알림을 보냈는가(`etaSoon`) | 완료 1시간 뒤(가안) 또는 날짜가 지나면 삭제 |
| 주행 상태 | 자리별 주행 중/정차와 바뀐 시각. **위치는 없음** | 마지막 값만, 그날까지 |

저장하지 않는 것: 가족에게 보인 도착 예정 시각(알림 `data`로 전달만 하고 요청에도 남기지 않음), 위치·경로, 이유·답장.

- **가족은 차와 따로 묶입니다.** 가족을 만들거나 들어가는 데 차 연결이 필요 없고, 차 연결을 끊거나 차곡을 초기화해도 가족은 그대로입니다.
- **구성원 식별**: 연결된 폰은 폰 토큰(자리), 연결 전 폰은 기기 id(`X-Chagok-Device`)로 알아봅니다. 한 구성원은 키를 여럿 가질 수 있어서 ① 기기 id로 가족에 든 폰이 차에 연결하면(claim 때 같은 기기 id) 자리 키가 같은 구성원에 붙고, ② 토큰과 기기 id가 함께 오는 요청은 빠진 키를 이어 붙이고, ③ 차 연결이 끊겨 자리 키가 사라져도 기기 id 키로 가족에 남습니다. 식별할 키가 하나도 안 남으면(토큰만으로 가입했고 기기 id를 한 번도 안 보낸 폰의 연결이 끊김) 그 구성원은 가족에서 나간 것으로 칩니다. 폰 바꾸기(replace)는 자리의 구성원을 새 폰이 이어받고 옛 폰의 기기 id 키는 뗍니다(옛 폰이 계속 가족으로 보이지 않게). 두 키가 서로 다른 구성원을 가리키면 자리 키가 이기고 합치지 않습니다.
- **남용 방지(연결 전 폰도 쓸 수 있으므로)**: 한 요청 주소가 10분에 가족 10개까지 만들 수 있고(`MAX_FAMILY_CREATES_PER_SOURCE`, 넘으면 429 `rate-limited`), 서버가 아는 가족은 300개(`MAX_FAMILIES`, 넘으면 429 `too-many-families`), 한 가족 6명, 보낸 사람 한 명의 진행 중 요청 30개·가족 하나 100개(429 `too-many-requests`). 차에 연결하지 않고 30일 쓰지 않은 기기 id 구성원은 정기 작업이 가족에서 내보냅니다(`DEVICE_MEMBER_TTL_MS`, 가안, 연결 전 일정 버킷의 7일과 따로).

## 자리 정하기 (`family/guard.ts`)

J1의 자리 규칙(`docs/pairing.md`)을 따르되, J3의 새 장소 API 가드(`placeRead`·`placeWrite`)와 같은 엄격한 방식입니다. **옛 차 앱 호환 읽기(`legacyDriverFallback`)와 기본 자리를 적용하지 않습니다.**

| 호출자 | 식별 | 결과 |
| --- | --- | --- |
| 폰 | 폰 토큰(기기 id가 같이 오면 그것도) | 그 자리의 구성원 |
| 폰 | 토큰 없음 + 기기 id | 그 기기의 구성원(연결 전 폰) |
| 폰 | 식별 없음 | **401**(기본 자리·빈 범위로 흘리지 않음) |
| 폰 | 모르는 토큰·이상한 Authorization 형식 | 401(폰이 토큰을 버리고 기기 id만으로 다시 보냄) |
| 폰 | 이상한 기기 id | 400 `bad-device` |
| 차 | 차 토큰 + `driver=<자리 id>` | 그 차의 그 자리 |
| 차 | 차 토큰만(`driver` 없음·빈 값·여러 개) | **400 `driver-required`**(J3와 같은 문구·상태. '지난번 고른 자리'로 고르지 않음) |
| 차 | `driver`가 그 차의 자리가 아님 | 403 |
| 차 | 토큰 없음·모르는 토큰·폰 토큰 | 401 |

`GET /requests`는 폰과 차가 같은 주소를 쓰므로 차 토큰이면 차, 아니면 폰으로 봅니다. 차 쪽 경로(`PATCH`·`eta`·`/drive-state`)는 차 토큰만 받습니다. `seatScope.ts`는 고치지 않았습니다(J3와 합칠 때 이 가드를 `placeRead`·`placeWrite` 곁으로 옮겨도 됩니다).

## API

오류 본문은 `{ error, reason? }`입니다. 폰은 `Authorization: Bearer <폰 토큰>`(있으면)과 `X-Chagok-Device`, 차는 `Authorization: Bearer <차 토큰>`과 `?driver=<자리 id>`.

### 가족 (폰)

| 호출 | 하는 일 | 오류 |
| --- | --- | --- |
| `GET /family` | `{ family: null }` 또는 `{ family: { familyId, createdAt, maxMembers, invite: { code, expiresAt } \| null, me: { memberId, name }, members: [{ memberId, name, isMe, connected, shareWithThem, sharesWithMe }], cars: [{ carRef, memberIds }] } }`. `connected`는 그 사람 폰이 어느 차에 연결돼 있는가, `shareWithThem`은 내가 그에게 도착 예정을 보여 주는가, `sharesWithMe`는 그가 나에게 보여 주는가. `cars`는 '우리 차'로 고를 수 있는 차(가족 폰이 연결된 차)와 그 차에 연결된 구성원. `carRef`는 불투명한 값이고 서버 안의 차 id는 나가지 않음 | |
| `POST /family/invite` `{ name? }` | 초대 코드 만들기. 가족이 없으면 가족을 만들고 부른 사람이 첫 구성원(`name`은 부르는 이름, 생략하면 '가족', 20자). 이미 가족이면 새 코드로 바꿈(이전 코드는 즉시 무효). → `{ code, expiresAt, expiresInSeconds, created, family }` | 409 `family-full`, 429 `rate-limited`·`too-many-families` |
| `POST /family/join` `{ code, name? }` | 코드로 참여. 코드는 `ABCD-EFGH`(대소문자·공백·하이픈 무시). → `{ family }` | 404 `invalid`(없는·만료된 코드, 같은 응답), 409 `already-in-family`(어느 가족이든 이미 구성원이면, 같은 가족에 다시 넣어도), 409 `family-full`, 429 `locked`(+`Retry-After`) |
| `PUT /family/me` `{ name }` | 내 부르는 이름 바꾸기(한 가족 안에서 겹치면 ` 2`) | 404 `not-in-family` |
| `DELETE /family/me` | 가족 나가기: **내가 보낸·받은 요청과 공유 설정(내가 켠 것·나에게 켠 것)을 지움**. 마지막 구성원이면 가족도 사라짐. → `{ left: true }` | 404 `not-in-family` |
| `PUT /family/share` `{ memberId, enabled }` | **내가** 가족 한 사람에게 내 도착 예정(약속·픽업 요청의 시각과 주행 중 여부)을 보여 줄지. 기본 꺼짐. → `{ memberId, enabled }` | 400 `self`, 404 `unknown-member`·`not-in-family` |

- **초대 코드**: 8자리(헷갈리는 0·1·I·L·O를 뺀 31글자, 8.5×10¹¹가지). 정책서 13장 미결이라 **가안으로 24시간·가족 6명**(`FAMILY_INVITE_TTL_MS`·`MAX_FAMILY_MEMBERS`)이고 상수 한 곳(`family/limits.ts`)입니다. 한 가족에 코드는 하나이고 **만료 전까지 인원이 찰 때까지 여럿이 쓸 수 있습니다**(가족이 여러 명이라 한 번만 쓰는 코드면 사람 수만큼 만들어야 함. 코드가 새면 24시간 동안 들어올 수 있으므로 누구든 새 코드를 만들어 바꿀 수 있음). 차 연결 코드(5분)와 달리 24시간 살아 있어 6자리 숫자로는 서버 전체 시도 제한(분당 120번)으로도 무차별 대입을 막기 어려우므로 8글자로 늘렸습니다.
- **시도 제한**: 차–폰 연결 코드(`seats.ts` claim)와 같은 방식·같은 기준값입니다(`family/attempts.ts`): 틀린 코드를 한 요청 주소가 60초에 5번 넣으면 그 주소를 60초 막고(잠긴 동안은 맞는 코드도 429, 잠금을 늘리지 않음), 실패 기록 표가 차면(주소 100개) 새 주소를 잠금으로 보고(fail-closed), 서버 전체 120번/60초면 모두 막고, 잠금은 60초를 넘지 않습니다. 맞히면 그 주소의 실패 횟수를 지웁니다. 요청 주소는 `createApp({ clientAddress })`입니다(프록시 뒤에서는 바꿔야 함).

### 요청

| 호출 | 부르는 쪽 | 하는 일 |
| --- | --- | --- |
| `POST /requests` | 폰 | 요청 만들기(아래 본문). 상태는 `sent`(보냄). → `{ request }`(보낸 사람 모양) |
| `GET /requests?date=` | 폰 | `{ sent, received, serverTime }`. 보낸 것·받은 것(사람으로 받은 것, 내 폰이 연결된 차가 '우리 차'로 받은 것)과 상태, 최근에 만든 것부터. `date`(`YYYY-MM-DD`)를 주면 그날만. 가족이 없으면 둘 다 빈 배열 |
| `GET /requests?date=&driver=` | 차 | `{ driver, date, requests, serverTime }`. 그 자리로 온 요청과 이 차의 '우리 차'로 온 요청 중 그날(기본 오늘) **아직 끝나지 않은 것**(`sent`·`delivered`·`accepted`)만. `driver`가 누구든 '우리 차' 요청은 들어 있음 |
| `PATCH /requests/:id` `{ status }` | 차 | 상태 바꾸기: `delivered`·`accepted`·`declined`·`completed`. → `{ request, changed }`. 바뀌면 보낸 사람 알림함에 `family-status` |
| `POST /requests/:id/eta` `{ stage, etaAt? }` | 차 | 도착 5분 전(`soon`)·도착(`arrived`). → `{ notified }` |
| `POST /drive-state` `{ driving }` | 차 | 이 자리의 주행 시작·멈춤. → `{ seatId, driving, changedAt }` |

**`POST /requests` 본문**(항목은 카테고리별로 정해져 있고 그 밖의 항목은 400. 공통: `category`, `recipient`, `memo?`):

| `category` | 항목 | 날짜 |
| --- | --- | --- |
| `care` 채비 | `item`(물건, 60자), `timing`(`take-along` 가져갈 때 \| `bring-back` 가져올 때), `date?` | `date`(기본 오늘) |
| `stop` 들르기 | `place`, `item`(살 것·찾을 것), `deadline`(`{ type: 'today' }` 오늘 중 \| `{ type: 'by', time: 'HH:MM' }`), `date?` | `date`(기본 오늘) |
| `appointment` 약속 가기 | `at`(오프셋 있는 ISO8601), `place`, `companions?`(함께 가는 사람 이름, 10명·각 40자) | `at`의 서울 날짜 |
| `ride` 데려다주기·픽업 | `who`(누구를, 40자), `pickup`(어디서), `dropoff`(어디로), `at` | `at`의 서울 날짜 |

- `recipient`: `{ memberId }`(가족 한 사람) 또는 `{ carRef }`('우리 차', `GET /family`의 `cars`에서 고름). 자기 자신·다른 가족·가족 폰이 연결되지 않은 차는 400(`self`·`unknown-recipient`·`unknown-car`). 가족이 없으면 409 `not-in-family`.
- `place`·`pickup`·`dropoff`: `{ text, lat?, lng? }`(글자 100자 + 좌표는 둘 다 있거나 둘 다 없음). **장소 해석은 서버가 하지 않고 받은 대로 담습니다**(해석은 차·다른 묶음).
- `memo`: 한 줄(줄바꿈·연속 공백은 공백 하나로), 100자 이하, 비면 null. 차가 30자 이하면 읽고 길면 '메모가 있어요'만 말하는 것은 차의 몫.
- 날짜는 **오늘·내일(서울)만** 받습니다(일정과 같은 범위, 가안). `at`은 UTC ISO로 정규화해 돌려줍니다.
- 응답 필드(보낸 사람 모양): `id, category, <카테고리 항목>, memo, date, status, createdAt, updatedAt, from: { memberId, name }, to: { kind: 'member', memberId, name } | { kind: 'car', carRef }, reachable, drivingNow, etaStage`. 받은 사람 모양(`received`)은 `drivingNow`·`etaStage`가 없습니다. `reachable`은 받는 사람에게 닿을 곳이 있는가(사람: 폰이 어느 차에 연결돼 있는가, 차: 그 차에 연결된 자리가 있는가) — 거짓이면 그 사람 폰 앱에만 보입니다.
- 차 모양(`GET /requests?driver=`): `id, category, <카테고리 항목>, memo, date, status, createdAt, from: { memberId, name }, via: 'seat' | 'car'`. **`createdAt`은 서버가 요청을 받은 시각**이라 차가 '주행 중에 온 요청은 말하지 않고 다음 탑승에 전한다'(정책서 6장)를 자기 주행 상태와 이 시각으로 판단할 수 있습니다.

## 상태 전이 표

상태 코드: `sent` 보냄 → `delivered` 전달 → `accepted` 수락 \| `declined` 거절 → `completed` 완료. **문구는 클라이언트(폰) 몫**이고 서버는 코드만 줍니다(알림 문구만 서버가 만듦, 아래).

| 카테고리 | `sent` | `delivered` | `accepted` | `declined` | `completed` |
| --- | --- | --- | --- | --- | --- |
| 채비 | → delivered | → completed | (도달 안 함) | (도달 안 함) | 끝 |
| 들르기 · 약속 가기 · 데려다주기·픽업 | → delivered | → accepted, declined, completed | → completed | 끝 | 끝 |

- 차가 PATCH로 바꾸는 값은 `delivered`·`accepted`·`declined`·`completed` 넷이고, `sent`는 만들 때의 상태라 차가 되돌릴 수 없습니다(**400**: 본문 모양·모르는 상태 값·`sent`).
- **표에 없는 전이는 409 `invalid-transition`**(본문에 `from`·`to`): 채비의 수락·거절, 보냄에서 바로 수락·완료(먼저 전달), 끝난 요청(거절·완료)의 모든 변경, 수락 후 거절 등.
- **같은 상태로 다시 보내면 200 + `changed: false`**이고 아무것도 하지 않으며 알림도 없습니다(차의 재시도 안전).
- 채비는 묻지 않고 말만 해서 수락·거절이 없습니다. 나머지는 `delivered → completed`도 됩니다(그 장소에 도착했는데 '응'을 안 했거나 무응답이었던 경우).
- 보낸 사람 폰 문구(정책서 10.10 표 — 폰이 이 표로 정함): 채비 '전달했어요'(`delivered`), 들르기 '수락했어요'(`accepted`) → '들렀어요'(`completed`), 약속 '출발했어요'(`accepted`) → '도착했어요'(`completed`), 픽업 '수락했어요'(`accepted`) → '곧 도착해요'(`etaStage: 'soon'`) → '도착했어요'(`completed`), 거절은 '이번엔 어려워요'(`declined`)만(이유·답장 없음). 보냄 문구는 `drivingNow`가 참이면 '운전 중이라 다음 정차 때 전해요', 아니면 '차에 타면 전해요'.
- 접근: 차는 **그 자리로 온 요청, 또는 이 차의 '우리 차' 요청**만 PATCH·eta 할 수 있습니다. 그 밖(받는 사람이 아닌 차·같은 차의 다른 자리·다른 가족의 요청)은 없는 요청과 같은 **404 `not-found`**입니다.

## 전달 규칙

- **사람에게 보낸 요청**: 그 사람 폰이 연결된 운전자 자리로 갑니다. 차는 `GET /requests?driver=<그 자리>`로 받고, 같은 차의 다른 자리·다른 차에는 안 나옵니다. 연결은 조회 때마다 보므로 나중에 폰이 차에 연결하면 그때부터 그 자리로 갑니다. '그 자리가 지금 운전자로 정해졌을 때만 전한다'는 운전자 판단(5장 2번)이라 차의 몫입니다.
- **받는 사람 폰이 어느 차에도 연결되지 않았으면**: 요청은 그 사람 폰 앱(`GET /requests`의 `received`)에만 보이고 차 조회에는 안 나옵니다(`reachable: false`).
- **'우리 차'**: 가족 폰이 연결된 차 중에서 고르며(`GET /family`의 `cars`), 그 차의 어느 자리로 조회해도 들어 있어 그 차에 다음에 타는 운전자가 받습니다. 그 차에 연결된 가족은 '받은 요청'에서 봅니다(보낸 사람 본인은 보낸 쪽에만).
- **받는 사람 폰에는 알림을 보내지 않습니다**(오늘·가족 탭에만 보임). 알림은 보낸 사람에게만 갑니다.
- 주행 중에 온 요청을 말하지도 칩에 띄우지도 않는 것은 차의 몫입니다. 서버는 요청마다 `createdAt`을 줍니다.

## 알림 (J7 알림함, `family-status`)

보낸 사람의 자리 알림함(`notifier.notify(seatId, { kind: 'family-status', … })`)에 넣습니다. 차에 연결하지 않은 보낸 사람(기기 id만)은 알림함이 없어 건너뛰고 `GET /requests`로 상태를 봅니다.

- **언제**: PATCH로 상태가 **실제로 바뀔 때** `delivered`·`accepted`·`declined`·`completed`(보내기만으로는 없음). 도착 예정 공유를 켠 경우의 5분 전·도착(`eta`).
- 제목 `"{받는 사람 이름}에게 보낸 {카테고리}"`(`우리 차에 보낸 …`), 본문은 상태 문구(`family/phrases.ts`, 가안): `delivered` '전달했어요', `accepted` 약속 '출발했어요'·그 밖 '수락했어요', `declined` '이번엔 어려워요', `completed` 들르기 '들렀어요'·약속·픽업 '도착했어요'·채비 '챙기라고 전했어요', 5분 전 픽업 '곧 도착해요'·약속 '5분 뒤 도착해요'.
- `data`: `{ requestId, category, status }` + 5분 전·도착이면 `stage: 'soon' | 'arrived'`, 5분 전에 `etaAt`(받은 값, UTC ISO)이 있으면 `etaAt`. 폰은 `registerTapHandler('family-status', …)`로 `requestId`의 상태 화면을 엽니다.
- 중복 억제 키 `family-status:<요청 id>:<상태|soon|completed>`: 같은 상태는 한 번. 도착(`arrived`)은 완료와 같은 키라 **eta로 도착을 알린 뒤 완료 PATCH가 두 번째 알림을 만들지 않습니다**.

### 도착 예정 공유와 `eta`

- `PUT /family/share`는 **받는 사람(운전하는 사람)이** 보낸 사람 한 명마다 켭니다(기본 꺼짐). 켠 경우에만 진행 중인 **약속·픽업** 요청의 5분 전·도착이 보낸 사람에게 갑니다. 위치·경로는 보내지 않고, **도착 예정 시각은 알림 `data`로 전달만 하며 저장하지 않습니다**(요청에도 남기지 않음). 보낸 사람 조회의 `etaStage: 'soon'`은 단계일 뿐 시각이 없습니다.
- `POST /requests/:id/eta`: 약속·픽업만(그 밖은 409 `not-eta-category`), 전달·수락 상태만(보냄·끝난 요청은 409 `not-in-progress` — **요청이 끝나면 공유도 끝남**). 공유가 꺼져 있으면 200 `{ notified: false }`로 아무것도 안 합니다. `soon`에만 `etaAt`을 쓸 수 있습니다. `arrived`는 상태를 바꾸지 않습니다(완료는 PATCH). '우리 차'로 보낸 요청은 받는 사람이 사람이 아니라 공유 설정이 없어 늘 `notified: false`입니다.
- `etaStage`는 공유가 켜져 있고 끝나지 않은 요청에서만 `'soon'`, 공유를 끄면 가려집니다.
- **`drivingNow`**(보낸 사람 조회): 요청이 `sent`이고 받는 사람이 보낸 사람에게 도착 예정 공유를 켰고 그 사람의 자리가 지금 주행 중일 때만 `true`. 공유를 안 켰으면 주행 중이어도 늘 `false`라 주행 여부가 새지 않습니다. 차에 연결 안 한 받는 사람·'우리 차'는 늘 `false`.
- `POST /drive-state`: 자리별 마지막 값만(바뀔 때만 바뀐 시각을 새로 함), **그날까지**(날짜가 바뀌면 주행 중이 아닌 것으로 봄), 자리가 지워지거나 폰이 바뀌면 지움. 위치 같은 다른 항목은 400. 보낸 사람 폰의 '운전 중이라 다음 정차 때 전해요'에만 씁니다.

## 보관·정기 작업

- 정책서 11장 '완료되거나 날짜가 지나면 삭제'. **날짜가 지난 요청(서울 날짜)은 읽기·쓰기에서 이미 보이지 않고**(자정이 지나면 정기 작업이 아직 안 돌았어도 조회·PATCH가 404), 정기 작업 `family-requests-expire`(`family/jobs.ts`, J7 스케줄러 `scheduler.register`, `server/src/index.ts`가 등록)가 메모리에서 지웁니다. 같은 작업이 날짜가 지난 주행 상태, 만료된 초대 코드, 30일 쓰지 않은 '기기 id만' 구성원도 정리합니다. 작업은 주입 시계(`now`)로 스스로 판정해 5분마다 불려도 안전하고, 판정은 `createApp({ now })`와 같은 시계로 테스트합니다.
- **완료는 즉시 삭제하지 않고 1시간(`COMPLETED_RETENTION_MS`, 가안) 보관**합니다. 정책서 원문은 '완료되면 삭제'지만 그러면 보낸 사람 폰이 '도착했어요' 상태를 조회할 수 없습니다(알림은 앱이 앞에 있을 때만 폴링해 받음). 거절은 날짜가 지날 때까지 둡니다(보낸 사람이 '이번엔 어려워요'를 볼 수 있게).
- 가족 나가기·연결 끊김으로 식별할 키가 사라진 구성원의 퇴장은 그 사람의 요청을 같이 지웁니다.

## 기존 '일정을 가족에게 보내기'와의 관계

`POST /schedules/:id/family-request`와 픽스처 가족(`fixtures/family/members.json`, `GET /family/members`·`GET /family/requests`)은 폰 3단계 화면과 Maestro가 쓰고 있어 **그대로 동작합니다**(기본 자리·데모 경로, 응답 계약 `status: 'delivered'` 고정). 새 모델에서 이것은 **'약속 가기' 요청의 한 형태**(일정 하나를 가족에게 보내기)입니다: 새 모델의 약속 가기는 `POST /requests`의 `category: 'appointment'`이고 상태가 보냄 → 전달 → 수락(출발했어요) → 완료(도착했어요)로 움직입니다.

내부적으로 같은 저장소를 쓰지는 않았습니다(가능하면 쓰라는 요청을 의식한 판단): 옛 경로의 받는 사람은 실제 가족 구성원이 아니라 픽스처 가족이고, 응답이 `status: 'delivered'` 하나로 고정돼 있으며(받는 쪽이 없는 데모), `GET /schedules/places`의 일정별 `familyRequests`가 자리 데이터(`SeatData.family`)를 읽습니다. 합치면 폰 화면 계약이 바뀌므로, 폰 가족 탭(J10b)이 새 모델로 옮겨 가면 옛 경로를 `POST /requests`의 약속 가기로 대체하고 `SeatData.family`·픽스처 가족을 지웁니다. 새 모델의 받는 사람으로 픽스처 가족 id를 쓰면 400입니다.

## 폰 가족 탭(J10b)이 알아야 할 점

- 가족 기능은 연결 전 폰도 씁니다. 기기 id(`X-Chagok-Device`)가 **꼭 필요**합니다(폰 번들이 `EXPO_PUBLIC_DEVICE_ID=none`이면 식별 없음 401). 토큰이 있으면 토큰이 이깁니다.
- 흐름: `GET /family`(없으면 `family: null`) → 초대(`POST /family/invite`) 또는 참여(`POST /family/join`) → 요청 만들기(`POST /requests`, '우리 차'는 `cars`에서 `carRef`를 고름) → 상태(`GET /requests`, `sent[].status`·`drivingNow`·`etaStage`, 알림 `family-status`의 `requestId`).
- 폰이 계산해야 하는 문구: 상태 코드 × 카테고리(위 표). 보냄 문구는 `drivingNow`, 픽업의 '곧 도착해요'는 `etaStage`.
- `received`에는 `drivingNow`·`etaStage`가 없습니다(내 도착 예정을 누구에게 보여 줄지는 `members[].shareWithThem`과 `PUT /family/share`).
- 연결을 끊거나 앱을 지우면(토큰이 죽고 기기 id만 남음) 같은 기기 id로 가족에 남지만, 앱을 지워 기기 id가 새로 만들어지면 새 폰이라 가족에서 다시 들어가야 합니다(옛 구성원은 30일 뒤 정리).

## 차(C) 쪽 묶음이 알아야 할 점

- 모든 호출은 **차 토큰 + `driver=<자리 id>`**입니다(`driver` 없으면 400, 옛 차 앱 호환 없음). 같은 사람이 탄다고 판단한 자리로 부릅니다.
- 탑승·정차 때 `GET /requests?driver=<자리>&date=<오늘>`로 받습니다(그 자리 몫과 '우리 차' 몫이 함께 옴, `via`로 구분). 끝난 요청은 오지 않습니다.
- 말한 뒤 `PATCH`로 `delivered`, 수락하면 `accepted`, 거절하면 `declined`, 도착·하차 체크에서 말하면 `completed`. 같은 상태 재시도는 안전합니다. 무응답은 상태를 바꾸지 않습니다(다음 정차 때 한 번 더 묻는 것은 차의 몫).
- 주행 시작·멈춤마다 `POST /drive-state`. 약속·픽업은 도착 5분 전에 `POST /requests/:id/eta`(`soon`, 도착 예정 시각을 `etaAt`으로), 도착 시 `arrived`(그 뒤 `completed`). 공유 여부는 서버가 판단하므로 차는 늘 보내면 됩니다.
- 늦을 때 연락의 기본 상대는 요청을 보낸 가족입니다. 요청의 `from`(구성원 id·이름)을 쓰고, 연락 요청(`POST /notify/late`)은 다른 묶음입니다.

## 가안·한계

- 가안(정책서 13장·12장 미결): 초대 코드 24시간, 한 가족 6명, 요청 날짜 오늘·내일, 완료 요청 1시간 보관, 기기 id 구성원 30일, 진행 중 요청 한도(사람 30·가족 100), 가족 300개, 알림 문구. 모두 `family/limits.ts`·`family/phrases.ts` 한 곳입니다.
- 정책서 12장 '들르기 묶는 거리 3km'와 '픽업 곧 도착 알림 5분 전'은 차가 판단하는 값이라 서버에는 상수가 없습니다(차가 5분 전에 `eta`를 부름).
- 저장은 메모리뿐입니다(서버를 다시 켜면 가족·요청·공유·주행 상태가 사라지고, 폰은 `family: null`을 받아 다시 묶어야 함). 영속화할 때는 알림 중복 억제 키(`notifier`)도 같이 영속화해야 합니다(`docs/notifications.md`).
- 보낸 사람이 요청을 취소하는 API는 없습니다(정책서 API 표에 없음).
- 구성원을 다른 구성원이 내보내는 API는 없습니다(나가기만).
- 초대 코드는 인원이 찰 때까지 만료 전에 여럿이 쓸 수 있습니다(위 초대 코드 항목). 요청 주소가 프록시 뒤에서 하나로 보이면 시도 제한·가족 생성 제한이 모든 사용자에게 걸리므로 배포 때 `clientAddress`를 바꿔야 합니다.
- 서버를 `HOST=0.0.0.0`으로 열면 기기 id만 아는 누구나 가족 기능을 쓸 수 있고 인증은 기기 id의 비밀성(22자 이상 난수)에만 의존합니다(연결 전 버킷과 같은 수준). HTTPS가 필요합니다.
