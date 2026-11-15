# 남은 작업 목록 (2026-11-15 기준)

다른 세션·계정이 이어받아 구현할 수 있게 정리한 목록입니다. 묶음 하나가 PR 하나입니다.

## 먼저 알아 둘 것

- **목적은 발표용 프로토타입**입니다. 정책서(`~/Downloads/chagok.xml`, 2026-11-12판)의 흐름이 시연에서 보이면 됩니다. 외부 서비스(카카오 로컬, 오피넷·환경부, FCM, 문자, 실제 내비·음성)는 **목 데이터로 대신해도 됩니다.** 이미 있는 키 기반 어댑터는 그대로 둡니다.
- **자동 E2E(Maestro·계측·데모 스크립트)는 돌리지 않습니다.** 화면 확인은 사용자가 직접 합니다. 검증은 아래까지만 합니다.
  - 서버: `pnpm typecheck`, `pnpm server:test`
  - 폰: `pnpm phone:test`, `pnpm --filter @chagok/phone lint --max-warnings 0`
  - 차: `cd car && ./gradlew :app:testDebugUnitTest :app:compileReleaseKotlin`
- 범위는 MVP + 2단계입니다. 아이폰, '캘린더에 장소 적기'는 하지 않습니다.
- 작업은 `.claude/worktrees/<이름>` 워크트리에서 하고, 브랜치 → PR → 스쿼시 병합합니다. 저장소 루트 체크아웃(`backup/overnight-final`)은 건드리지 않습니다.
- 차량 묶음은 거의 모두 `car/…/flow/DriveSession.kt`, `flow/Phrases.kt`, `domain/BoardingDecider.kt`를 고칩니다. **동시에 여러 개를 진행하면 충돌하므로 아래 순서대로 하나씩** 합니다.
- 신호 주입·평문 HTTP는 `car/app/src/debug`에만 둡니다. 주행 중에는 말·카드·듣기가 없어야 합니다(C8의 플러스 모드만 예외).
- 정한 숫자(가안)는 해당 문서(`docs/*.md`)에 '가안·사용자 확인 필요'로 적습니다.

## 시작 조건

앞선 묶음(차량 다시 묻기·일정 겹침 #37, 설정·연락 상대 #36, 가족 탭 #38)은 모두 main에 들어갔습니다. 아래 묶음은 바로 시작할 수 있습니다.

## 서버·폰

### J9. 늦을 때 연락: 서버 중계 + 폰 문자 창
- 정책: 9장 '보내기'·문자 내용, 10.6, 11장 `POST /notify/late`, 불러 준 번호는 저장하지 않음.
- 서버: 새 `server/src/routes/notify.ts`. 차가 보낸 요청(상대 표시 이름 또는 번호, 일정, 늦는 분)을 저장하지 않고 기존 알림함(`/notifications`)으로 그 자리의 폰에 전달합니다. 가드는 다른 새 API처럼 엄격한 자리 가드(`placeRead`/`placeWrite`, 차 토큰은 `driver=` 필수).
- 폰: 알림을 누르면 `phone/src/features/contacts/findNumber.ts`의 `findNumberByDisplayName`으로 번호를 찾아 `expo-sms`의 문자 창을 내용을 채워 엽니다. 번호가 직접 온 경우 그대로 씁니다. 번호를 못 찾으면 받는 사람 없이 창을 엽니다. Expo Go라 문자를 바로 보내지는 못합니다.
- 결정(가안): 차는 "{이름}에게 보냈어요." 대신 "폰으로 보냈어요. 폰에서 보내기를 눌러 주세요."라고 말합니다.

## 차량 (이 순서대로)

### C1a. 운전자 판단·바꾸기 칩·자리별 일정
- 정책: 5장 2·3, 6장 운전자 모름, 10.1 운전자 판단 ①~④·칩·메모 안 읽기.
- 서버 API(이미 있음): `GET /drivers`, `PUT /drivers/selected`, `POST /presence`, 차 토큰 + `driver=<seatId>`로 `/schedules/today` 등 읽기.
- 할 일: 새 `runtime/DriverSignals`(Pleos 프로필·BT 핸즈프리·폰 신호 포트, 기본값은 모두 '모름', debug 신호 `driver=…`로 주입), 새 `domain/DriverResolver.kt`, `flow/ServerScheduleSource.kt`가 자리를 지정해 받고 자리별 사본을 둠, 운전자 바꾸기 칩, 운전자를 모르면 "어디로 갈까요?".
- 같이 닫을 것: 옛 차 앱 호환 읽기(`legacyDriverFallback`)를 더 쓰지 않게 차가 항상 차 토큰 + `driver=`를 보내도록 합니다.
- 실제 BT·프로필은 `docs/sdk-check.md`의 수동 확인 목록에 적습니다.

### C1b. 차 설정 화면: 폰 연결·차곡 초기화
- 정책: 10.1 연결 순서, 10.9 차곡 초기화, 12장 QR 5분.
- 할 일: 차 설정 화면(폰 연결: 새 운전자·폰 바꾸기, 차곡 초기화 → 서버 `DELETE /car` + `ChagokStore`의 사본·기록 삭제). `flow/PairingController.kt`, `MainActivity.kt`, `ui/`.

### C4. 차에서 장소 해석 대화
- 정책: 5장 6·11, 6장 장소 애매·없음·못 찾음, 7장 후보 고르기·이동 없음, 8장.
- 서버 API(이미 있음): `POST /places/resolve`(`{query, key?}`), `PUT /places/memory`, `PUT /skips?driver=`.
- 할 일: 장소 빈 일정이면 장소를 묻고 → 들은 말을 검색어로 resolve → 후보 타일과 "어느 쪽이에요?" → 고르면 기억 → 같은 카드에서 출발 제안으로 이어짐. "안 가요"류는 이동 없음으로 기억. 후보가 0개면 폰의 '장소 빈 일정'에 남깁니다.
- 결정(가안): 장소 질문일 때만 '4어절 초과는 차 안 대화로 무시' 규칙을 풀고 들은 말을 통째로 검색어로 씁니다. 장소 검색은 목 데이터(`fixtures/places/`)로 충분합니다.

### C7. 늦을 때 연락 (차 쪽)
- 정책: 5장 7c, 6장 늦게 탐, 7장 이름·번호, 9장, 12장 010 11자리. J9 필요.
- 서버가 주는 것: `/schedules/today`의 `settings.lateContact`, 일정별 `contacts`(표시 이름 0~2개).
- 할 일: 늦게 탔을 때 `lateContact`가 꺼져 있으면 늦는다는 말만, 켜져 있으면 "{이름}에게 연락할까요?"(후보 둘이면 고르기, 없으면 "누구에게 연락할까요?" → 이름 또는 번호 → 번호는 복창) → `POST /notify/late`.

### C8. 플러스 모드·화면 없이 음성만
- 정책: 6장 주행 중 늦어짐, 10.8, 12장 지연 알림 1회.
- 서버가 주는 것: `settings.plusMode`, `settings.voiceOnly`.
- 할 일: 플러스 모드면 주행 중 늦어질 때 한 번 말함(주행 중 말하기 예외는 한 곳에만), `voiceOnly`면 카드를 띄우지 않고 말만 합니다. 늦음 판단은 debug 신호로 주입해도 됩니다.
- 끝나면 `pleos-guide-checker`로 주행 규제 점검을 권합니다.

### C9a. 가족 요청 받기·브리핑·수락/거절
- 정책: 5장 4d·9b, 6장 가족 요청, 10.10.
- 서버 API(이미 있음): `GET /requests?date=&driver=`, `PATCH /requests/:id`.
- 할 일: 일정과 함께 요청을 받아 탑승 브리핑에서 전하고("가족 요청이 N개 있어요"), 수락·거절을 서버에 알립니다.

### C9b. 약속·픽업을 대상 일정으로, 도착 완료·도착 예정·주행 상태
- 정책: 10.10 약속 가기·데려다주기·픽업·완료·도착 예정 공유, 12장 5분 전.
- 서버 API(이미 있음): `POST /requests/:id/eta`, `POST /drive-state`.
- 할 일: 수락한 약속·픽업을 일정처럼 대상에 넣고, 도착하면 완료, 5분 전이면 도착 예정을 알리고, 주행 시작·끝을 서버에 알립니다.

### C9c. 들르기 묶기·가족 채비 하차
- 정책: 5장 8b, 6장 가족 요청 하차, 10.10 채비·들르기, 12장 3km.
- 할 일: 경로 3km 안의 들르기 요청을 길안내에 묶어 제안하고, 하차 카드에서 가족이 부탁한 채비를 알립니다.

### 도착 횟수 보내기 (작음, 아무 차량 묶음에 끼워도 됨)
- 일정 장소에 도착하면 `POST /arrivals?driver=`를 부릅니다. 같은 일정은 한 번만 세고, 재시도할 때는 처음의 `at`을 그대로 보냅니다.

## 끝난 뒤

- README의 '지금 되는 것'을 갱신하고, 차량 앱 debug APK를 새로 빌드해 GitHub 릴리스에 올립니다(`cd car && ./gradlew :app:assembleDebug`).
