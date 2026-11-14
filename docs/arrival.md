# 도착 판단 → 다음 일정

PT 핵심 흐름 "탑승 브리핑 → 응 → 길안내 → **도착 → 다음 일정**"의 뒷부분입니다. 차가 대상 일정 장소에 도착하면 그 일정을 '도착'(3장 상태)으로 바꾸고, 다시 탈 때 다음 일정을 한 줄로 묻습니다(5장 재탑승).

## 도착 판단 (`DriveSession`)

다음 둘 중 하나면 도착입니다. 도착한 일정은 다시 대상이 되지 않습니다(`DayPlan.markArrived`).

| 신호 | 언제 도착인가 |
| --- | --- |
| 내비 목적지 도착 알림(`NaviHelperEventListener.onDestinationArrived` → `Event.DestinationArrived`) | 차곡이 길안내를 시작한 일정이 있을 때 그 일정. 출발 제안·늦게 탐의 대상 일정, 여유 많음의 1번 후보(대상 일정 장소)가 해당합니다. 자주 가는 곳으로 간 길안내나 차곡이 시작하지 않은 길안내의 도착은 무시합니다. |
| P단(주행 뒤 P단에 넣음) + 위치 | 오늘 일정 중 **'시작 60분 전 ~ 종료' 창 안**이고 장소에서 `Rules.ARRIVAL_RADIUS_METERS`(300m, 기획서 '위치 300m 판정') 안인 것(여럿이면 시작 시각이 지금과 가까운 것). **이번 주행(D·R) 시작 뒤에 측위했고 5분 이내인 위치**만 씁니다. 내비 도착 대기가 있는 P단에서도 위치로 다른 일정의 도착을 기록합니다(카드는 먼저 기다린 것 하나, 뒤 도착은 기록만). P단 직전 30초 안에 측위한 어댑터 위치(`LocationAdapter`)는 바로 쓰고, 그보다 오래됐거나 없거나 멀면 내비에 현재 위치를 한 번 묻고 그 답을 우선합니다(`Effect.RequestLocation` → `NaviHelper.getCurrentLocationInfo()` → `onCurrentLocationInfo` → `Event.LocationChanged`, 나이 0). 계약과 바뀐 점은 [`docs/home-exit.md`](home-exit.md). |

- 위치는 위치 어댑터(표준 `LocationManager`, 런타임 위치 권한, 실차는 FusedLocation으로 교체 예정)와 내비가 아는 현재 위치를 함께 씁니다(`docs/home-exit.md`). 위치 권한이 없고 내비에 연결되지 않았으면 위치 판정은 빠지고 내비 도착 알림만으로 도착을 봅니다.
- 거리는 `LatLng.distanceTo`(대원 거리, haversine)로 잽니다.
- 도착 알림 순간에는 말도 카드도 없습니다. 도착이 기록된 뒤 P단에 넣으면 하차 카드("도착 · 내리기 전")를 한 번 보입니다(`docs/exit-card.md`). 두 도착 경로 모두 `DriveSession.arrive` 한 곳을 지나며 거기서 하차 대기를 세웁니다.

## 다시 탈 때 (재탑승, 5장)

- 마지막 P단에서 10분 안이면 잠깐 정차라 말하지 않습니다(기존 규칙).
- 10분이 지나 같은 날 다시 타면 다음 대상 일정을 **한 줄**로 묻습니다. 출발 제안이면 "5시 KIA 직관까지 7시간 20분이에요." + "출발할까요?" + [응, 출발]·[잠깐만]입니다.
  - 첫 탑승과 달리 종일 일정 인사("광주 직관 날이에요!"), 오늘 일정 타일, 캘린더 메모는 쓰지 않습니다. 대상 일정에 앱 채비가 있으면 채비 문장과 채비 타일만 둡니다(`docs/care.md`).
  - 늦게 탐·목적지 묻기(여유 많음·장소 모름·일정 없음)도 첫 탑승과 같은 질문을 합니다.
- 전에는 재탑승을 판정만 하고 아무것도 하지 않았습니다. 그 동작을 기대하던 테스트는 새 동작으로 바꿨습니다.

## 시연용 입력 (debug 빌드)

- `chagok-debug://signal?loc=위도,경도`: 방금 측위한 위치를 넣습니다(넣은 동안 어댑터의 실제 위치는 무시, `loc=real`로 해제). 기어보다 뒤에 처리하므로 `gear=P&loc=…`는 P단에서 내비에 물은 답이 됩니다. 시간 창(60분 전)은 `advance=<분>`으로 시계를 앞으로 보내 맞춥니다(`docs/home-exit.md`).
- `chagok-debug://signal?arrived=true`, 화면의 [도착] 버튼: 내비 목적지 도착 알림을 넣습니다.
- [시간 +10분] 버튼으로 잠깐 정차(10분)를 넘깁니다.

## 검증

- `cd car && ./gradlew :app:testDebugUnitTest`(`DriveSessionTest` 도착·재탑승, `DriveSessionExitCardTest` 하차 카드, `DistanceTest`, `PhrasesTest` 한 줄 카드)
- 계측 E2E(`DepartRouteTest` 내비 도착·P단 위치 도착 뒤 다시 탐, `BoardingBriefingTest` 같은 날 두 번째 탑승)
- `pnpm e2e:car`의 `arrival-next.yaml`(PT 장면 4: 육전집 도착 → KIA 직관 한 줄 → 경기장 100m 앞 P단 도착 → 콩물 픽업 한 줄)
- 실제 내비 도착 알림·위치 답은 `docs/sdk-check.md` 수동 확인 목록입니다.
