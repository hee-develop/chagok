# 폰 알림 (서버 알림함 + 폰 폴링 + 로컬 알림)

정책서 10.6 '폰 알림'·10.4 '알림' 권한·11장 '푸시' 문장의 구현입니다. 폰 앱이 Expo Go라 **원격 푸시(FCM)를 받을 수 없어서**, 서버가 자리(폰)별 알림함에 알림을 쌓고 폰이 서버를 폴링해 로컬 알림과 폰 알림함(홈 표시용)으로 대신합니다. 환경 변수로 켜는 FCM 보내기는 같은 포트의 두 번째 구현으로 있고 **기본은 꺼짐**입니다.

## 구조

```
서버 안의 코드 ── notify(seatId, { kind, title, body, data, dedupeKey? }) ──▶ Notifier ──▶ PushSender[]
                                                                              ├─ Outbox(기본, 자리별 메모리 큐) ◀── GET /notifications ◀── 폰 폴링
                                                                              └─ FcmSender(환경 변수 있을 때만)  ──▶ FCM HTTP v1
정기 작업 스케줄러(scheduler.ts) ── 'events-stale' 작업 ──▶ notify
```

- 포트 `PushSender`(`server/src/notify/types.ts`): `send(seatId, notification)`, `forget(seatId)`. 알림 하나는 모든 보내는 곳에 간다.
- `Notifier.notify(seatId, input)`(`notifier.ts`)가 **다른 묶음이 쓰는 서버 내부 함수**다. id·시각을 붙이고 중복 억제 키를 보고 `PushSender`에 나눠 준다. 결과는 `{ ok: true, id }` 또는 `{ ok: false, reason: 'duplicate' | 'invalid' }`이고, 보내는 곳이 던져도(비동기 포함) `notify`는 끝난다.
- `createApp({ notifications })`: 알림 묶음(`createNotifications({ now, extraSenders })` → `{ notifier, outbox }`)을 받는다. 없으면 인스턴스마다 만든다. 서버 프로세스(`index.ts`)는 `createNotificationRuntime`으로 알림 묶음과 스케줄러를 한 번에 만들어 같은 `notifier`를 앱과 정기 작업이 나눠 쓴다.
- 자리가 지워지거나(연결 끊기·차 초기화) 폰이 바뀌면(replace) `notifier.forget(seatId)`로 **그 자리의 알림함·중복 억제 기록·푸시 토큰을 버린다**. 옛 폰이 읽지 않은 알림은 새 폰에 넘기지 않는다. 새 자리를 만들 때(claim)는 아무것도 지우지 않는다.

## 알림 모양과 종류

`{ id, kind, title, body, data, createdAt }`

| 필드 | 설명 |
| --- | --- |
| `id` | 십진수 문자열. 시각(밀리초 × 1000) 위에서 호출마다 늘어나 서버를 다시 켜도 줄지 않는다(폰의 `since`가 계속 맞는다) |
| `kind` | 아래 표 |
| `title`·`body` | 제목은 비어 있으면 안 됨(100자), 본문 400자까지(넘으면 잘라 담음) |
| `data` | 문자열 → 문자열(FCM `data`와 같은 모양). 10개까지, 키 40자·값 200자 |
| `createdAt` | ISO8601 |

| `kind` | 언제 | 누르면 | 상태 |
| --- | --- | --- | --- |
| `events-stale` | 마지막 일정 수신 24시간 뒤, 서울 저녁 8시, 하루 한 번(정책서 10.6) | 앱이 열리며 일정 동기화를 한 번 부른다 | 이번 묶음에서 만든다 |
| `late-sms` | 늦을 때 연락 → 내용이 채워진 문자 창(정책서 10.6 '문자를 보내 주세요') | 문자 창 | 종류만 정의. 만드는 곳은 늦을 때 연락 묶음(J9) |
| `family-status` | 가족 요청 전달·수락·거절·완료, 5분 전(정책서 10.6) | 그 요청의 상태 화면 | 종류만 정의. 만드는 곳은 가족 묶음(J10) |

모르는 `kind`로 `notify`하면 `invalid`다. 새 종류는 `NOTIFICATION_KINDS`에 더한다.

## 한도

| 이름 | 값 | 설명 |
| --- | --- | --- |
| `MAX_QUEUE_PER_SEAT` | 50 | 자리 하나의 큐. 넘으면 가장 오래된 것부터 버림 |
| `NOTIFICATION_TTL_MS` | 3일 | 읽어 가지 않아도 이만큼 지나면 읽을 때 버림 |
| `MAX_LIST_SIZE` | 50 | `GET /notifications` 한 번에 주는 수(오래된 것부터) |
| `DEDUPE_TTL_MS` | 2일 | 같은 `dedupeKey`를 다시 만들지 않는 시간. **읽거나 지운 뒤에도** 유지 |
| `MAX_DEDUPE_KEYS_PER_SEAT` | 100 | 자리 하나가 기억하는 키 수(넘으면 가장 오래된 키부터 잊음) |
| `MAX_ACK_IDS` | 100 | `POST /notifications/ack` 한 번에 지우는 id 수 |

중복 억제 키 예: `events-stale:2026-11-15`(같은 날 같은 종류 한 번). 큐·키는 메모리라 서버를 다시 켜면 비워진다.

## API

폰 토큰(`Authorization: Bearer`)으로만 읽는다. 기기 id·`driver`·차 토큰·기본 자리는 쓰지 않는다. 오류 본문은 `{ error, reason? }`.

### `GET /notifications?since=<id 또는 시각>`

- 그 자리의 알림 중 `since`보다 **나중에 만든 것**을 오래된 것부터 `{ notifications: [...], limit: 50 }`으로 준다. `since`는 알림 id(숫자) 또는 오프셋이 있는 ISO8601이고 생략하면 전부다. 모양이 틀리면 400.
- **토큰이 없으면(연결 전·기기 id만) 빈 목록 200**이다. 모르는 토큰·이상한 Authorization 형식은 401(`withSessionReset`이 토큰을 버리고 같은 요청을 토큰 없이 다시 보내 빈 목록이 된다).

### `POST /notifications/ack`  `{ ids: string[] }`

- 그 자리의 이 알림들을 지운다(읽음 처리). `{ acked: <지운 수> }`. **다른 자리의 id는 무시**한다. 토큰이 없으면 `{ acked: 0 }` 200, 모르는 토큰은 401, `ids`가 id 문자열 100개 이하 배열이 아니면 400.

## '차곡이 일정을 못 받고 있어요' (`events-stale`)

`server/src/notify/eventsStale.ts`의 `runEventsStaleCheck({ seats, notifier, now })`:

- **서울 시각 20:00 이상 22:00 미만**일 때만 판정한다(`EVENTS_STALE_HOUR`, `EVENTS_STALE_WINDOW_MS`).
- 기준 시각 = `max(마지막 일정 수신 lastEventsAt, 연결 시각 pairedAt)`. 지금과 **24시간 이상** 벌어진 자리에 알림을 넣는다(`EVENTS_STALE_AFTER_MS`, 정확히 24시간이면 넣고 23시간 59분 59초면 안 넣는다). 연결한 지 24시간이 안 된 자리·폰 바꾸기 직후 자리에는 넣지 않는다.
- 하루 한 번은 중복 억제 키 `events-stale:<서울 날짜>`가 막는다(같은 날 몇 번 판정해도 한 번, 읽어 가서 지운 뒤에도 한 번). 일정을 다시 받으면 기준 시각이 바뀌어 멈춘다. 다음 날 저녁에 다시 24시간이 지나 있으면 다시 넣는다.
- 알림: 제목 '차곡이 일정을 못 받고 있어요', 본문 '앱을 열면 일정을 새로 보내요.', `data: { action: 'resend-events' }`.
- 실행은 시계를 주입할 수 있다(`now`). 테스트는 `createApp({ now })`와 같은 시계를 쓴다.

## 스케줄러 (`server/src/scheduler.ts`)

- `createScheduler({ now, intervalMs = 5분, onError })`. `register({ name, run(now) })`로 작업을 더하고, `start()`가 `setInterval` 하나를 켜고(`unref`라 프로세스 종료를 막지 않음) `stop()`이 끈다. `tick()`은 등록된 작업을 한 번 차례로 돈다(도는 중이면 겹쳐 돌지 않고 그 실행을 기다린다). 한 작업이 던져도 다음 작업은 돈다(`onError`에는 작업 이름과 오류만).
- 작업은 `now`를 받아 **스스로 '이번에 할 일인가'를 판정**하고 자주 불려도 안전해야 한다.
- **시작은 서버 프로세스(`server/src/index.ts`)만 한다.** `createApp`·`createNotificationRuntime`은 타이머를 켜지 않으므로 테스트에서는 꺼져 있다. `NOTIFY_SCHEDULER=0`이면 서버도 켜지 않는다.
- 등록된 작업은 지금 `events-stale` 하나다. 정책서 11장의 나머지 정기 작업(새벽에 지난 일정·날짜 지난 가족 요청 삭제, 30일 동안 일정이 안 온 자리 삭제)은 **J6**가 `createNotificationRuntime`이 돌려주는 `runtime.scheduler.register(...)`로 더한다(`index.ts`에서 `runtime.scheduler`를 쓰면 된다). 모든 자리를 훑는 `SeatStore.allSeats()`를 이번에 더했다.

## 폰 (`phone/src/features/notifications/`)

| 파일 | 역할 |
| --- | --- |
| `poller.ts` | `createNotificationPoller().poll()`: 서버 알림함을 한 번 본다. 앱을 열 때·앞으로 올 때·앞에 있는 동안 `POLL_INTERVAL_MS`(60초)마다 |
| `useNotifications.ts` | 앱 루트(`_layout.tsx`)에서 부르는 훅. AppState를 보고 앞에 있을 때만 타이머를 돌리고, 뒤로 가면 멈추고 알림 누름을 듣는다 |
| `inbox.ts` | 폰 알림함 저장소와 **`useInbox()` 훅**(`{ items, unreadCount, loaded, markRead, markAllRead, dismiss }`). AsyncStorage(2.2.0)에 저장 |
| `localNotifier.ts` | `expo-notifications` 포트(권한·로컬 알림 띄우기·누름 듣기) |
| `permission.ts` | `askNotificationPermission()`(첫 설정 끝에 한 번 묻기), `getNotificationPermission()`, `clearNotificationInbox()` |
| `taps.ts` | 알림 누름 처리. 종류별 처리기 등록(`registerTapHandler(kind, fn)`) |
| `keyValue.ts` | AsyncStorage 래퍼(이 폴더 안의 작은 래퍼. 앱 공용 저장소는 다른 묶음이 둔다) |

- **폴링 규칙**: 폰 토큰이 없으면 서버에 묻지 않는다(`no-session`). **동시에 하나만** 돈다(도는 중에 다시 부르면 같은 실행의 결과를 받고 요청을 하나 더 보내지 않음). 요청은 기존 10초 제한(`requestWithTimeout`)을 쓰고, `stop()`(훅이 내려갈 때)으로 취소된 요청의 **늦은 응답은 알림함·시스템 알림에 반영하지 않으며 ack도 안 한다**. 실패하면 다음 주기에 다시 한다.
- **흐름**: `GET /notifications?since=<알림함이 아는 마지막 id>` → 새 알림만 폰 알림함에 담음(이미 있거나 마지막 id 이하는 건너뜀) → 알림 권한이 `granted`면 시스템 알림으로 띄움 → 받은 알림을 `POST /notifications/ack`로 서버에서 지움(실패해도 마지막 id 때문에 다시 띄우지 않음).
- **알림 권한(정책서 10.4)**: **첫 설정 끝**에 묻는다. 지금은 첫 설정의 마지막 화면인 `/setup/pair-car`의 [완료](`phone/src/app/setup/pair-car.tsx`)가 `askNotificationPermission()`을 부른다(아래 맨 위 탭 구조가 들어오면 거기서 부른다). 한 번 물은 뒤에는 창 없이 현재 상태만 돌려주고, 거부해도 던지지 않는다.
- **거부하면 '홈에만 보임'**: 권한이 `granted`가 아니면 시스템 알림은 띄우지 않고 **알림은 폰 알림함에만 쌓인다**. 홈 화면은 `useInbox()`로 맨 위에 보여 주면 된다(홈 UI는 이 묶음 범위 밖). 권한이 있어도 알림은 알림함에 똑같이 쌓인다. 폰 알림함은 50개·7일.
- **알림 누름**: `events-stale` → 기존 일정 동기화(`appEventSync.run()`)를 한 번 부르고 알림을 읽음으로 하고, 보냈으면(`sent`·`unchanged`) 알림함에서 지운다. 다른 종류는 처리기를 등록하는 쪽(J9·J10)이 `registerTapHandler('late-sms', ...)`처럼 더한다. 모르는 종류나 처리기가 던져도 조용히 넘어간다. 앱이 꺼져 있다가 알림으로 열렸다면 마지막 응답을 한 번 꺼내 전한다.

## Expo Go의 한계 (SDK 58, 공식 문서로 확인)

| 기능 | Expo Go(Android) | 이 구현 |
| --- | --- | --- |
| 로컬 알림(`scheduleNotificationAsync`, 트리거 `null`/채널) | **된다**("local notifications remain available in Expo Go") | 서버 알림함을 폴링해서 로컬 알림으로 띄운다 |
| 원격 푸시(FCM·Expo Push) | **안 된다**(SDK 53부터 Android Expo Go에서 쓸 수 없음, 개발 빌드 필요) | 쓰지 않는다. FCM 보내기는 꺼진 채로 있다 |
| 앱이 꺼져 있거나 뒤에 있을 때 받기 | 폴링은 앞에 있을 때만 돈다(백그라운드 폴링 없음) | **한계**: 앱을 다시 열거나 앞으로 오면 그때 알림을 받는다. 홈 알림함이 이를 보완한다 |
| Android 13+ 알림 권한 창 | 채널을 먼저 만들어야 창이 뜬다(문서) | 권한을 묻기 전에 채널 `chagok-default`를 만든다 |
| 앞에 있을 때 알림 | 핸들러가 `shouldShowBanner`를 켜야 뜬다. Android는 `shouldPlaySound: false`면 배너가 안 뜬다(문서) | 핸들러가 배너·목록·소리를 켠다(채널 기본 소리를 따른다) |

- 패키지를 가져오기만 해도 Android Expo Go의 개발 빌드에서는 `[expo-notifications] Push notifications ... are unavailable in Expo Go` 경고(console.warn)가 한 번 나온다(패키지 자체 동작, 크래시 아님: `node_modules/expo-notifications/build/DevicePushTokenAutoRegistration.fx.js`). 푸시 관련 API(`getDevicePushTokenAsync` 등)는 Android Expo Go에서 던지므로 쓰지 않는다.
- `app.json`에 `expo-notifications` 플러그인을 `enableRemoteNotifications: false`로 넣었다(로컬 알림만 쓸 때의 설정, iOS의 APNs 권한 항목을 넣지 않는다). 개발 빌드로 FCM을 받을 때는 `true`(기본)로 되돌린다. 이 값은 새 바이너리를 만들어야 반영된다.
- 아이폰 전용 동작(문자 알림을 누르면 문자 창)은 범위 밖이다.

## FCM 전환 방법과 미확인

켜는 법(서버): `FCM_SERVICE_ACCOUNT_FILE=<서비스 계정 JSON 키 경로>`(+ 선택 `FCM_PROJECT_ID`)를 주면 `index.ts`가 `FcmSender`를 알림 묶음에 붙인다. 키 내용은 서명에만 쓰고 로그·오류 메시지에 싣지 않는다. 변수가 없으면 만들지 않는다.

- 요청 조립은 `buildFcmRequest`(네트워크 없음, 테스트로 고정): `POST https://fcm.googleapis.com/v1/projects/{project}/messages:send`, `Authorization: Bearer <OAuth2 접근 토큰>`, 본문 `{ message: { token, notification: { title, body }, data: { …문자열만, id, kind }, android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: 'chagok-default' } } } }`.
- 접근 토큰은 서비스 계정 JWT(RS256, 범위 `https://www.googleapis.com/auth/firebase.messaging`)를 `https://oauth2.googleapis.com/token`에 `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`로 보내 받고 만료 1분 전까지 다시 쓴다(`createServiceAccountTokenProvider`).
- 실패 로그는 HTTP 상태와 FCM 오류 이름(`UNREGISTERED` 등)만 남기고, `UNREGISTERED`(404)면 그 자리의 푸시 토큰을 버린다.
- **이 저장소의 FCM 구현은 실제 FCM 서버와 통신해 확인하지 않았다(미확인).** 아래도 미확인이다.
  - 폰이 기기 푸시 토큰을 서버에 등록하는 경로가 **없다**. Expo Go에서는 토큰을 얻을 수 없어서다. `PushTokenRegistry`(자리 → 토큰)는 메모리 저장소만 있고 채우는 API가 없으므로 지금 FCM을 켜도 보내지는 곳이 없다. 개발 빌드로 전환하는 묶음에서 `getDevicePushTokenAsync` → 서버 등록 API(자리에 묶임, 자리 삭제·폰 바꾸기 때 삭제)를 더해야 한다.
  - Firebase 프로젝트·`google-services.json`·개발 빌드 설정은 이번에 하지 않았다.
  - 공식 `Message` 문서가 `token` 필드를 'deprecated'로 표시한다(`fid` 같은 다른 대상 필드가 있음). 이 문서에서 대안의 정확한 의미와 `token`의 지원 종료 일정은 확인하지 못했다. 전환할 때 다시 본다.
  - 예전 'FCM 서버 키'(legacy HTTP API)는 쓰지 않는다. 그 폐지 일정은 이번에 읽은 공식 페이지에서 확인하지 못했다.
  - `android.notification.channel_id`는 앱이 먼저 만들어야 한다(문서). 폰 개발 빌드가 `chagok-default` 채널을 만들어야 한다(지금도 로컬 알림을 위해 만든다).

확인한 공식 문서:

- Expo SDK 58 Notifications: https://docs.expo.dev/versions/v58.0.0/sdk/notifications/ (Expo Go 로컬 알림 지원·푸시 미지원, 핸들러·권한·채널·응답 리스너)
- FCM HTTP v1 `projects.messages.send`: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send (주소·`validate_only`·`message`·OAuth 범위)
- FCM `Message`: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages (`data` 문자열 맵, `notification`, `android.priority/ttl/notification.channel_id`)
- FCM 오류 코드: https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode (`UNREGISTERED` 404 등)
- FCM 서버 요청 인증: https://firebase.google.com/docs/cloud-messaging/auth-server (`Authorization: Bearer <access_token>`, 서비스 계정)
- Google OAuth2 서비스 계정(HTTP/REST): https://developers.google.com/identity/protocols/oauth2/service-account#httprest (JWT 헤더·클레임·토큰 주소·`grant_type`)

## 이어 붙일 지점

- **J6(정기 작업)**: `createNotificationRuntime`의 `scheduler.register({ name, run(now) })`로 새벽 삭제·30일 정리를 더한다. 자리를 지울 때 `SeatStore`가 `removed` 이벤트를 내면 알림함도 저절로 비워진다.
- **J9(늦을 때 연락)·J10(가족)**: `notifier.notify(seatId, { kind: 'late-sms' | 'family-status', ... , dedupeKey })`로 알림을 넣고, 폰에서 `registerTapHandler(kind, ...)`로 누름 처리(문자 창·요청 상태 화면)를 더한다. `notifier`는 `createApp`에 넘긴 `notifications.notifier`다(`index.ts`는 `runtime.notifications`).
- **J5a(홈)**: `useInbox()`로 맨 위에 알림을 보이고, `getNotificationPermission()`으로 꺼진 권한 안내('켜면 이게 돼요')를 보인다. 첫 설정 끝 화면에서 `askNotificationPermission()`을 부른다(지금은 `/setup/pair-car`의 [완료]). 차 연결을 끊거나 폰을 바꿀 때 `clearNotificationInbox()`를 부른다.
