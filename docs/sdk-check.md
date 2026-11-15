# 기획서 × Pleos SDK 구현 가능 여부

- 기준: 차곡 프로덕트 정책서(개발용) 2026-10-28, Pleos 문서 2026-10-29 확인, Emulator v2.1.0 실측
- 판정: ✅ 가능(실측 또는 문서 명시) · 🟡 문서상 가능, 실측 못 함 · ⚠️ 막힘 또는 확인 필요 · ❌ 기획서 가정과 다름

## 차량 신호

| 기획서 항목 | 판정 | 근거와 대안 |
| --- | --- | --- |
| 탑승 = 시동 ON ("Vehicle SDK 전원 상태") | ❌ | Vehicle SDK 19개 도메인에 전원·시동 API가 없다. AAOS `IGNITION_STATE`는 에뮬레이터에서 config가 없어 **미지원**(실측). 시동 ON을 3rd party 앱이 감지하는 공식 방법은 문서에 없음 → Pleos 문의 필요 |
| 정차·주행 (기어, `CarUxRestrictions`) | ✅ | Vehicle SDK가 아니라 AAOS `GEAR_SELECTION`으로 읽는다(실측 P). `CarUxRestrictions` 실측 DO=false. Pleos FAQ가 표준 데이터는 Car API를 쓰라고 안내 |
| 연료 종류 ("Vehicle SDK의 연료 종류") | ❌→✅ | Vehicle SDK에는 없음. AAOS `INFO_FUEL_TYPE`으로 가능(실측: 전기) |
| 주행 가능 거리 ("Vehicle SDK") | ❌→✅ | Vehicle SDK `Odometer`에는 set만 있다. AAOS `RANGE_REMAINING`으로 가능(실측 500km) |
| 남은 에너지 | ✅ | Vehicle SDK `EvBattery.getEvBatteryStateOfCharge` 실측 100%. `Fuel.getFuelPercent`는 EV 에뮬레이터에서 미지원 예외 |
| 위치 (300m 판정) | ✅ | FusedLocation 실측(런타임 권한 필요). 단 SDK 신청 상태가 "준비 중". 지금은 표준 `LocationManager`(`LocationAdapter`)와 내비 `getCurrentLocationInfo`를 함께 쓰고, 실차에서 FusedLocation으로 바꿀 때는 `Locator`만 갈아끼운다(`docs/home-exit.md`) |

## 내비게이션

| 기획서 항목 | 판정 | 근거와 대안 |
| --- | --- | --- |
| 도착과 안내 취소 구분 | 🟡 | `onDestinationArrived`, `onRouteCancelled`가 별도 콜백. 에뮬레이터 내비로는 아직 실측 못 함 |
| 도착 예정 시각 | 🟡 | `RouteStartInfo.duration`, `requestTrip` → `TripInfo.eta`. 주행 중 실시간 갱신 이벤트는 불명(`DrivingInfo` 내용 미확인) |
| "응" → 길안내 | 🟡 | `requestRoute(RouteInfo)`. 결과는 이벤트로 오며 내비 구현에 따라 다를 수 있다고 문서에 명시 |
| 장소 키워드 검색 | ✅(기획서 전제와 일치) | NaviHelper에는 검색 결과를 데이터로 주는 API가 없다(`SearchPlace`는 내비 화면만 띄움). 서버가 외부 API 호출하는 설계가 맞다 |
| 주유소 경유지 `addWaypoint` | ✅ | 경유지 최대 2개 |
| 자주 가는 곳(즐겨찾기·최근 목적지) | ✅ | `getBookmarkInfo`, `getRecentDestinationInfo` 조회만 가능, 쓰기 없음 |

## 음성

| 기획서 항목 | 판정 | 근거와 대안 |
| --- | --- | --- |
| TTS + `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` | ✅ | ON_DEVICE 모드로 재생 완료, 포커스 요청 GRANTED(실측). SDK 신청은 "준비 중" |
| 듣기 8초를 앱이 정함 | ✅ | `request()` 후 앱 타이머로 `stop()` → 마이크가 약 7.5초 뒤 닫힘(로그 실측). 에뮬레이터 마이크 입력이 꺼져 있어 인식 결과는 미확인. `onEndedRecognition` 콜백은 화면에 안 찍힘 → 추가 확인 |
| 생성형 AI 없이 단어 목록 대조 | ✅ | STT는 텍스트만 돌려준다. 설계와 일치 |
| 운전대 음성 버튼·Gleo (확장) | 🟡 | Gleo Interface: 음성 호출 함수 최대 3개, 7초 타임아웃, 스키마 승인 필요 |

## 화면·정책

| 기획서 항목 | 판정 | 근거와 대안 |
| --- | --- | --- |
| 시동 ON 때 카드를 자동으로 띄움 | ⚠️ | 허용 근거 문서 없음. Android 10+는 백그라운드 Activity 시작을 제한. 13장의 "창이 안 보이면 음성만" 대안이 필요할 가능성이 큼 |
| 다른 앱 위에 그리지 않음 | ✅ | 정책과 일치 |
| 외부 서버·외부 API 호출 | ⚠️ | 금지 조항은 못 찾음. 설명회 문의 항목 유지 |
| SDK 신청 | ⚠️ | 콘솔 문서 기준 Vehicle State·NaviHelper만 바로 신청 가능, TTS·STT·FusedLocation은 "준비 중". PT(에뮬레이터)는 가능하나 실차 배포 시점은 확인 필요 |
| 일본어 | — | TTS·STT에 ja-JP 없음. 이번 기획은 한국 한정이라 영향 없음 |

## 폰 앱 (SDK 밖)

| 기획서 항목 | 판정 | 근거와 대안 |
| --- | --- | --- |
| 갤럭시에서 폰 앱이 문자를 바로 보냄 | ⚠️ | Google Play는 SMS 권한을 기본 SMS 앱 등 예외에만 허용. 아이폰처럼 내용이 채워진 문자 창을 여는 방식(`ACTION_SENDTO`)이 안전 |

## 추가 실측 (2026-10-29, Emulator v2.1.0 user 빌드)

- `NaviHelper.requestRoute`는 `pleos.car.permission.NAVI_ROUTE_SEARCH` 권한이 있어야 동작했다(`NAVI_ROUTE`만으로는 부족). 매니페스트에 둘 다 선언한다.
- 이 에뮬레이터(user 빌드)에서는 `inject-vhal-event`로 기어를 바꿀 수 없다. 기어·시동 전환은 디버그 버튼([탑승] 등)이나 단위 테스트로 확인한다.


## 출발 제안 → 길안내 (2026-11-06 구현, 신호 주입으로 확인)

- 권한: `pleos.car.permission.STT_SERVICE`를 더했다. 에뮬레이터 `pm list permissions -f`로 확인한 등급은 NAVI_ROUTE·NAVI_ROUTE_SEARCH·TTS_SERVICE·STT_SERVICE 모두 normal이라 런타임 동의(PermissionGate·권한 설명 카드)는 켜지 않았다.
- 마이크(`RECORD_AUDIO`, dangerous): 넣지 않았다. STT는 CAAS 서비스(`ai.pleos.playground.caas`)가 녹음하고, SpeechToText AAR 매니페스트에도 RECORD_AUDIO가 없다. 2026-10-29 진단에서 이 권한 없이 `request()` 뒤 마이크가 열렸다(로그 실측). 실기기에서 인식이 안 되면 그때 필요 여부를 다시 본다.
- 경로 시작 이벤트: 결과 안내는 `requestRoute`를 내비에 보냈는지(`RouteRequestResult`)로 정한다. `onRouteStarted`·`onRouteCancelled`는 이번 기능의 결과 안내에 쓰이지 않는다. 주행 중 칩은 `DayPlan.target()` 기준이라 경로 이벤트를 쓰지 않고 도착 예정도 넣지 않는다(도착 시각은 내비 몫, `docs/next-chip.md`).

### 미확인 — 수동 확인 필요 (실제 내비·음성이 도는 에뮬레이터·실차)

| 항목 | 확인할 것 | 상태 |
| --- | --- | --- |
| 실제 내비 경로 시작 | 카드에서 "응" 또는 [응, 출발] → 내비 앱이 해당 장소로 안내를 시작하는가. `requestRoute`가 요청만 전달하고 시작 여부는 이벤트로 오므로, 요청이 성공했는데 내비가 시작하지 않는 경우(내비 서버 연결 실패 등)를 앱이 알 수 없다 | 미확인 |
| 실제 음성 인식 | 카드를 읽은 뒤 "응", "잠깐만", "아니", 장소 이름을 말하면 `Event.Heard`로 들어와 판별되는가. 에뮬레이터는 마이크 입력을 켠 상태에서, 서버 모드가 아닌 ON_DEVICE로 | 미확인 |
| 듣기 8초 | 앱 타이머로 8초 뒤 `stop()` → 결과(부분 결과 포함)가 한 번만 전달되는가, `onEndedRecognition` 콜백이 오는가 | 미확인 |
| 듣기 중 오디오 포커스 | 말할 때 잡은 포커스(USAGE_ASSISTANT, MAY_DUCK)를 듣는 동안에도 쥐는가(듣기 종료·결과 전달·중단 때 반납). 듣는 중 다른 앱이 가져가면(LOSS·LOSS_TRANSIENT) 듣기가 즉시 멈추고 결과를 알리지 않는가 | 미확인 |
| 주행 중 Suspend | 시동 OFF 등 Suspend 때 STT가 중단되는가 | 미확인 |
| `requestRoute` 실패 | 내비에 연결된 뒤 요청이 예외 없이 전달되는가, 연결 전(시작·재시작 직후)에는 앱이 요청하지 않고 실패로 안내하는가 | 미확인 |
| 도착 알림 | 차곡이 시작한 길안내로 목적지에 닿으면 `onDestinationArrived`가 오는가(안내 취소 `onRouteCancelled`와 구분되는가). 오면 그 일정이 도착이 되어 다시 탈 때 다음 일정을 묻는가(`docs/arrival.md`) | 미확인 |
| 현재 위치 답 | P단에 넣을 때 `getCurrentLocationInfo()`에 `onCurrentLocationInfo`로 위도·경도가 오는가. 길안내 중이 아닐 때도 오는가 | 미확인 |
| 주행 중 하차 카드 | **사용자 결정(2026-11-15)으로 주행 중 내비 도착 순간에 하차 카드를 바로 띄우고 한 번 말한다(주행 중 카드·말 금지의 유일한 예외).** Pleos 주행 규제(`ActiveRestrictions`)·주행 중 TTS 정책과 충돌하지 않는가, 실차에서 이 시점에 카드·음성이 막히거나 심사에서 문제가 되는가 확인 필요. 막히면 `DriveSession.showExitCard`의 `whileDriving`만 끄면 P단 방식으로 돌아간다(`docs/exit-card.md`) | 미확인 |
| 하차 카드 | 실제 주행 뒤 목적지에서 P단에 넣으면 도착 알림(`onDestinationArrived`)과 P단 신호의 순서가 어떻든 하차 카드가 한 번 뜨는가(알림이 P단보다 늦게 오는 경우 포함). 주차 중 N단·잠깐 다른 곳 정차에서 오탐이 없는가. 15분(`Rules.EXIT_PENDING_MAX`)이 실제 주차 동선에 맞는가(`docs/exit-card.md`) | 미확인 |
| 하차 카드의 말 | 하차 카드를 말하는 TTS가 5초(카드 닫힘) 안에 끝나는가. 말은 30자 이하로 줄였지만 실제 TTS 속도·끊김은 실측 필요 | 미확인 |
| 위치 권한 창 | 위치 권한 설명 카드("현재 위치를 쓸게요.") 뒤 [계속할게요]를 누르면 시스템 권한 창이 Pleos 실차·에뮬레이터에서 뜨는가(`ACCESS_FINE_LOCATION`·`COARSE` 함께 요청). 정확한 위치를 거부하거나 대략 위치만 허용하면 "위치 권한이 없어 위치로 도착을 알 수 없어요…" 한 줄만 보이고 기어·시동·내비 도착은 그대로 동작하는가. 다른 카드(연결·탑승·하차)가 떠 있을 때는 닫힌 뒤에 카드가 보이는가 | 미확인 |
| 실제 측위 주기 | 차곡 화면이 앞에 있을 때 30초·50m 갱신과 수동(passive) 10초·25m 갱신이 실차·에뮬레이터(`adb emu geo fix <경도> <위도>`)에서 실제로 오는가. 화면이 뒤(내비가 앞)일 때 위치가 오지 않는 것이 예상 결과인데, P단에 넣는 순간의 시스템 마지막 위치(`refreshNow`)가 최근 것(30초 이내면 바로, 5분 이내면 내비 답이 없을 때)으로 남아 있는가 없는가. 백그라운드 위치 권한 없이 충분한지 | 미확인 |
| 백그라운드의 위치 | 차곡이 뒤에 있을 때 `LocationManager.getLastKnownLocation`이 값을 주는가(백그라운드 위치 권한 없이). 앱이 뒤로 간 뒤에도 passive 구독이 남아 위치 갱신이 계속 오는지는 `adb shell dumpsys location`(활성 리스너·마지막 위치 요청 시각)로 확인한다. 뒤에서 계속 받으면 리소스·권한 가이드에 어긋나고, 못 받으면 내비 답(`getCurrentLocationInfo`)에만 기대게 된다 | 미확인 |
| 표준 LocationManager 사용 | Pleos에서 서드파티 앱이 표준 `LocationManager`를 써도 되는가(FusedLocation만 허용되는지) Pleos 측에 문의가 필요하다. 허용되지 않으면 `Locator`를 FusedLocation 구현으로만 쓴다 | 미확인 |
| 앱 카테고리 | 위치(도착·집 하차)를 쓰는 차곡이 어느 앱 카테고리(주행 중 위치 사용 가능 범위, 지도·내비 외 앱의 위치 권한)인지 Pleos 앱 카테고리 정의가 필요하다. 가이드가 카테고리별 권한 범위를 정하면 위치 권한을 요청할 수 있는지부터 달라진다 | 미확인 |
| FusedLocation 대체 | 실차에서 `pleos.car.permission.FUSED_LOCATION`(SDK 신청 '준비 중')으로 `Locator`를 대체해도 `LocationChanged(position, ageMillis)` 의미(측위한 지 얼마나 됐는가)를 지킬 수 있는가. 측위 시각을 주지 않는 API면 나이를 0으로 넣어 위치 나이·이번 주행 전 측위 규칙이 무력해지므로 따로 정해야 한다 | 미확인 |
| 위치 도착·집 하차 | 일정 '시작 60분 전 ~ 종료' 창·300m·5분(`Rules.ARRIVAL_WINDOW_LEAD`·`ARRIVAL_RADIUS_METERS`·`LOCATION_MAX_AGE`)과 집 반경 300m(`HOME_RADIUS_METERS`)·30초(`LOCATION_TRUST_AGE`)·정확도 100m(`LOCATION_MAX_ACCURACY_METERS`)가 실제 주차 동선(지하주차장 GPS 오차 포함)에 맞는가. 집을 떠났다 돌아와야 하는 규칙이 실제 귀가에서 오탐·누락을 만드는가(`docs/home-exit.md`) | 미확인 |
| 다시 묻기 | 질문 카드가 30초 무응답으로 접힌 뒤 실제 주행 → 목적지가 아닌 곳 P단에서 재탑승 한 줄이 한 번 뜨고 말하는가. 사람이 없는 채로 주차장 이동·잠깐 정차(마지막 P단 뒤 10분 안)에서 오탐이 없는가. P단에 머문 시간(10분 타이머)이 아니라 '마지막 P단 뒤 10분' 기준이 실제 주차 동선에 맞는가(`docs/reask.md`) | 미확인 |
| 이미 그곳·집이면 집 빼기 | 탑승 신호(앱 진입·시동 ON)에 시스템 마지막 위치(`refreshNow`)가 5분 안으로 남아 있어 '일정 장소 300m 안이면 대상에서 뺌'이 실차·에뮬레이터(`adb emu geo fix`)에서 동작하는가. 정차 중인 차는 `minDistance` 50m 때문에 주기 갱신이 오지 않아 위치가 낡을 수 있고(앞이면 첫 측위만 옴), 그러면 이 판정이 건너뛰어지는 것이 예상 결과다. 지하주차장 GPS 오차(300m 반경)가 맞는지(`docs/target-selection.md`) | 미확인 |
| 일정 겹침 | 겹침 판정(직선거리 ÷ 시속 30km)이 실제 이동(고속도로·시내)에서 오탐·누락을 만드는가, 내비가 일정 A→B 소요 시간을 줄 수 있는지(`requestTrip`은 현재 위치 기준). 카드 문구·버튼 라벨("{일정}으로")이 운전자에게 자연스러운지, "첫 번째"·"두 번째"·일정 이름을 STT가 알아듣는지(`docs/target-selection.md`) | 미확인 |
| 듣는 중 표시 | 음성을 받는 중임을 화면에 알리는 표시. 프로토타입에 듣는 중 표시와 문구가 없어 만들지 않았다. 카드 머리 파형(VoiceIndicator)은 말하는 동안만 움직인다 | 미확인 |

debug 빌드는 `chagok-debug://signal?trip=<초>&route=ok|fail&listen=off&heard=<들은 말>`로 소요 시간·경로 요청 결과·들은 말을 주입한다(자동 E2E용). 위 항목을 사람이 확인할 때는 `trip=real&route=real&listen=real`로 주입을 풀고 실제 내비·STT를 쓴다.
