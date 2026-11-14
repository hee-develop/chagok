# 장소 검색 어댑터와 장소 기억(서버)

정책서 8장 '장소 해석과 기억'을 서버가 돕는 부분입니다. 일정의 장소 칸 글자(또는 차에서 들은 이름)를 좌표로 바꾸는 순서 중
**좌표·주소 판단, 기억 조회, 외부 장소 검색(현재 위치 기준 가까운 순), 기억 저장**을 서버가 맡고, 말·카드·고르기는 차가 맡습니다.
차 쪽 대화(질문·타일·"다음부터 기억할게요")는 다른 묶음이고 이 문서는 서버 계약만 정합니다.

## 장소 검색 포트 (`server/src/placeSearch/`)

`PlaceSearch` 인터페이스(`types.ts`)가 서버가 외부 장소 검색을 부르는 유일한 문입니다(외부 API는 서버만 부릅니다. 차·폰은 서버를 거칩니다).

- `searchKeyword({ query, near?, limit })` → `{ places: PlaceCandidate[], total, source }`. `near`가 있으면 가까운 순이고 `distanceMeters`(직선거리, 미터)를 채웁니다. `total`은 일치한 전체 수(0·1·2 이상을 가르는 값)입니다.
- `geocodeAddress(address)` → `{ place: { name, address, lat, lng } | null, source }`. **정확히 한 곳으로 정해질 때만** 장소를 줍니다(없음·여러 곳·행정구역만이면 null).
- 실패는 던지지 않습니다: 시간 초과·네트워크·HTTP 오류·모양이 어긋난 응답은 빈 후보 + `source: "unavailable"`입니다(0건과 다릅니다).
- `source`: `mock`(픽스처) | `kakao` | `unavailable`.

| 구현 | 언제 | 비고 |
| --- | --- | --- |
| 목(`mock.ts`) | `KAKAO_REST_KEY`가 없을 때(기본) | `fixtures/places/mock-places.json`. 이름·주소 부분 일치(기존 규칙), 기준 좌표가 있으면 거리순, 주소는 목 장소의 주소와 통째로 같을 때만(뒤에 공백으로 이어지는 동·호 허용) |
| 카카오(`kakao.ts`) | `KAKAO_REST_KEY`가 있을 때 | 카카오 로컬 API 키워드 검색·주소 검색. 짧은 캐시(`cache.ts`) 포함 |

환경 변수는 서버 시작 코드(`server/src/index.ts`)만 읽습니다(`createApp`은 환경 변수를 읽지 않아 테스트가 환경에 흔들리지 않습니다. 테스트는 `createApp({ placeSearch })`로 주입).

- `KAKAO_REST_KEY`: 카카오 REST API 키. **로그·응답·오류 어디에도 남기지 않습니다**(요청 헤더에만 있고, 실패 로그는 이유 종류와 HTTP 상태 코드만 남깁니다). 키를 코드·저장소에 두지 않습니다.
- 그 밖의 값(타임아웃 3초, 캐시 60초·200개·좌표 소수 3자리, 속도 제한 분당 60회·주소 1000개, 후보 2개, 기억 200개)은 `server/src/placeSearch/limits.ts` 한 파일의 상수입니다.

### 카카오 로컬 API: 맞춘 문서와 미확인

문서: <https://developers.kakao.com/docs/latest/ko/local/dev-guide> (2026-11-15에 읽음. 이 주소는 `http://developers.kakao.com/docs/ko/local/dev-guide` 로 넘어가는 문서입니다. 이 문서가 최신 개정인지는 확인하지 못했습니다.)

- 키워드로 장소 검색: `GET https://dapi.kakao.com/v2/local/search/keyword.json`, 헤더 `Authorization: KakaoAK ${REST_API_KEY}`.
  - `query`(필수), `x`(**경도**)·`y`(**위도**)·`radius`(0~20000 미터)·`sort`(`distance`|`accuracy`, 기본 `accuracy`, `distance`는 x·y와 함께)·`page`(1~45)·`size`(1~15, 기본 15).
  - 응답: `meta.total_count`·`pageable_count`·`is_end`, `documents[]`의 `id`·`place_name`·`address_name`·`road_address_name`·`x`·`y`·`distance`(미터, x·y를 보냈을 때만). `x`·`y`·`distance`는 문자열입니다.
  - 서버가 보내는 것: `query`, 기준 좌표가 있으면 `x`·`y`·`sort=distance`, `size`(후보 수). 반경은 기본으로 보내지 않습니다(`createKakaoPlaceSearch({ radiusMeters })`로 켤 수 있음). 반경 없이 가까운 순으로 받아 전국에서 가장 가까운 곳을 고릅니다.
  - 후보의 `id`는 `kakao:<장소 id>`, 주소는 도로명 주소가 있으면 그것, 없으면 지번 주소입니다.
- 주소 검색: `GET https://dapi.kakao.com/v2/local/search/address.json`. `query`(필수), `analyze_type`(`similar` 기본|`exact`), `page`, `size`(1~30). 응답 `documents[]`의 `address_name`·`address_type`(`REGION`|`ROAD`|`REGION_ADDR`|`ROAD_ADDR`)·`x`·`y`·`road_address.building_name`.
  - 서버는 문서가 정확히 **1건**이고 `address_type`이 `ROAD_ADDR`·`REGION_ADDR`(번지·건물까지 있는 주소)일 때만 좌표로 씁니다. 그 밖에는 키워드 검색으로 넘어갑니다.

**미확인**(문서에서 찾지 못했거나 실제 호출로 확인하지 못한 것):
- 오류 응답 본문 형식과 쿼터 수치(문서는 각각 별도 페이지로 링크만 합니다). 서버는 본문을 읽지 않고 HTTP 상태만 봅니다.
- `sort=distance`를 `radius` 없이 쓸 때의 동작(문서는 x·y와 함께라고만 합니다).
- `analyze_type=exact`의 정확한 의미(서버는 쓰지 않고 기본값을 씁니다).
- 실제 키로 호출한 결과: 이 묶음은 키 없이 만들어 **네트워크 호출은 하지 않았고** 문서 예시를 고정 문자열로 넣은 테스트만 있습니다. 키를 넣은 첫 실행은 수동으로 확인해야 합니다(`KAKAO_REST_KEY=… pnpm server:dev` 뒤 `curl -X POST …/places/resolve`).
- 카카오의 약관·쿼터가 서버 한 개 키로 여러 사용자를 받아도 되는지는 확인하지 않았습니다.

## API

차가 부르는 API는 자리를 **차 토큰 + `driver=<seatId>`**(옛 호환: `driver` 없으면 그 차의 지난번 고른 자리, 식별이 없으면 기본 자리)로 정합니다(`docs/pairing.md`의 읽기·쓰기 표와 같은 규칙). 오류 본문은 `{ error, reason? }`입니다.

| 메서드·경로 | 누가 | 하는 일 | 자리 정하기 |
| --- | --- | --- | --- |
| `POST /places/resolve` | 차 | 이름 + 현재 위치 → 기억·후보 | 읽기 규칙(`guard.read`) |
| `PUT /places/memory` | 차(폰 토큰도 가능) | '이름 → 장소, 애매 여부' 저장 | 차 토큰 + `driver`, 폰 토큰, 기기 id 버킷, 식별 없음=기본 자리(`guard.carWrite`) |
| `GET /places/memory` | 폰(차 토큰 + `driver`도 가능) | 기억 목록(최근에 쓴 것부터) | 읽기 규칙 |
| `DELETE /places/memory/:name` | 폰 | 기억 하나 지우기(정책서 10.8) | 쓰기 규칙(폰 토큰 등) |
| `GET /places/search?q=&lat=&lng=` | 폰 | 기존 장소 검색, 같은 포트를 씀 | 자리 무관 |

### `POST /places/resolve`

요청: `{ name: string, lat?: number, lng?: number }`. `name`은 일정의 장소 칸 글자 또는 차에서 들은 이름(공백 정리 후 1~300자), `lat`·`lng`는 현재 위치로 **함께** 보내거나 둘 다 생략합니다(범위 −90~90 / −180~180). 다른 필드는 400입니다.

응답 200:

```json
{
  "memory": { "place": { "name": "...", "address": "...|null", "lat": 0, "lng": 0 }, "ambiguous": false } ,
  "candidates": [{ "id": "...", "name": "...", "address": "...", "lat": 0, "lng": 0, "distanceMeters": 123 }],
  "total": 3,
  "source": "mock" ,
  "via": "search"
}
```

- `memory`: 기억이 있을 때만(없으면 `null`). 있으면 검색하지 않고(`candidates: []`, `total: 0`, `source: "none"`) 차가 이 장소를 1순위로 씁니다.
- `candidates`: 가까운 순 최대 2개(`MAX_CANDIDATES`). `distanceMeters`는 위치를 보냈을 때만 숫자(아니면 `null`, 주소·좌표로 정한 후보도 `null`).
- `total`: 검색에 일치한 전체 수입니다(`candidates`보다 클 수 있음). 0이면 못 찾음, 1이면 하나, 2 이상이면 애매입니다.
- `source`: `mock` | `kakao` | `unavailable` | `none`(검색하지 않음: 기억·좌표). **`unavailable`이면 검색을 못 한 것이지 0개가 아닙니다**(시간 초과·오류·키 거절). 차는 이때 '장소 빈 일정에 올림'으로 처리하지 말고 "어디로 갈까요?"로 넘어가야 합니다.
- `via`: 어떻게 정했는가. `coordinates`(글자가 `위도, 경도`) · `address`(정확한 주소 → 좌표, 검색 없음) · `memory` · `search`.
- 순서(서버): ① 글자가 좌표면 그대로, 주소처럼 보이면 주소 검색(정확히 한 곳일 때만 확정) ② 기억 조회 ③ 키워드 검색. 주소처럼 보여도 못 정하면 ②·③으로 넘어갑니다.
- 429 `rate-limited`: 요청 주소별 검색 한도(분당 60회, 외부 검색을 부를 때만 셈. 기억·좌표로 답하는 요청은 안 셈).

### `PUT /places/memory`

요청: `{ name: string, place: { name: string, lat: number, lng: number, address?: string|null }, ambiguous: boolean }`. `place.address`만 생략할 수 있고 나머지는 필수이며 모르는 필드는 400입니다(`name` 1~300자, `place.name` 1~200자, `address` 300자 이하).
응답 200: 저장한 `{ name, place: { name, address, lat, lng }, ambiguous, updatedAt }`.

- 이름은 **기존 정규화(앞뒤 공백 제거, 연속 공백 하나로, 소문자: `normalizePlaceName`)가 같으면 같은 이름**이라 덮어씁니다(목 장소 이름의 '완전 일치' 판정과 같은 규칙). 저장되는 `name`은 공백만 정리한 글자입니다.
- 이름 키(차가 `name`으로 보낼 글자): 일정의 **장소 칸 글자**이고, 장소 칸이 비었으면 **일정 제목**입니다. 서버가 일정에 기억을 적용할 때 같은 규칙으로 찾습니다.
- 자리 하나가 200개까지이고 넘으면 가장 오래 전에 쓴 기억부터 버립니다.
- 자리 판단 오류: 남의 자리 `driver`는 403, 차 토큰만 있는데 정할 자리가 없으면 409 `no-seat`, 모르는 토큰은 401.

### `GET /places/memory` · `DELETE /places/memory/:name`

- `GET` 응답: `{ memories: [{ name, place, ambiguous, updatedAt }] }`(최근에 쓴 것부터).
- `DELETE`: `:name`은 URL 인코딩한 이름이고 정규화해서 찾습니다. 지웠으면 200 `{ name }`, 없으면 404. 버킷을 만들지 않습니다.
- 폰 클라이언트 함수·타입은 `phone/src/features/places/memoryApi.ts`(`placeMemoryApi`)까지만 있고 목록·지우기 화면은 장소 탭 묶음이 붙입니다.

### `GET /places/search` (기존, 호환)

응답은 목 출처일 때 기존과 똑같은 `{ places: [{ id, name, address, lat, lng }] }`(최대 10개)입니다. `lat`·`lng`(함께, 선택)를 주면 가까운 순입니다. 카카오 출처면 `source: "kakao"`가, 검색을 못 했으면 `places: []`와 `source: "unavailable"`이 덧붙습니다. 429 `rate-limited`가 새로 생겼습니다(같은 요청 주소 한도를 `resolve`와 나눠 씀).

## 일정 장소를 정할 때 기억이 쓰이는 방식 (`/schedules/today`·`/schedules/places`)

폰 일정과 픽스처 일정 모두 순서가 **보정(`PUT /schedules/:id/place`) → 목 장소 이름 완전 일치(좌표 확정) → 자리의 장소 기억 → (없으면) 기존 `suggestion`** 입니다. 기억이 있으면:

- `place`가 기억한 장소의 `{ name, lat, lng }`로 확정되고 `suggestion`은 `null`입니다. 이름 키는 위 규칙(장소 칸 글자, 비면 제목)입니다.
- 응답에 `placeMemory: { ambiguous }`가 **덧붙습니다**(기억에서 온 장소일 때만, 아니면 필드가 없음 — 기억을 쓰지 않는 기존 응답은 한 글자도 바뀌지 않습니다). **`ambiguous: true`면 차가 매번 "지난번처럼 {장소}로 갈까요?"로 확인해야 합니다**(서버는 `place`를 내려도 확인 여부는 차가 정합니다).
- 보정(장소 넣기)이 이기고, 이동 없음이면 기억을 쓰지 않으며, 보정을 지우면 기억으로 돌아갑니다. 좌표가 이미 있는 일정(픽스처의 `place`, 목 장소 완전 일치)에는 쓰지 않습니다.
- `fixtures/places/remembered.json`(제목 → 목 장소)은 **픽스처·데모 자리(기본 자리와 `FIXTURE_SEATS=1`)의 시드**로만 쓰며 확정하지 않는 `suggestion`으로만 내립니다(기존 계약). 기억 저장소에는 들어가지 않고 `GET /places/memory`에도 안 나오며, 실제 자리에는 새지 않습니다. 차가 같은 이름을 기억하면 기억이 시드보다 앞섭니다.
- 이 라우트들은 외부 검색을 부르지 않습니다(주소 지오코딩·키워드 검색은 차가 `POST /places/resolve`로 부릅니다).

## 자리별 저장 (정책서 10.1·10.9·11장)

기억은 `SeatData.memory`(자리 하나의 저장소, `server/src/placeMemory.ts`)라서:
- 자리마다 따로 쌓입니다(자리 A의 기억이 자리 B의 목록·resolve·일정에 보이지 않음).
- 폰의 연결 끊기(`DELETE /pair`), 차의 `DELETE /car`·옛 초기화로 자리가 지워지면 함께 지워집니다.
- 폰 바꾸기(같은 자리 이어받기)에서는 유지됩니다(폰 바꾸기는 일정·캘린더 선택만 비웁니다).
- 연결 전 폰(기기 id만)이 쓰면 그 기기의 버킷에 쌓이고 연결할 때 새 자리가 이어받습니다. 식별이 없는 요청은 기본 자리입니다(데모·픽스처 경로). 저장은 메모리뿐이라 서버를 다시 켜면 사라집니다.

## 8장 단계별: 서버가 맡은 것과 차가 맡을 것

| 8장 단계 | 서버 | 차 |
| --- | --- | --- |
| 1. 좌표·정확한 주소면 검색하지 않음 | `resolve`가 글자가 좌표면 `via: coordinates`, 정확한 주소(주소 검색이 정확히 한 곳)면 `via: address`로 답함. 서버의 일정 라우트는 목 장소 이름 완전 일치만 확정(기존) | 캘린더가 좌표·주소를 주면 그 글자로 `resolve`를 부르고 `via`가 `address`·`coordinates`면 그대로 씀 |
| 2. 기억이 1순위 | `memory`로 답함, 일정 응답에도 `place`+`placeMemory` 반영 | 기억 있으면 출발 제안으로 |
| 2a. 후보 하나였던 이름: 확인 없이 | `ambiguous: false` 표시 | 확인 없이 출발 제안 |
| 2b. 애매한 이름: "지난번처럼 {장소}로 갈까요?" | `ambiguous: true` 표시(`resolve.memory`·`placeMemory`) | 매번 그 문장으로 확인(말·카드) |
| 3. 검색(현재 위치 기준 가까운 순) | `candidates` 최대 2개 + `total` + `distanceMeters` | 현재 위치(`lat`·`lng`)를 같이 보냄 |
| 3a. 1개: 바로 쓰고 기억 | `total: 1` | 바로 쓰고 `PUT /places/memory`(`ambiguous: false`) |
| 3b. 2개 이상: 가까운 2개 타일 "어느 쪽이에요?" | `total ≥ 2`, 후보 2개 | 타일·고르기, 고른 곳을 `ambiguous: true`로 `PUT` |
| 3c. 0개: 폰 홈 '장소 빈 일정'에 올리고 "어디로 갈까요?" | `total: 0`(`source`가 `unavailable`이 아닐 때). '장소 빈 일정'은 별도 저장 없이 `GET /schedules/places`에서 `place: null`·이동 없음 아님·기억 없음인 일정으로 이미 보임 | "어디로 갈까요?"로. `source: "unavailable"`이면 못 찾음이 아니라 검색 장애로 구분 |
| 4. 장소 칸이 빈 일정: 60분 전부터 묻기, 들은 이름으로 3번, "안 가요"면 이동 없음 | `resolve`가 들은 이름을 같은 방식으로 처리(검색어로) | 질문·60분 조건·음성 인식. "안 가요"의 이동 없음 기억은 J2b |
| 5. "다음부터 '{일정}'은 여기로 기억할게요." + 서버 저장 | `PUT /places/memory`(이름 → 장소, 애매 여부), 일정 응답 반영 | 말하기와 저장 호출 |
| 5'. '캘린더에 장소 적기' | **만들지 않음**(사용자가 뺌). `GET /places/memory`는 폰의 기억 목록 화면용 | — |
| 10.8 기억한 장소 지우기 | `GET`·`DELETE /places/memory` | — (폰 화면은 장소 탭 묶음) |

## 차 쪽 묶음이 알아야 할 점

- 일정의 장소 칸이 비어도 기억 키는 일정 제목입니다. `resolve`의 `name`과 `PUT`의 `name`을 **같은 글자**(장소 칸 글자, 비면 제목)로 보내야 `/schedules/today`가 다음 번에 그 기억을 반영합니다. 들은 이름으로 검색했더라도 기억은 일정 키로 저장하세요.
- `GET /schedules/today`에서 `placeMemory.ambiguous === true`인 일정은 장소가 확정돼 내려와도 확인이 필요합니다.
- `resolve`의 `total`은 카카오 `meta.total_count`라 목록 크기보다 훨씬 클 수 있습니다. 0·1·2 이상만 가르는 값으로 쓰세요.
- `source: "unavailable"`(시간 초과 3초 포함)은 재시도 대상이 아니라 "어디로 갈까요?"로 넘어가는 경우입니다.
- 현재 위치는 `lat`·`lng`로 같이 보냅니다. 위치를 못 얻었으면 생략해도 되지만 거리순이 아닙니다.
- 이동 일정에만 부르세요(이동 없음 일정은 서버가 해석하지 않습니다).

## 한계

- 카카오 결과의 `id`(`kakao:…`)는 자주 가는 곳(`PUT /places/favorites/*`)·일정 보정(`PUT /schedules/:id/place`)에 **저장할 수 없습니다**(두 저장소는 목 장소 id만 받음). 폰 장소 검색 화면은 카카오 키가 있으면 검색 결과를 보여 줘도 저장하지 못합니다. 두 저장소가 외부 장소를 받게 하는 일은 J4(자주 가는 곳)와 함께 다룹니다.
- 서버의 일정 응답은 외부 검색을 하지 않으므로 주소로만 적힌 일정은 차가 `resolve`를 불러야 좌표가 생깁니다.
- 속도 제한·요청 주소는 프록시 뒤에서 `createApp({ clientAddress })`를 바꿔야 맞게 셉니다(`docs/pairing.md`와 같음). 캐시·제한·기억은 모두 메모리라 서버를 다시 켜면 사라집니다.
- 주소처럼 보이는지는 정규식 휴리스틱입니다(`…로·길·동·읍·면·리 + 번지`). 틀려도 정확히 한 곳이 아니면 키워드 검색으로 넘어가 좌표를 잘못 확정하지는 않습니다.

## 검증

`pnpm server:test`: `server/test/place-search.test.ts`(목·카카오 요청 조립·문서 예시 응답 읽기·실패·키 미노출·캐시·속도 제한), `place-resolve.test.ts`(resolve 0/1/2개 이상·거리순·주소·좌표·기억 우선·애매·카카오 주입·`unavailable`·검증·속도 제한·`GET /places/search` 호환), `place-memory.test.ts`(저장·정규화·검증·자리 격리·끊기·폰 바꾸기·일정 반영·픽스처 회귀). 폰: `pnpm phone:test`(`memoryApi.test.ts`).
