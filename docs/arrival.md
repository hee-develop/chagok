# 도착 판단 → 다음 일정

PT 핵심 흐름 "탑승 브리핑 → 응 → 길안내 → **도착 → 다음 일정**"의 뒷부분입니다. 차가 대상 일정 장소에 도착하면 그 일정을 '도착'(3장 상태)으로 바꾸고, 다시 탈 때 다음 일정을 한 줄로 묻습니다(5장 재탑승).

## 도착 판단 (`DriveSession`)

다음 둘 중 하나면 도착입니다. 도착한 일정은 다시 대상이 되지 않습니다(`DayPlan.markArrived`).

| 신호 | 언제 도착인가 |
| --- | --- |
| 내비 목적지 도착 알림(`NaviHelperEventListener.onDestinationArrived` → `Event.DestinationArrived`) | 차곡이 길안내를 시작한 일정이 있을 때 그 일정. 출발 제안·늦게 탐의 대상 일정, 여유 많음의 1번 후보(대상 일정 장소)가 해당합니다. 자주 가는 곳으로 간 길안내나 차곡이 시작하지 않은 길안내의 도착은 무시합니다. |
| P단(주행 뒤 P단에 넣음) + 위치 | 대상 일정 장소에서 `Rules.ARRIVAL_RADIUS_METERS`(300m, 기획서 '위치 300m 판정') 안. 주행 중 받은 위치가 있으면 바로 보고, 없으면 내비에 현재 위치를 한 번 묻습니다(`Effect.RequestLocation` → `NaviHelper.getCurrentLocationInfo()` → `onCurrentLocationInfo` → `Event.LocationChanged`). 주행을 시작하면 전에 받은 위치는 버립니다. |

- 위치는 FusedLocation(SDK 신청 '준비 중', 런타임 권한 필요) 대신 내비가 아는 현재 위치를 씁니다. 내비에 연결되지 않았으면 묻지 않고, 그때는 내비 도착 알림만으로 도착을 봅니다.
- 거리는 `LatLng.distanceTo`(대원 거리, haversine)로 잽니다.
- 도착 순간에는 말하지 않고 카드도 띄우지 않습니다. 하차 체크(P단 → 채비)는 2단계 후보입니다.

## 다시 탈 때 (재탑승, 5장)

- 마지막 P단에서 10분 안이면 잠깐 정차라 말하지 않습니다(기존 규칙).
- 10분이 지나 같은 날 다시 타면 다음 대상 일정을 **한 줄**로 묻습니다. 출발 제안이면 "5시 KIA 직관까지 7시간 20분이에요." + "출발할까요?" + [응, 출발]·[잠깐만]입니다.
  - 첫 탑승과 달리 종일 일정 인사("광주 직관 날이에요!"), 오늘 일정 타일, 캘린더 메모는 쓰지 않습니다. 대상 일정에 앱 채비가 있으면 채비 문장과 채비 타일만 둡니다(`docs/care.md`).
  - 늦게 탐·목적지 묻기(여유 많음·장소 모름·일정 없음)도 첫 탑승과 같은 질문을 합니다.
- 전에는 재탑승을 판정만 하고 아무것도 하지 않았습니다. 그 동작을 기대하던 테스트는 새 동작으로 바꿨습니다.

## 시연용 입력 (debug 빌드)

- `chagok-debug://signal?loc=위도,경도`: 내비가 답한 것처럼 현재 위치를 넣습니다. 기어보다 뒤에 처리하므로 `gear=P&loc=…`는 P단 도착 판단의 답이 됩니다.
- `chagok-debug://signal?arrived=true`, 화면의 [도착] 버튼: 내비 목적지 도착 알림을 넣습니다.
- [시간 +10분] 버튼으로 잠깐 정차(10분)를 넘깁니다.

## 검증

- `cd car && ./gradlew :app:testDebugUnitTest`(`DriveSessionTest` 도착·재탑승, `DistanceTest`, `PhrasesTest` 한 줄 카드)
- 계측 E2E(`DepartRouteTest` 내비 도착·P단 위치 도착 뒤 다시 탐, `BoardingBriefingTest` 같은 날 두 번째 탑승)
- `pnpm e2e:car`의 `arrival-next.yaml`(PT 장면 4: 육전집 도착 → KIA 직관 한 줄 → 경기장 100m 앞 P단 도착 → 콩물 픽업 한 줄)
- 실제 내비 도착 알림·위치 답은 `docs/sdk-check.md` 수동 확인 목록입니다.
