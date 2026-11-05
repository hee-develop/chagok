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
| 위치 (300m 판정) | ✅ | FusedLocation 실측(런타임 권한 필요). 단 SDK 신청 상태가 "준비 중" |

## 내비게이션

| 기획서 항목 | 판정 | 근거와 대안 |
| --- | --- | --- |
| 도착과 안내 취소 구분 | 🟡 | `onDestinationArrived`, `onRouteCancelled`가 별도 콜백. 회사망에서는 에뮬레이터 내비가 Zscaler 때문에 서버 연결 실패라 실측 못 함 |
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

## 개발 환경 메모

- 회사망 Zscaler가 `*.pleos.ai`, `*.umos.ai` TLS를 가로챈다.
  - 빌드: `~/.gradle/gradle.properties`의 truststore로 해결
  - 에뮬레이터 안 내비·서버 모드 TTS/STT: 해결 안 됨(시스템 CA 설치 불가한 user 빌드). 회사망 밖에서 실측하거나 IT에 예외 요청

## 추가 실측 (2026-10-29, Emulator v2.1.0 user 빌드)

- `NaviHelper.requestRoute`는 `pleos.car.permission.NAVI_ROUTE_SEARCH` 권한이 있어야 동작했다(`NAVI_ROUTE`만으로는 부족). 매니페스트에 둘 다 선언한다.
- 이 에뮬레이터(user 빌드)에서는 `inject-vhal-event`로 기어를 바꿀 수 없다. 기어·시동 전환은 디버그 버튼([탑승] 등)이나 단위 테스트로 확인한다.

