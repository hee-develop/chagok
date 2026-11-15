# 차곡

일정은 폰에서 읽고, 판단은 차에서 한다. Pleos Connect 차량 앱 + 폰 앱(RN) + 서버로 이루어져 있습니다.

## 지금 되는 것 (2026-11-15, 에뮬레이터 기준)

발표용 프로토타입입니다. 외부 서비스는 목 데이터로 돌고, 키를 주면 실제 호출로 바뀌는 어댑터만 열어 두었습니다(아래 '목으로 대신하는 것').

### 폰 앱

- **첫 설정(5단계)**: 캘린더 고르기(실제 Android 캘린더 또는 목) → 자주 가는 곳(집·회사·그 밖) → 장소 빈 일정 채우기 → 말 거는 방법(플러스 모드·늦을 때 연락) → 차 화면 QR이나 6자리 번호로 차와 연결
- **아래 탭**: 오늘 · 장소 · 가족 · 설정. 오늘 탭에서 오늘 일정, 알림함, 받은 가족 요청, 장소 빈 일정을 본다
- **가족 탭**: 초대 코드로 가족 묶기, 요청 4종(약속 가기·픽업·채비·들르기) 보내기, 보낸 요청의 상태, 도착 예정 공유 스위치
- **설정 탭**: 플러스 모드 · 늦을 때 연락 · 화면 없이 음성만 스위치, 차 연결 끊기
- **장소 탭**: 자주 가는 곳 추가·삭제, 기억한 장소, 이동 없음 목록
- **연락 상대 찾기**: '늦을 때 연락'을 켜면 일정의 참석자·제목에서 폰 연락처의 상대를 찾아 표시 이름만 서버로 보낸다(번호·이메일은 폰 밖으로 나가지 않음)
- **일정 보내기**: 앱을 열 때·앞으로 올 때 고른 캘린더의 오늘·내일 일정을 서버로 보낸다. 온라인 회의·건물 안 일정은 폰에서 걸러 보내지 않는다([이동 일정이에요]로 되돌릴 수 있음)
- **일정별 장소**: 장소 검색으로 고르기, 서버가 기억한 장소를 '여기 맞아요'로 확정, 채비 한 줄, 가족에게 보내기('전달됨')
- **이동 없음 기억**: 일정을 [이동 없음]으로 두면 같은 이름 일정을 앞으로 차에 보내지 않는다. 장소 탭에서 목록을 보고 지운다
- **알림**: 서버 알림함을 폴링해 폰 로컬 알림으로 보인다(Expo Go라 푸시 대신). 일정이 오래 안 왔을 때 등

### 차량 앱

- **폰과 연결**: 정차 중 QR·6자리 카드. 한 차에 폰 여러 대, 폰마다 운전자 자리
- **탑승 브리핑**: 오늘 일정과 채비를 읽고 "출발할까요?"를 묻고, "응"이면 길안내를 시작한다. 늦었으면 같이 묻고, 일정이 없거나 여유가 많으면 자주 가는 곳을 후보로 보인다
- **다시 묻기·대안**: 대답이 없으면 달린 뒤 다음 P단에서 한 번 다시 묻고, "다른 데"라고 하면 다음 후보를 보인다
- **일정 겹침**: 두 일정이 겹치면 어디로 갈지 묻는다
- **도착 → 다음 일정**: 내비 도착 알림이나 달린 뒤 P단 + 일정 장소 300m 안이면 도착으로 보고, 다시 타면 다음 일정을 한 줄로 묻는다
- **주행 중**: 말하지 않고 다음 일정 칩 한 줄만 보인다
- **하차 카드**: 일정 장소에 도착해 P단에 넣으면 "도착 · 내리기 전" 카드를 한 번 말하고 5초 뒤 닫는다(채비·메모가 있으면 챙길 것을 알린다)
- **집 하차**: 집을 떠났다 돌아와 집 300m 안에서 P단에 넣으면 "콩물 챙기세요!" 또는 "오늘도 수고했어요."를 한 번 말한다
- **시연 도구(debug 빌드)**: 가짜 길안내 지도, 신호 주입(`chagok-debug://signal`), `pnpm demo:car`·`pnpm demo:pt`

### 서버

- 차 연결(자리·토큰), 캘린더 선택, 폰 일정 수신, 오늘 일정(`/schedules/today`), 자주 가는 곳
- 장소 검색·장소 확정(`/places/resolve`)·장소 기억, 이동 없음 기억(`/skips`)
- 알림함, 설정(`/settings`), 에너지 후보(주유소·충전소), 가족 묶기·요청·상태·도착 예정 공유
- 도착 횟수 → 자주 가는 곳 후보, 오래된 자리 정기 정리
- 데이터는 메모리에 두어 서버를 다시 켜면 비워진다

### 목으로 대신하는 것

| 기능 | 지금 | 실제 호출로 바꾸려면 |
| --- | --- | --- |
| 장소 검색 | `fixtures/places/` 목 장소 | 서버 환경 변수 `KAKAO_REST_KEY`(카카오 로컬 API). 실제 키로는 확인하지 않음 |
| 주유소·충전소 | 목 데이터 | 오피넷·환경부 키. 실제 키로는 확인하지 않음 |
| 폰 푸시 | 폴링 + 로컬 알림 | FCM(개발 빌드 필요) |
| 길안내·음성 인식 | debug 신호 주입, 가짜 길안내 | 실제 Pleos 내비·음성(`docs/sdk-check.md`의 수동 확인 목록) |

### 아직 안 됨

- 차: 운전자 바꾸기, 장소 이름을 묻고 고르는 대화, 에너지 체크, 늦을 때 연락, 플러스 모드·음성만, 가족 요청 받기(서버 쪽은 있음). 폰에서 보낸 가족 요청은 차가 받기 전까지 '보냄' 상태에 머문다
- 폰: 늦을 때 연락의 문자 창
- 남은 작업의 자세한 목록은 [docs/remaining-work.md](docs/remaining-work.md)
- 서버 배포(HTTPS) · DB 저장, 아이폰

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
- 장소는 `fixtures/places/mock-places.json`(검색 대상)과 `suggestions.json`('캘린더에서 자주 나온 곳' 고정 추천)이 단일 출처입니다. `GET /places/search?q=`(이름·주소 부분 일치, 최대 10개, q 50자 상한, 빈 q는 400), `GET /places/suggestions`, `GET /places/favorites`(`{ home, work, others, revision }`), `PUT /places/favorites/home`·`/work`(`{ placeId|null }` 또는 외부 검색 결과의 장소 스냅숏 `{ place }`), `POST /places/favorites/others`(`{ placeId }` 또는 `{ place }`), `DELETE /places/favorites/others/:id`(단골 삭제, 없으면 404, 집·회사는 건드리지 않음)를 둡니다. 쓰기 요청은 자리 하나만 바꾸고 전체 상태를 돌려주며, 같은 장소가 다른 자리에 있으면 서버가 옮깁니다. others 최대 20, 이미 추가한 장소·모르는 id는 400이고 `revision`은 서버가 올립니다. 차량 앱은 `GET /schedules/today`의 `favorites`(집 → 회사 → 추가한 순서)로 받아 '어디로 갈까요?' 후보로 씁니다([목적지 후보 문서](docs/destination-candidates.md)).
- 장소 검색·기억(`server/src/placeSearch/`, `server/src/placeMemory.ts`): `PlaceSearch` 포트가 키워드·주소 검색을 하고 기본은 픽스처 목, `KAKAO_REST_KEY`가 있으면 카카오 로컬 API(짧은 캐시·본문까지 거는 타임아웃·요청 주소별 속도 제한, 실패는 빈 후보 + `source: "unavailable"`, 같은 실패 로그는 10분에 한 줄)입니다. 외부로는 검색어(50자)와 소수 3자리로 줄인 현재 위치만 나가고 일정 제목은 나가지 않습니다(검색어 `query`와 기억 키 `key` 분리). `POST /places/resolve`(차: `query`·`key`·현재 위치 → 기억·가까운 후보 2개·`total`)·`PUT /places/memory`(차: 이름 → 장소, 애매 여부, 요청 주소별 분당 30회)·`GET /places/memory`·`DELETE /places/memory?name=`(폰)을 두고, **이 API는 옛 차 앱 호환 규칙을 쓰지 않아** 차 토큰은 `driver=`가 필수이고 식별 없는 요청은 자리 있는 차가 없을 때만 기본 자리, 그 밖에는 저장하지 않는 빈 범위입니다. **실제 자리(연결된 자리·연결 전 버킷)에서는 목 검색·목 장소 완전 일치를 쓰지 않고**(기본 자리와 `FIXTURE_SEATS=1`만 목, 키가 없으면 검색은 `unavailable`) 일정 장소는 보정 → 자리 기억 → 목 완전 일치 → `suggestion` 순입니다. 기억은 자리별로 쌓이고(연결된 자리 200개·연결 전 버킷 20개, 넘으면 오래된 것부터 버림) 연결을 끊으면 지워지고 폰을 바꿔도 남으며, 애매한 기억은 확정하지 않고 `suggestion`(`source: "memory"`, `ambiguous: true`)으로 내립니다. 카카오 결과는 장소 스냅숏으로 자주 가는 곳·일정 보정에 저장할 수 있습니다. 계약·자리 정하기 표·8장 대응표·환경 변수·미확인은 [장소 검색·기억 문서](docs/place-resolve.md)를 따릅니다.
- `PUT /events`(폰이 오늘·내일 일정 전체를 교체. 본문 1MB·일정 200개·필드 길이 상한, 시각은 오프셋 있는 ISO8601, 오늘·내일(서울) 밖 일정은 거름)와 `GET /events?date=YYYY-MM-DD`(저장값 확인)를 둡니다. `DELETE /events`(같은 기기 요청만, 개발·데모용)는 폰 일정을 비워 픽스처 출처로 되돌립니다. 폰이 한 번이라도 일정을 보냈으면 `/schedules/today`·`/schedules/places`는 그 일정(선택 캘린더 필터·서울 날짜 규칙·3단계 보정 적용)을 쓰고, 한 번도 안 보냈으면 지금처럼 픽스처를 씁니다(데모·차량 E2E 경로). 선택은 `source`(`mock`|`device`)를 함께 저장하며 일정 출처와 같을 때만 적용합니다. 폰 일정의 장소는 목 장소 이름과 정규화해 완전히 같을 때만 좌표를 확정하고, 일부만 겹치거나 지난번 기억(제목)과 맞으면 `suggestion`(확인 필요)으로만 내립니다. 폰은 일정을 보내기 전에 온라인·건물 안 일정을 걸러 보내지 않고(종일은 이름만), 서버는 같은 판정(`server/src/noTravel.ts`)을 안전망으로 유지합니다(종일은 서버도 거르지 않음). "이동 일정이에요"로 바꾼 이름의 일정에는 `travelConfirmed: true`가 붙어 안전망을 건너뜁니다. 같은 이름을 '이동 없음'으로 기억하는 `GET·PUT /skips`(자리별 일정 이름 목록, 장소 해석과 같은 엄격한 자리 규칙: 차는 차 토큰 + `driver=`)가 있고, 서버는 그 이름의 일정을 차량 응답에서 빼며(`noTravelReason: 'skipped'`) 폰도 그 이름의 일정을 서버로 보내지 않고 흐리게 보입니다. 우선순위는 일정별 장소 보정 > 이동 없음 기억 > 온라인·건물 안 자동 판정 > 장소 기억·일정 장소이고, 일정에 장소를 넣으면 그 이름의 기억이 지워집니다. 폰은 3단계·오늘 탭의 '이동 없음'을 이름으로도 기억하고(안내와 10초 되돌리기) 장소 탭의 `SkipList`로 목록을 보고 지울 수 있습니다. 날짜가 지난 일정은 읽을 때·교체할 때 지웁니다. **주의**: 폰 앱을 8787 서버에 붙이면 데모·차량 E2E가 폰 일정을 받으니 `GET /events`의 `receivedAt`이 null인지 확인하고(값이 있으면 `curl -X DELETE http://127.0.0.1:8787/events`), `HOST=0.0.0.0`으로 열 때는 `EVENTS_LOOPBACK_ONLY=1`을 함께 주세요. 계약은 [폰 캘린더 연결 문서](docs/calendar-sync.md)를 따릅니다.
- 도착 횟수·자주 가는 곳 후보(서버만): `POST /arrivals`(차 토큰 + `driver`, `{ scheduleId?, place: { name, lat, lng, address? }, at? }`)가 그 자리의 장소별 도착 횟수를 +1합니다(이름 정규화가 같고 100m 안이면 같은 곳, 같은 날 같은 일정은 한 번만, 장소·횟수·마지막 날짜만 저장, 자리당 100곳). `GET /places/frequent`(차)는 폰에서 등록한 집·회사·단골과 도착 횟수가 3회를 넘은 곳(4회부터)을 합쳐 도착 횟수 많은 순으로 주고(`lat`·`lng`가 집 반경 300m 안이면 집을 뺌), `GET /places/arrivals`·`DELETE /places/arrivals/:id`(폰)로 보고 지웁니다. `GET /schedules/today`의 `favorites`에도 같은 정렬이 반영되며 항목 모양은 그대로이고 3회를 넘은 곳이 없으면 이전 응답과 같습니다. 옛 차 앱 호환 읽기는 적용하지 않습니다. 계약은 [도착 횟수 문서](docs/arrivals.md)를 따릅니다.
- 운전자 자리: 한 차에 폰 여러 대를 연결하고(`Car`·`Seat`, 폰 한 대 = 자리 하나, 이름은 폰 기기 이름) 일정·캘린더 선택·장소 보정·채비·자주 가는 곳·가족 요청을 자리별로 나눠 둡니다(메모리 저장). 폰은 연결 때 받은 폰 토큰(`expo-secure-store`)을 `Authorization: Bearer`로 붙이고, 차는 `driver=<seatId>`와 차 토큰으로 그 자리의 일정을 읽습니다. 토큰 없이 기기 id(`X-Chagok-Device`)만 보내는 폰은 그 기기의 연결 전 버킷을, 식별이 전혀 없는 요청은 '기본 자리'(픽스처·데모·차량 E2E 경로)를 씁니다. 연결할 때는 그 폰의 버킷만 새 자리로 옮겨집니다. API는 `POST /pair/code`(차, 새 자리·바꿀 자리, 5분)·`POST /pair/claim`(폰)·`GET /pair`·`DELETE /pair`(폰 연결 끊기)·`GET /drivers`·`PUT /drivers/selected`·`POST /presence`·`DELETE /car`(차곡 초기화)이고, 현재 차 앱이 쓰는 `/pairing/*`는 그대로 둡니다. 6자리 코드는 요청 주소별로 시도를 제한합니다. 서버 정기 작업(`server/src/jobs.ts`)이 서울 새벽 04:00 이후 하루 한 번 모든 자리·연결 전 버킷의 날짜 지난 일정(과 딸린 보정·채비)을 지우고 30일 동안 일정이 안 온 자리를 지웁니다(`NOTIFY_SCHEDULER=0`이면 스케줄러째 꺼짐). 폰의 연결 끊기는 `pairingApi.disconnect`가 토큰과 폰 로컬 상태(알림함·일정 보내기 기억·거른 일정)를 한 번에 비웁니다(확인 화면은 설정 화면 몫). 계약은 [차–폰 연결 문서](docs/pairing.md)를 따릅니다.
- `POST /energy/options`(차가 부름)는 `{ fuel, origin, destination, stayMinutes?, at? }`로 전기차는 2시간 이상 머무는 일정이면 목적지 500m 안 빈 완속 충전기, 아니면 경로상 휴게소 급속 충전(식사 시간대면 `mealBundle`), 내연·하이브리드는 경로 3km(출발→목적지 선분 근사) 안 최저가 주유소를 최대 5개 정렬해 줍니다. 어댑터는 기본이 `fixtures/energy/` 목이고 `EV_CHARGER_KEY`(환경부)·`OPINET_KEY`(오피넷)가 있으면 실제 호출하며, 전부 실패하면 빈 후보 + `source: "unavailable"`, 일부만 실패하면 받은 결과 + `partial: true`로 답하고, 같은 주소에서 분당 20회를 넘으면 429입니다. 실제 키를 쓰는 서버를 `HOST=0.0.0.0`으로 열 때의 주의는 에너지 문서에 있습니다. 계약·근사 규칙·미확인 항목은 [에너지 후보 문서](docs/energy.md)를 따릅니다.
- 폰 알림: 서버가 자리(폰)별 알림함에 알림을 쌓고(`notify(seatId, { kind, title, body, data, dedupeKey? })`, 종류는 `events-stale`·`late-sms`·`family-status`, 자리당 50개·3일·같은 `dedupeKey` 한 번) 폰이 `GET /notifications?since=`로 폴링하고 `POST /notifications/ack`로 지웁니다(폰 토큰 필요, 토큰이 없으면 빈 목록). 폰 앱이 Expo Go라 원격 푸시를 못 받아서, 앱이 앞에 있는 동안 60초마다 폴링해 `expo-notifications` 로컬 알림으로 띄우고 받은 알림은 폰 알림함(`useInbox`)에도 쌓습니다(권한 거부 시 홈에만 보임, 백그라운드 폴링은 한계). '일정을 못 받고 있어요'는 그 폰이 일정을 보내면(서버 `PUT /events`) 서버 알림함에서 지워지고, 폰도 일정 동기화가 성공했거나 일정을 보낼 수 없는 상태(캘린더 권한 꺼짐·캘린더 미선택)면 띄우지 않습니다(이유는 홈이 `useEventSendBlock()`으로 안내). 서버를 다시 켜면 자리(연결)도 메모리라 알림이 재발송되지 않습니다. 마지막 일정 수신 24시간 뒤 서울 저녁 8시에 하루 한 번 '차곡이 일정을 못 받고 있어요'를 넣는 정기 작업은 서버 프로세스의 작은 스케줄러(`NOTIFY_SCHEDULER=0`이면 끔)가 돌립니다. `FCM_SERVICE_ACCOUNT_FILE`을 주면 FCM HTTP v1 보내기도 붙지만 기본은 꺼짐이고 실제 FCM과는 확인하지 않았습니다. 계약은 [폰 알림 문서](docs/notifications.md)를 따릅니다.
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

라우트는 `phone/src/app/`(Expo Router)에 있고, 첫 설정 1단계는 `src/features/calendar-select/`, 2단계 '자주 가는 곳'(`setup/places`, 장소 검색 `setup/place-search`)은 `src/features/places/`입니다. 3단계(`setup/fill-places`, `src/features/fill-places/`)는 선택한 캘린더의 일반 일정을 보여 주고 장소 검색·저장과 이동 없음을 지원합니다. 원본 캘린더 대신 서버에 일정별 보정값을 저장하며 차량용 일정 응답에도 반영됩니다. 4단계(`setup/pair-car`)는 차 화면의 QR이나 6자리 번호로 차와 연결합니다(연결하지 않고 [건너뛰기]해도 됩니다). 자세한 계약과 범위는 [장소 채우기 문서](docs/fill-places.md)를 참고해 주세요. 4단계에서 [건너뛰기]나 [완료]를 누르면 폰 저장소에 '첫 설정 끝냄' 표시가 남고, 앱을 열면 **아래 탭 네 개(오늘·가족·장소·설정, `src/app/(tabs)/`)** 로 들어갑니다(처음이면 1단계로 갑니다). 오늘 탭은 알림함(읽지 않은 알림)·꺼진 권한 안내(맨 위, 알림 권한 거부와 일정을 보낼 수 없는 이유 포함)·차 연결 상태(`GET /pair`)·오늘 일정(이동 없음은 흐리게, 폰이 거른 일정도 같은 확인·되돌리기로 이동 일정으로 바꿈)·장소 빈 일정을 보이고, 일정을 누르면 그 자리에서 3단계와 같은 컴포넌트로 장소·채비·가족 보내기를 합니다. 장소 탭은 자주 가는 곳과 기억한 장소(목록·지우기)를 보입니다. 구성과 상태 5종, 다음 묶음이 이어 붙일 곳은 [폰 탭·오늘 화면 문서](docs/phone-home.md)를 참고해 주세요. 요청 10초 제한(`requestWithTimeout`)은 `src/api/request.ts`를 두 기능이 같이 쓰고, revision 시계는 캘린더만 씁니다(2단계의 revision은 서버가 매깁니다). 캘린더는 `CalendarSource` 인터페이스 뒤에 두고, `EXPO_PUBLIC_CALENDAR_SOURCE=mock|device`로 고릅니다(기본 device = 실제 Android 캘린더를 `expo-calendar`로 읽음, 권한을 거부하면 목으로 넘어가지 않고 허용 안내만 보임. mock은 테스트·E2E용). 캘린더 기본 체크는 소유·편집 가능 캘린더만이고 읽기 전용(공휴일·구독)은 해제됩니다. 일정은 앱이 앞에 있는 동안 3분마다 다시 읽고, 온라인·건물 안 일정은 폰에서 걸러 3단계에 흐리게 보이며(눌러서 확인한 뒤 '이동 일정이에요'로 바꾸면 같은 이름은 다음부터 보내고 10초 동안 '되돌리기'를 보임, 같은 이름을 '이동 없음'으로 기억한 일정도 같이 걸러 흐리게 보이며 '이동 일정이에요'는 그 기억을 지움: `src/features/skips/`, 예외 이름은 `@react-native-async-storage/async-storage`) 판정 함수는 `@chagok/server/no-travel`을 서버와 같이 씁니다. 폰 앱은 Android·iOS 네이티브만 대상으로 하며 웹 타깃은 없습니다(`.pnpmfile.cjs`가 `react-dom` peer를 제거합니다).

### E2E (Android)

`pnpm e2e:phone`은 AVD `Pixel_10_Pro_XL`을 `-port 5556`(`emulator-5556`)으로 띄우고(이미 떠 있으면 그대로 사용), Expo Go를 설치한 뒤 서버(기본 8788)와 Metro(기본 8082)를 띄웁니다. 기기의 `127.0.0.1`에 두 포트를 `adb reverse`로 잇고 앱은 `exp://127.0.0.1:<Metro>`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:<서버>`로 접속합니다. `pnpm e2e:phone`은 Metro를 `EXPO_PUBLIC_CALENDAR_SOURCE=mock`으로 띄웁니다. 이어서 `e2e/maestro/phone/calendar-select.yaml`, `places.yaml`(2단계 직접 진입), `fill-places.yaml`(3단계 직접 진입), `pair-car.yaml`(4단계 직접 진입, 연결한 뒤 [완료]로 오늘 탭의 연결 상태까지 확인)을 차례로 실행합니다. 서버는 기본 일정 `fixtures/schedules/gwangju-day.json`(장소가 빈 일반 일정 '친구 약속'·'치과')을 읽으며, `E2E_FIXTURE_PATH`로 바꿀 수 있습니다. `E2E_FLOWS=fill-places`처럼 실행 범위를 선택할 수 있습니다. 아래 탭·오늘 화면 flow(`today-tabs.yaml`)는 기본 목록에 없고 `E2E_FLOWS=today-tabs pnpm e2e:phone`으로 따로 돌립니다(오늘 일정이 시각에 흔들리지 않게 기준 시각이 고정된 `fixtures/schedules/pt-day.json`을 스크립트가 기본으로 씁니다). 끝나면 서버·Metro·이 스크립트가 만든 reverse 규칙·스크립트가 띄운 에뮬레이터를 정리합니다. 다른 작업이 쓰는 에뮬레이터·포트와 겹치지 않게 `E2E_AVD`, `E2E_ANDROID_PORT`, `E2E_METRO_PORT`, `E2E_SERVER_PORT`로 바꿔 돌릴 수 있습니다(reverse 규칙이 이미 있는 포트는 쓰지 않고 멈춥니다). `emulator-5554`(Pleos 차량 에뮬레이터)는 건드리지 않습니다.

- 스크린샷: `.e2e-shots/phone/<flow 이름>/` (`E2E_SHOT_DIR`로 변경. 저장소 루트 아래만 허용)
- flow는 KIA 선택 저장 전후로 `GET /schedules/today`에 `KIA vs 두산`이 없다가 생기는지도 확인합니다
- fill-places flow는 이동 없음, 지난번 장소 '여기 맞아요', 장소 검색·변경, 차량 응답의 좌표·일정 제외, 4단계 '말 거는 방법'의 스위치 저장과 5단계 이동, 복귀 후 복원을 검증합니다. Gboard 필기 입력은 테스트 중만 끄고 종료 시 원래 설정으로 돌립니다.
- places flow는 서버의 `GET /places/favorites`로 집·추가 장소 저장도 확인합니다. Maestro `assertVisible`·`tapOn` 글자는 정규식 전체 일치라 `[ ] ( ) +`는 `\`로 막습니다
- 실제 기기 캘린더 flow는 기본 목록에 없고 `E2E_FLOWS=device-calendar pnpm e2e:phone`으로 따로 돌립니다(항상 마지막에 실행). `scripts/seed-phone-calendar.sh`로 에뮬레이터에 로컬 캘린더·일정을 심고 Metro를 device 출처로 다시 띄우며, 끝나면 심은 캘린더를 지웁니다. 이 flow는 장소 칸이 Zoom인 온라인 일정(`E2E Online Standup`)이 서버로 가지 않고 3단계·오늘 탭에 '이동 없음'으로 흐리게 보이는지도 확인합니다.
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

빌드 없이 써 보려면 [Releases](https://github.com/hee-develop/chagok/releases)의 차량 앱 debug APK(`chagok-car-debug-*.apk`)를 받아 `adb -s emulator-5554 install -r <파일>`로 설치한다.
이 APK는 같은 PC의 서버(`http://10.0.2.2:8787`, 에뮬레이터에서 본 PC)에만 붙으므로 서버(`pnpm demo:pt server` 또는 `pnpm server:dev`. 폰을 연결한 뒤에도 목 일정으로 시연하려면 서버를 `FIXTURE_SEATS=1`로 띄운다. `demo:pt server`는 이미 그렇다)를 먼저 띄운다.
PT 시연 순서(폰 → 차 연결 → 브리핑 → 도착)와 점검 명령(`pnpm demo:pt check`)은 `docs/pt-demo.md`에 있다.

## 테스트

| 종류 | 명령 | 필요한 것 |
| --- | --- | --- |
| 서버 단위 | `pnpm server:test` | |
| 타입체크 | `pnpm typecheck` | |
| 차량 앱 단위(JVM) | `pnpm car:test` 또는 `cd car && ./gradlew :app:testDebugUnitTest` | |
| 차량 앱 계측 E2E | `cd car && ANDROID_SERIAL=emulator-5554 ./gradlew :app:connectedDebugAndroidTest` | 에뮬레이터. 가짜 신호·가짜 STT·가짜 내비·고정 시계(09:20)·픽스처 일정을 쓰므로 서버는 필요 없다 |
| 차량 앱 Maestro E2E | `pnpm e2e:car` | 에뮬레이터, [Maestro](https://get.maestro.mobile.dev) |
| 차량 앱 터미널 시나리오 | `pnpm demo:car` | 에뮬레이터, debug 앱(`DEMO_INSTALL=1`로 설치). 단계마다 기대 로그와 비교 |

- `pnpm e2e:car`는 debug 앱 설치 → 서버(watch 없이 `tsx src/index.ts`, 8787) 시작 → `e2e/maestro/car/pairing.yaml`, `boarding-briefing.yaml`, `depart-route.yaml`, `arrival-next.yaml`, `fake-navi.yaml`(debug 전용 가짜 길안내) 순서로 실행 → 서버 종료(프로세스 그룹째)를 한다. 에뮬레이터 시간대를 서울로 잠시 바꿨다가 되돌린다(원래 값이 비어 있었으면 UTC로 두고 비운다). 스크린샷은 실행마다 새로 만드는 `e2e/output/car/<실행 시각>/shots/`(git 제외)에 남는다. `E2E_FRESH_INSTALL=1`을 주면 앱을 지우고 설치한 상태로 돈다. 기기가 여럿이면 `ANDROID_SERIAL`을 지정한다. 8787이 이미 쓰이고 있으면 `PORT=8790 pnpm e2e:car`처럼 포트를 바꾼다(서버와 debug 앱 모두 그 포트로 맞춘다). 이렇게 돌린 뒤에는 설치된 debug 앱이 그 포트를 기억하므로, 기본 서버(8787)로 직접 확인하기 전에 `./gradlew :app:installDebug`로 다시 설치한다. Gradle로 직접 설치할 때도 `ANDROID_SERIAL`을 꼭 지정한다(없으면 연결된 모든 기기에 설치된다).
- 일정 데이터는 `fixtures/schedules/gwangju-day.json`(프로토타입 '광주 직관 하루')이고, 기본값은 저장소 루트의 `fixtures/` 아래 이 파일이다. `FIXTURE_PATH`로 바꿀 수 있고, 절대 경로는 그대로, 상대 경로는 작업 폴더가 아니라 **저장소 루트 기준**으로 읽는다(예: `FIXTURE_PATH=fixtures/schedules/gwangju-day.json`). 형식이 틀리면(place의 lat·lng 숫자, memo·locationText 문자열 또는 null, attendees 문자열 배열) 서버가 시작할 때 오류로 멈춘다. 서버가 시작할 때 읽어 `GET /schedules/today?at=<ISO8601>`로 내려준다. 차량 앱 단위·계측 테스트도 같은 파일을 읽는다.
- debug 빌드에만 신호 주입 통로가 있다. `adb shell am start -a android.intent.action.VIEW -d "chagok-debug://signal?gear=D"`처럼 `now`(ISO8601, 데모 시계·초기화), `gear`(P·R·N·D), `ignition`, `restricted`, `enter`, `board`를 줄 수 있다. 출발 제안 → 길안내용으로 `trip`(소요 시간 초, `none`=모름, `real`=실제 내비), `route`(`ok`·`fail`·`real`: 길안내 요청 결과), `listen`(`off`면 실제 STT를 열지 않음), `heard`(들은 말, 퍼센트 인코딩)도 준다. 이 값들은 debug 빌드에만 있고 release에는 없다. 실제 내비 경로 시작과 음성 인식은 사람이 따로 확인한다(`docs/sdk-check.md`). debug 빌드만 평문 HTTP로 `10.0.2.2:8787`(PC의 서버)에 붙는다.
- **가짜 길안내(debug 전용)**: 실제 내비를 쓸 수 없을 때(회사망 등) 시연·E2E에서 쓴다. `navi=fake`(또는 디버그 줄의 [가짜 내비])를 주면 차곡 창 안에 직접 그린 곡선 도로 지도와 길안내 패널이 나오고, 수락하면 가짜 경로를 따라 차가 달려 스스로 도착한다(도착 알림이 세션에 들어가 도착 판단·주행 중 칩이 이어지고, 정차하면 하차 카드가 뜨며 그동안 지도 덮개가 72%로 더 어두워진다). `drive=<초>`는 경로를 지나가는 실제 시간(기본 4.5초), `progress=<0~1>`은 진행률을 바로 옮기고, `advance=<분>`은 데모 시계를 앞으로 보낸다. debug 빌드는 기본이 켬이고(앱을 새로 설치·재시작해도 지도가 보인다) `navi=real`로 실제 내비·실제 위치로 돌린다. release 빌드에는 들어가지 않는다. 자세한 내용은 [가짜 길안내 문서](docs/fake-navi.md).
- **터미널 시나리오**: `pnpm demo:car`가 가짜 내비로 출발 제안 → 길안내 → 주행 → 도착 → 하차 카드 → 재탑승 한 줄 → 위치로 도착을 단계마다 신호로 넣고, debug 빌드가 `ChagokFlow` 태그로 남기는 흐름 로그를 기대 동작과 비교해 ✓/✗로 알려 준다(에뮬레이터 필요, `DEMO_AUTO=1`이면 Enter 없이 진행).
