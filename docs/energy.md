# 에너지 후보 서버 (`POST /energy/options`)

정책서 9장 '에너지 체크'의 서버 쪽입니다. 차가 "필요 거리가 주행 가능 거리의 90%를 넘는다"고 판단한 뒤 부르면, 서버가 **충전소·주유소 후보**를 정렬해 돌려줍니다. 필요 거리·90% 판단·연료 종류 읽기는 차의 몫이라 서버는 하지 않습니다.
외부 API(환경부·오피넷)는 서버만 부릅니다. 키는 서버에만 두고 로그·응답에 남기지 않습니다.

## 요청

```json
{
  "fuel": "ev",
  "origin": { "lat": 35.1595, "lng": 126.8526 },
  "destination": { "lat": 35.1681, "lng": 126.8888 },
  "stayMinutes": 180,
  "at": "2026-11-06T12:00:00+09:00"
}
```

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `fuel` | 예 | `ev` · `gasoline` · `diesel` · `hybrid`. 하이브리드는 휘발유 가격으로 봅니다 |
| `origin` | 예 | 현재 위치(경로 출발점). 위도 -90~90, 경도 -180~180 |
| `destination` | 예 | 대상 일정 장소(경로 도착점). 같은 범위 |
| `stayMinutes` | 아니오 | 대상 일정이 머무는 시간(분). 0~10080. 없으면 '오래 머무는 일정'이 아닌 것으로 봅니다 |
| `at` | 아니오 | 제안 시점(오프셋 있는 ISO8601). 식사 시간대 판단에만 쓰고, 없으면 서버 시계입니다 |

모르는 필드는 무시합니다. 잘못된 값(없거나 형식·범위가 틀린 값, JSON이 아님)은 400 `{ "error": "..." }`, 본문이 64KB를 넘으면 413입니다.

## 응답 (200)

```json
{
  "fuel": "ev",
  "source": "fixture",
  "stage": "destination",
  "mealBundle": false,
  "candidates": [
    {
      "id": "EX-GJ-001",
      "kind": "slow_charger",
      "name": "예시 챔필 주차장 충전소",
      "address": "광주 북구 서림로 12",
      "lat": 35.1692, "lng": 126.887,
      "detourMeters": 204,
      "routeProgress": null,
      "charger": { "stationName": "예시 챔필 주차장 충전소", "status": "available", "availableCount": 2, "totalCount": 3, "powerKw": 7, "parkingFree": true },
      "price": null,
      "brand": null,
      "hasFood": null
    }
  ]
}
```

- `source`: `fixture`(목) · `live`(실제 API) · `unavailable`(외부 조회 실패·제한 시간 초과). **`unavailable`이면 `candidates`가 비어 있고, 후보가 없어서 빈 것이 아닙니다.** 차는 이때 에너지 제안을 건너뛰거나 나중에 다시 묻습니다. 실패해도 HTTP 상태는 200이고 서버는 계속 돕니다.
- `stage`: `destination`(목적지 근처 완속) · `route`(경로상 휴게소 급속 또는 주유소) · `none`(후보 없음 또는 조회 실패).
- `mealBundle`: 식사 시간대이고 후보 중 식사할 수 있는 휴게소가 있을 때만 true(전기차 `route` 단계). 차가 '휴게소 식사 + 급속 충전'을 한 제안으로 묶을지 판단하는 재료입니다. 후보마다 `hasFood`도 있습니다.
- `candidates`: 정렬된 후보, 최대 5개. 차의 '다른 데·다른 휴게소'는 다음 후보를 쓰면 됩니다. 5개를 다 쓰면 다시 부르지 말고 "더 찾지 못했어요"로 마무리하는 것을 권합니다.
- 후보 필드
  - `kind`: `slow_charger` · `fast_charger` · `gas_station`
  - `name`: 충전은 목적지 충전소 이름 또는 **휴게소 이름**, 주유소는 주유소 이름. 말할 때 쓸 이름입니다
  - `lat`·`lng`: 길안내(`addWaypoint`)에 넣을 좌표. 휴게소 후보는 휴게소 좌표입니다
  - `detourMeters`: `destination` 단계는 목적지에서의 거리, `route` 단계는 출발→목적지 선분에서 벗어난 거리(직선 근사)
  - `routeProgress`: 선분 위 위치(0=출발, 1=도착). `destination` 단계는 null
  - `charger`(충전 후보만): `status` `available`(빈 충전기 있음)·`busy`(전부 충전 중)·`unknown`, `availableCount`/`totalCount`(같은 속도 충전기), `powerKw`(모르면 null), `parkingFree`(모르면 null)
  - `price`(주유소만): `{ fuel: "gasoline"|"diesel", won }` 원/L, `brand`(오피넷 브랜드 코드, 없으면 null)
  - `address`: 충전소 주소(주유소는 null — 오피넷 반경 조회 응답에 주소가 없습니다)

## 규칙

### 전기차 (`fuel: "ev"`)

1. `stayMinutes >= 120`이면 목적지 **500m 안**의 **빈(available) 완속 충전기**가 있는 충전소를 목적지에 가까운 순으로 줍니다(`stage: "destination"`). 전부 사용 중·점검인 충전소는 뺍니다.
2. 1이 해당하지 않거나 후보가 없으면 **경로상 휴게소의 급속 충전소**를 줍니다(`stage: "route"`). 휴게소는 `fixtures/energy/rest-stops.json`에서 출발→목적지 선분 3km 안인 것만 고르고, 휴게소 300m 안의 급속 충전기가 있는 곳만 후보가 됩니다. 급속 충전기가 전부 운영중지·점검인 휴게소는 뺍니다.
3. 정렬: 충전 상태(빈 곳 → 모두 충전 중 → 알 수 없음) → 식사 시간대면 식사 가능한 휴게소 먼저 → 경로에서 벗어난 거리 → 경로 위치.
4. 식사 시간대(서울): 07:00~09:00, 11:00~14:00, 17:00~20:00 (끝 시각은 포함하지 않음, 가안).

### 휘발유·경유·하이브리드

경로에서 **3km 이내**(선분 수직 거리) 주유소를 **가격 오름차순**(같으면 경로에 가까운 순)으로 줍니다. 맨 앞이 '가장 싼 곳'입니다.
경로를 따라 찾기 위해 선분 위 8km 간격 지점마다 반경 5km로 조회하고(오피넷 반경 상한 5km), **출발점에서 100km까지만** 훑습니다(외부 호출 14회 이하). 100km 밖 주유소는 후보가 아닙니다.

### '경로 3km 우회' 근사 (가안)

경로 모양을 모르므로 **출발→목적지 직선 선분까지의 수직 거리**로 근사합니다(끝은 끝점까지의 거리). 실제 도로 경로, 그리고 되돌아 나오는 실제 우회 거리(대략 2배)와 다릅니다. 선분 중간 위도 기준 평면 근사라 수백 km 안에서 오차는 1% 안쪽입니다.

### 기준값 (`server/src/energy/constants.ts` 한 파일)

| 상수 | 값 | 정책서 12장 |
| --- | --- | --- |
| `LONG_STAY_MINUTES` | 120분 | 오래 머무는 일정(확정) |
| `SLOW_CHARGER_RADIUS_METERS` | 500m | 충전기 찾는 반경(가안) |
| `FUEL_DETOUR_MAX_METERS` | 3000m | 주유소 우회(가안) |
| `REST_STOP_CORRIDOR_METERS` | 3000m | (신규, 가안) 경로상 휴게소 판정 |
| `REST_STOP_CHARGER_RADIUS_METERS` | 300m | (신규, 가안) 휴게소 안 충전기 판정 |
| `MAX_CANDIDATES` | 5 | (신규) 응답 후보 상한 |
| `MEAL_WINDOWS_SEOUL_MINUTES` | 07–09·11–14·17–20시 | (신규, 가안) 식사 시간대 |
| `FUEL_SAMPLE_SPACING_METERS`·`FUEL_SCAN_MAX_METERS` | 8km·100km | (신규, 가안) 주유소 경로 탐색 |

'에너지 여유 90%'는 차가 판단합니다. 서버 상수에 없습니다.

## 어댑터와 환경 변수

`server/src/energy/`: 포트 `ChargerSource`·`FuelStationSource`·`RestStopSource`(`types.ts`), 픽스처 구현(`fixtureSources.ts`), 실제 구현(`evCharger.ts`·`opinet.ts`), 환경 변수로 고르는 `sources.ts`. 포트는 실패하면 던지고, 서비스(`options.ts`)가 잡아 `source: "unavailable"` + 빈 후보로 바꿉니다.

| 환경 변수 | 없을 때 | 있을 때 |
| --- | --- | --- |
| `EV_CHARGER_KEY` | `fixtures/energy/chargers.json` 목 | 환경부 전기차 충전소 API 호출 |
| `OPINET_KEY` | `fixtures/energy/fuel-stations.json` 목 | 오피넷 반경 내 주유소 API 호출 |

휴게소 목록은 항상 `fixtures/energy/rest-stops.json` 목입니다. 목 데이터는 전부 가상이고(이름 앞에 '예시'), 광주 시연 경로(육전집 → 챔피언스필드 / 광주 → 서울) 주변입니다.

- 외부 호출 제한 시간: 호출 하나 8초(오피넷), 환경부는 응답을 8초까지 기다림, 요청 전체 12초. 넘으면 `unavailable`.
- 키는 로그·응답·오류 메시지에 넣지 않습니다(오류 메시지는 고정 문구, 기록은 `[energy] 외부 조회 실패: <고정 문구>` 한 줄).
- 환경부 API는 반경 조회가 없어 **시도(zcode) 단위로 통째로 받아 5분간 메모리에 두고** 서버에서 거릅니다. 첫 호출은 수 MB x 여러 쪽이라 8초 안에 끝나지 않을 수 있습니다. 이때는 `unavailable`로 답하고 받기는 뒤에서 이어져 다음 호출부터 캐시를 씁니다. 실패한 시도는 30초 동안 다시 부르지 않습니다.
- 가까운 시도는 시도 중심 좌표로 고르고(경계 근처만 두 곳), 시도 경계를 쓰지 않는 근사라 경계 가까운 충전기는 빠질 수 있습니다.

## 확인한 외부 문서 (2026-11-14)

- 오피넷 반경 내 주유소: https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=3
  - 확인: URL `https://www.opinet.co.kr/api/aroundAll.do`, 변수 `certkey`·`out`(xml|json)·`x`·`y`·`radius`(m, 최대 5000)·`prodcd`(B027 휘발유, D047 경유)·`sort`(1 가격순, 2 거리순) 모두 필수, 응답 `UNI_ID`·`POLL_DIV_CD`·`OS_NM`·`PRICE`·`DISTANCE`·`GIS_X_COOR`·`GIS_Y_COOR`, **좌표는 KATEC**(요청·응답 모두), XML 응답 예시.
  - **좌표 변환이 필요합니다**: 요청 전에 WGS84 → KATEC, 응답 후 KATEC → WGS84 (`geo.ts`).
- 오피넷 상세정보(ID)·평균가격 문서(apiId=1, 5, 6)는 제품 코드·좌표 체계 확인용으로만 봤습니다.
- 한국환경공단 전기자동차 충전소 정보: https://www.data.go.kr/data/15076352/openapi.do
  - 확인: 서비스 URL `https://apis.data.go.kr/B552584/EvCharger`, 충전소 정보의 요청 변수(`ServiceKey`·`pageNo`·`numOfRows` 10~9999·`zcode`)와 응답 필드(`statNm`·`statId`·`chgerId`·`chgerType`·`addr`·`lat`·`lng`·`useTime`·`busiNm`·`stat`·`statUpdDt`·`powerType`·`zcode`·`parkingFree`·`note`). 좌표·반경으로 거르는 변수는 없음.
- 충전기 타입·상태 코드표는 활용 가이드를 옮긴 공개 자료(https://github.com/seungmin-park/PlugPass/pull/4)를 참고했습니다. 공식 페이지에는 코드표가 없었습니다.
- KATEC 정의 참고(비공식 좌표계, EPSG 없음): Bessel 1841, 위도 38도·경도 128도, 축척 0.9999, 가산 (400000, 600000), towgs84 -146.43, 507.89, 681.46 — 공개 자료(변환 코드 사례)의 값이고 오피넷이 밝힌 값이 아닙니다.

## 미확인 (실제 키로 확인 필요)

- 환경부: 오퍼레이션 경로 `getChargerInfo`(공식 표에 이름 없음), 키 변수 철자(`serviceKey`/`ServiceKey`), 응답 XML의 header/body/items/item 배치와 JSON 구조(XML 기본값을 씀), 상태·타입 코드표의 공식 확인, 출력 용량 단위(`powerType` "급속(100kWh동시)"에서 숫자만 뽑아 `powerKw`로 씀), `limitYn`·`delYn` 필드 이름(있으면 제외), 강원·전북 시도 코드(42/51, 45/52 둘 다 부름), 시도 하나의 충전기 수(15쪽까지만 받음), 호출 한도, 키 인코딩(디코딩 키 권장, `%`가 있으면 풀어서 씀).
- 오피넷: JSON 응답 구조(XML만 씀), 한 번에 돌려주는 주유소 개수 상한, 오류 응답 모양, 호출 한도, KATEC 변환식의 정밀도(문서 예시 좌표가 강남으로 변환되는지만 테스트로 확인), 브랜드 필드 철자(표는 `POLL_DIV_CD`, 예시는 `POLL_DIV_CO`라 둘 다 읽음).
- 휴게소 목록의 실제 출처(한국도로공사 등)는 정하지 않았습니다. 지금은 가상 목록뿐이라 실제 키를 써도 휴게소 후보는 가상 휴게소 좌표 주변에서만 나옵니다.
- 실제 키로 호출한 적은 없습니다. 파싱은 문서의 예시 값으로 만든 고정 문자열로만 테스트했습니다.

## 차 쪽(C6)이 쓸 때

- 호출 시점은 정차 중, 에너지 제안을 하기 직전입니다. 응답이 늦을 수 있으니(최대 12초) 카드를 막지 말고 한 번만 부르세요.
- `source: "unavailable"`이면 후보가 없는 것이 아니라 조회 실패입니다. 에너지 제안을 건너뛰세요.
- `stage: "none"`(`source`가 fixture·live)이면 후보가 없습니다.
- 한 카드에 질문은 하나입니다. `mealBundle`이 true면 "식사할 휴게소를 급속 충전기 있는 곳으로 잡을까요?"처럼 묶고, `candidates[0].name`(휴게소 이름)을 씁니다. false면 충전만 묻습니다.
- 전기차 목적지 완속(`stage: "destination"`)은 `stayMinutes`를 대상 일정의 시작~종료로 계산해 보내야 합니다(종일 일정은 보내지 마세요).
- "다른 데"는 `candidates[1]`, `[2]`…를 차례로 씁니다(`id`로 이미 거절한 후보를 거르세요).
- "응"이면 `lat`·`lng`로 `addWaypoint`. 주유소 후보의 `detourMeters`는 직선 근사이므로 말로 거리를 단정하지 마세요.
