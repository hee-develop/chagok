# 장소 검색 어댑터와 장소 기억(서버)

정책서 8장 '장소 해석과 기억'을 서버가 돕는 부분입니다. 일정의 장소 칸 글자(또는 차에서 들은 이름)를 좌표로 바꾸는 순서 중
**좌표·주소 판단, 기억 조회, 외부 장소 검색(현재 위치 기준 가까운 순), 기억 저장**을 서버가 맡고, 말·카드·고르기는 차가 맡습니다.
차 쪽 대화(질문·타일·"다음부터 기억할게요")는 다른 묶음이고 이 문서는 서버 계약만 정합니다.

## 한눈에 보는 규칙

1. **외부 장소 검색은 서버만 부릅니다.** 차·폰은 서버를 거칩니다. REST API 키는 서버 환경 변수에만 있습니다.
2. **새 API(`POST /places/resolve`, `PUT/GET/DELETE /places/memory`)는 옛 차 앱 호환 규칙(`legacyDriverFallback`)을 적용하지 않습니다.** 어느 자리를 다루는지는 아래 '자리 정하기' 표대로만 정하고, 식별 없는 요청이 실제 자리의 기억을 읽거나 쓰는 경로는 없습니다.
3. **실제 자리(연결된 자리·연결 전 버킷)에서는 목 데이터를 쓰지 않습니다.** 목 검색 결과와 목 장소 이름 완전 일치는 기본 자리(데모·픽스처)와 `FIXTURE_SEATS=1`에서만 씁니다.
4. **일정 장소 확정 순서**(모든 자리): 일정별 보정 → **자리 기억** → 목 장소 이름 완전 일치(기본 자리·`FIXTURE_SEATS=1`만) → `suggestion`(확인 필요). 기억이 목 완전 일치보다 앞입니다.
5. **애매한 기억(`ambiguous: true`)은 확정하지 않습니다.** `place`로 내리지 않고 `suggestion`(확인 필요)으로 내립니다.
6. **일정 제목은 외부 검색으로 보내지 않습니다.** 검색어(`query`)와 기억 키(`key`)가 분리돼 있고 외부로는 `query`만 나갑니다(50자, 위치는 소수 3자리).

## 장소 검색 포트 (`server/src/placeSearch/`)

`PlaceSearch` 인터페이스(`types.ts`)가 서버가 외부 장소 검색을 부르는 유일한 문입니다.

- `searchKeyword({ query, near?, limit })` → `{ places: PlaceCandidate[], total, source }`. `near`가 있으면 가까운 순이고 `distanceMeters`(직선거리, 미터)를 채웁니다.
- `geocodeAddress(address)` → `{ place: { name, address, lat, lng } | null, source }`. **정확히 한 곳으로 정해질 때만** 장소를 줍니다(없음·여러 곳·행정구역만이면 null).
- 실패는 던지지 않습니다: 시간 초과·네트워크·HTTP 오류·모양이 어긋난 응답은 빈 후보 + `source: "unavailable"`입니다(0건과 다릅니다).
- `source`: `mock`(픽스처) | `kakao` | `unavailable`.

| 구현 | 언제 | 비고 |
| --- | --- | --- |
| 목(`mock.ts`) | `KAKAO_REST_KEY`가 없을 때(기본) | `fixtures/places/mock-places.json`. 이름·주소 부분 일치(기존 규칙), 기준 좌표가 있으면 거리순, 주소는 목 장소의 주소와 통째로 같을 때만(뒤에 공백으로 이어지는 동·호 허용). **기본 자리·`FIXTURE_SEATS=1`에서만 결과로 쓰임** |
| 카카오(`kakao.ts`) | `KAKAO_REST_KEY`가 있을 때 | 카카오 로컬 API 키워드 검색·주소 검색. 짧은 캐시(`cache.ts`) 포함 |

환경 변수는 서버 시작 코드(`server/src/index.ts`)만 읽습니다(`createApp`은 환경 변수를 읽지 않아 테스트가 환경에 흔들리지 않습니다. 테스트는 `createApp({ placeSearch })`로 주입).

- `KAKAO_REST_KEY`: 카카오 REST API 키. **로그·응답·오류 어디에도 남기지 않습니다**(요청 헤더에만 있고, 실패 로그는 이유 종류와 HTTP 상태 코드만 남깁니다). 키를 코드·저장소에 두지 않습니다.
- `FIXTURE_SEATS=1`: 데모 전용. 켜면 목 일정과 함께 **목 장소 검색·목 장소 완전 일치도 모든 읽기 범위에 쓰입니다**(실제 사용자에게 목 데이터가 보임. `docs/pairing.md`).
- 그 밖의 값(타임아웃 3초, 캐시 60초·200개·좌표 소수 3자리, 검색 속도 제한 분당 60회·주소 1000개, 후보 2개, 기억 200개(버킷 20개), 기억 저장 속도 제한 분당 30회, 외부 검색어 50자, 실패 로그 간격 10분)는 `server/src/placeSearch/limits.ts` 한 파일의 상수입니다.

### 외부로 나가는 것(개인정보 최소화)

외부 검색 API에는 **검색어와 (있으면) 현재 위치**만 나갑니다.
- 검색어는 공백을 정리하고 **50글자(`MAX_EXTERNAL_QUERY_LENGTH`)로 잘라** 보냅니다(주소 검색도 같음). 일정 제목이 통째로 밖으로 나가지 않도록, 서버는 기억 키(`key`)를 외부로 보내지 않습니다.
- 현재 위치는 **소수 3자리(약 110m)로 줄여** 보냅니다(캐시 키가 뭉치는 자리와 같습니다). 그래서 `distanceMeters`는 줄인 위치 기준 값입니다.
- 키·요청 URL·응답 본문은 로그에 남기지 않습니다.

### 실패 처리·로그

- 제한 시간(3초)은 **헤더를 받는 데서 본문을 다 읽을 때까지 전체**에 걸립니다. 본문을 받다가 멈춰도 `timeout`이고, `signal`을 무시하는 `fetch`여도 시간이 지나면 끊습니다(이유는 한 번만 알림).
- 실패 로그(`createFailureLog`)는 **같은 이유(종류·HTTP 상태)는 10분에 한 줄**만 남기고 건너뛴 횟수를 다음 줄에 붙입니다. 키가 거절되거나 쿼터가 넘친 서버가 요청마다 같은 줄을 쌓지 않습니다.

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

## 자리 정하기 (새 장소 API 전용)

`POST /places/resolve`, `GET`·`PUT`·`DELETE /places/memory`는 아래 표로만 자리를 정합니다(`seatScope.ts`의 `placeRead`·`placeWrite`). 옛 차 앱 호환(자리 하나뿐인 차의 지난번 고른 자리, 차 토큰만으로 읽기)은 **적용하지 않습니다**. 오류 본문은 `{ error, reason? }`입니다.

| 식별 | 읽기(`resolve`·`GET`) | 쓰기(`PUT`·`DELETE`) |
| --- | --- | --- |
| 폰 토큰 | 그 자리(기기 id·`driver`는 자리를 정하는 데 안 씀) | 그 자리 |
| 차 토큰 + `driver=<seatId>` | 그 차의 자리면 그 자리, 아니면 **403** | 같음 |
| 차 토큰만(`driver` 없음) | **400 `driver-required`** | **400 `driver-required`** |
| 모르는 토큰·이상한 Authorization | **401** | **401** |
| 기기 id만(토큰 없음) | 그 기기의 연결 전 버킷(없으면 빈 응답, 만들지 않음) | 그 기기의 버킷(본문 검증 뒤 없으면 만듦, 주소별 버킷 생성 속도 제한 429) |
| **식별 없음**, 서버에 자리 있는 차가 **하나도 없음** | 기본 자리(데모·차량 E2E·픽스처 경로) | 기본 자리 |
| **식별 없음**, 자리 있는 차가 **있음**(하나든 여럿이든) | **저장하지 않는 빈 범위**(기억 없음, 읽기만 비어 있음) | **거절**(429 `unwritable`, 지우기는 404) |

- 식별 없는 요청이 실제 자리의 기억을 읽거나 쓰는 경로가 없습니다. 기본 자리에 쌓은 기억은 자리 있는 차가 생겨도 실제 자리에 새지 않습니다.
- 빈 범위는 목 데이터도 쓰지 않습니다(`FIXTURE_SEATS=1`이 아닌 한).

### 목 데이터는 어디서 쓰이는가

| 범위 | 목 검색 결과(`resolve`·`GET /places/search`) | 목 장소 이름 완전 일치·제목 시드(일정) |
| --- | --- | --- |
| 기본 자리(식별 없음, 자리 있는 차 없음) | 씀 | 씀 |
| `FIXTURE_SEATS=1`의 모든 범위 | 씀 | 씀 |
| 실제 자리(연결된 자리·연결 전 버킷)·빈 범위 | **안 씀**: 목 어댑터가 답해도 후보 없음 + `source: "unavailable"` | **안 씀**: 보정 → 기억 → `null`뿐 |

카카오 키가 있으면(실제 출처) 실제 자리에서도 검색이 됩니다. 키가 없는 실제 자리의 검색은 `source: "unavailable"`(후보 없음)이고, 폰은 "지금은 장소를 검색할 수 없어요"를 보입니다. `GET /places/search`도 같은 규칙입니다(자리를 정하려고 `placeRead`를 거칩니다).

## API

| 메서드·경로 | 누가 | 하는 일 |
| --- | --- | --- |
| `POST /places/resolve` | 차 | 검색어(`query`) + 기억 키(`key`) + 현재 위치 → 기억·후보 |
| `PUT /places/memory` | 차(폰 토큰도 가능) | '이름 → 장소, 애매 여부' 저장 |
| `GET /places/memory` | 폰(차 토큰 + `driver`도 가능) | 기억 목록(최근에 쓴 것부터) |
| `DELETE /places/memory?name=` | 폰 | 기억 하나 지우기(정책서 10.8) |
| `GET /places/search?q=&lat=&lng=` | 폰 | 장소 검색(자주 가는 곳·일정 보정용) |

### `POST /places/resolve`

요청: `{ query: string, key?: string, lat?: number, lng?: number }`.

- `query`: **외부 검색에 쓸 글자**(일정의 장소 칸 글자, 또는 장소 칸이 빈 일정에서 차가 물어 들은 이름). 공백 정리 후 1~300자.
- `key`: **기억을 찾을 이름**. 생략하면 `query`와 같습니다. 일정 제목처럼 외부로 나가면 안 되는 글자는 `key`에만 둡니다(1~300자).
- `name`: `query`의 옛 이름으로 받습니다(`query`와 같이 보내면 400).
- `lat`·`lng`: 현재 위치로 **함께** 보내거나 둘 다 생략합니다(범위 −90~90 / −180~180). 다른 필드는 400입니다.

**장소 칸이 빈 일정은** 차가 물어 들은 이름을 `query`로, **일정 제목은 `key`와 `PUT /places/memory`의 `name`으로만** 보냅니다. 서버는 `key`로 기억을 찾고 `query`로만 외부 검색합니다.

응답 200:

```json
{
  "memory": { "place": { "name": "...", "address": "...|null", "lat": 0, "lng": 0 }, "ambiguous": false },
  "candidates": [{ "id": "...", "name": "...", "address": "...", "lat": 0, "lng": 0, "distanceMeters": 123 }],
  "total": 3,
  "source": "mock",
  "via": "search"
}
```

- `memory`: 기억이 있을 때만(없으면 `null`). 있으면 검색하지 않고(`candidates: []`, `total: 0`, `source: "none"`) 차가 이 장소를 1순위로 씁니다.
- `candidates`: 가까운 순 최대 2개(`MAX_CANDIDATES`). `distanceMeters`는 위치를 보냈을 때만 숫자(아니면 `null`, 주소·좌표로 정한 후보도 `null`). 줄인 위치(소수 3자리) 기준입니다.
- `total`: 검색에 일치한 수입니다(`candidates`보다 클 수 있음). 0이면 못 찾음, 1이면 하나, 2 이상이면 애매입니다. **카카오의 `total`은 전국의 일치 수입니다**(`meta.total_count`): 가까운 곳에 하나뿐이어도 다른 지역에 같은 이름이 있으면 2 이상이 되고, 반대로 `total: 1`인 하나가 아주 먼 곳일 수 있습니다. 그래서 **차는 `distanceMeters`로 거리 상한(예: 지금 위치에서 너무 먼 후보는 확정하지 않고 되묻기)을 봐야 합니다.** 서버는 거리 상한을 정하지 않습니다.
- `source`: `mock` | `kakao` | `unavailable` | `none`(검색하지 않음: 기억·좌표). **`unavailable`이면 검색을 못 한 것이지 0개가 아닙니다**(시간 초과·오류·키 거절·키 없음). 차는 이때 '장소 빈 일정에 올림'으로 처리하지 말고 "어디로 갈까요?"로 넘어가야 합니다.
- `via`: 어떻게 정했는가. `coordinates`(글자가 좌표) · `address`(정확한 주소 → 좌표, 검색 없음) · `memory` · `search`.
- 순서(서버): ① `query`가 좌표면 그대로, 주소처럼 보이면 주소 검색(정확히 한 곳일 때만 확정) ② 기억 조회(`key`) ③ 키워드 검색(`query`). 주소처럼 보여도 못 정하면 ②·③으로 넘어갑니다.
- **좌표 글자 판정**: **소수점 아래 3자리 이상인 두 수**이고 한국 범위(위도 33~39, 경도 124~132)일 때만 좌표입니다(`35.1595, 126.8526`). `10 30`·`3, 15`·`35 126`·`35.15, 126.85`는 좌표가 아니라 검색어입니다.
- 429 `rate-limited`: 요청 주소별 검색 한도(분당 60회, 외부 검색을 부를 때만 셈. 기억·좌표로 답하는 요청은 안 셈).

### `PUT /places/memory`

요청: `{ name: string, place: { name: string, lat: number, lng: number, address?: string|null }, ambiguous: boolean }`. `place.address`만 생략할 수 있고 나머지는 필수이며 모르는 필드는 400입니다(`name` 1~300자, `place.name` 1~200자, `address` 300자 이하).
응답 200: 저장한 `{ name, place: { name, address, lat, lng }, ambiguous, updatedAt }`.

- 이름은 **기존 정규화(앞뒤 공백 제거, 연속 공백 하나로, 소문자: `normalizePlaceName`)가 같으면 같은 이름**이라 덮어씁니다(목 장소 이름의 '완전 일치' 판정과 같은 규칙). 저장되는 `name`은 공백만 정리한 글자입니다.
- 이름 키(차가 `name`으로 보낼 글자): 일정의 **장소 칸 글자**이고, 장소 칸이 비었으면 **일정 제목**입니다. 서버가 일정에 기억을 적용할 때 같은 규칙으로 찾습니다. `resolve`에서는 이 글자를 `key`로 보냅니다.
- 자리는 위 '자리 정하기' 표대로입니다(차 토큰은 `driver` 필수).
- **용량(가안)**: 연결된 자리는 **200개**, 연결 전 버킷은 **20개**(`MAX_BUCKET_MEMORIES`)까지이고 넘으면 **가장 오래 전에 쓴 기억부터 버립니다**. 버킷이 연결해 자리가 되면 상한이 200개로 풀립니다. 기억 하나는 최대 약 2.4KB(이름 300자 + 장소 이름 200자 + 주소 300자, 한글 3바이트)라 자리 하나는 최대 약 0.5MB, 버킷 500개는 약 24MB입니다(J1의 일정 예산과 별개로 이 상한이 용량을 묶습니다).
- **속도 제한**: 요청 주소별 분당 30회(`MEMORY_WRITE_MAX`, 본문 검증을 통과한 요청만 셈). 넘으면 429 `rate-limited`이고 저장하지 않습니다. 같은 요청 주소가 아닌 곳은 영향 없음.
- 오류: 남의 자리 `driver`는 403, 차 토큰만 있고 `driver`가 없으면 400 `driver-required`, 모르는 토큰은 401, 식별 없는데 자리 있는 차가 있으면 429 `unwritable`.

### `GET /places/memory` · `DELETE /places/memory?name=`

- `GET` 응답: `{ memories: [{ name, place, ambiguous, updatedAt }] }`(최근에 쓴 것부터).
- `DELETE`: 이름은 **쿼리 `name`**으로 보냅니다(`/`·`#`·`?`·`%`가 든 이름도 안전합니다). 정규화해서 찾고, 지웠으면 200 `{ name }`, 없으면 404, `name`이 없거나 비었거나 300자를 넘으면 400. 버킷을 만들지 않습니다.
- 폰 클라이언트는 `phone/src/features/places/memoryApi.ts`(`placeMemoryApi`)이고, 목록·지우기 화면은 장소 탭의 '기억한 장소'(`features/places/RememberedPlaces.tsx`, 지우기는 확인을 거침, 이미 없으면(404) 지운 것과 같음)입니다.

### `GET /places/search` (기존, 호환)

응답은 목 출처일 때 기존과 똑같은 `{ places: [{ id, name, address, lat, lng }] }`(최대 10개)입니다. `lat`·`lng`(함께, 선택)를 주면 가까운 순입니다. 카카오 출처면 `source: "kakao"`가, 검색을 못 했으면(키 없음 포함) `places: []`와 `source: "unavailable"`이 덧붙습니다. 429 `rate-limited`(같은 요청 주소 한도를 `resolve`와 나눠 씀). 검색어는 50자·위치는 소수 3자리로 줄여 외부에 보냅니다. **실제 자리에서는 목 결과를 주지 않습니다**(위 표).

### 장소 스냅숏 저장 (자주 가는 곳·일정 보정)

카카오 키를 켜면 `GET /places/search`가 외부 장소(`id: kakao:…`)를 줍니다. 두 저장소가 이를 받도록 **목 `placeId` 요청은 그대로 두고 장소 스냅숏 요청을 더했습니다**(둘 중 하나만 보냅니다).

- `PUT /places/favorites/home`·`/work`, `POST /places/favorites/others`: `{ placeId }`(기존, 목 장소 id) 또는 `{ place: { name, lat, lng, address?, externalId? } }`.
- `DELETE /places/favorites/others/:id`(정책서 10.8 '자주 가는 곳: 추가·삭제'): 단골 하나를 빼고 전체 상태를 돌려줍니다. 가드는 위 쓰기와 같고(폰 토큰 = 그 자리, 기기 id = 연결 전 버킷, 식별 없음 = 기본 자리, 차 토큰은 401) **지우기는 연결 전 버킷을 만들지 않습니다.** id는 목 장소 id·`ext:<externalId>`·`geo:<위도>,<경도>`이고, 집·회사나 없는 id는 404, 100자 초과는 400입니다. 폰은 장소 탭의 단골 줄 [삭제]에서 확인('지울까요?')을 거쳐 부르고, 404(이미 없음)는 지운 것으로 보고 최신 목록을 다시 읽습니다. 집·회사는 삭제 대신 다른 장소로 바꿉니다(`PUT … { placeId: null }`은 있지만 화면은 없음).
- `PUT /schedules/:id/place`: `{ placeId: string|null }` 또는 `{ place: {…} }` 또는 `{ noTravel: true }`.
- 스냅숏 검증: `name` 1~200자, `lat`·`lng` 범위, `address` 300자 이하, `externalId`는 영문·숫자·`: _ . -` 100자 미만, 모르는 필드·`placeId`와 함께 보내기는 400.
- 서버는 스냅숏을 **그 자리 저장소에 값으로** 저장합니다(외부 id를 다시 조회하지 않음). 저장소의 장소 id는 `externalId`가 있으면 `ext:<externalId>`, 없으면 `geo:<위도>,<경도>`입니다(같은 외부 장소를 다른 칸으로 옮기면 원래 칸에서 빠지는 규칙은 목 장소와 같음). 응답은 이전과 같은 모양(`id`·`name`·`address`·`lat`·`lng`)입니다.
- 폰의 장소 검색 화면은 검색 결과를 고르면 목 출처(`source` 없음)는 `placeId`로, 외부 출처(`source: "kakao"`)는 스냅숏으로 저장합니다. `source: "unavailable"`이면 "지금은 장소를 검색할 수 없어요"를 보입니다.

## 일정 장소를 정할 때 기억이 쓰이는 방식 (`/schedules/today`·`/schedules/places`)

폰 일정과 픽스처 일정 모두 순서가 **보정(`PUT /schedules/:id/place`) → 자리의 장소 기억 → 목 장소 이름 완전 일치(기본 자리·`FIXTURE_SEATS=1`만) → (없으면) `suggestion`** 입니다. 픽스처 일정에 이미 `place`(좌표)가 있으면 그것이 먼저입니다.

- **애매하지 않은 기억(`ambiguous: false`)**: `place`가 기억한 장소의 `{ name, lat, lng }`로 확정되고 `suggestion`은 `null`입니다. 응답에 `placeMemory: { ambiguous: false }`가 **덧붙습니다**(기억에서 온 장소일 때만, 아니면 필드가 없음 — 기억을 쓰지 않는 기존 응답은 한 글자도 바뀌지 않습니다).
- **애매한 기억(`ambiguous: true`)**: 확정하지 않습니다. `place`는 `null`이고 확인 필요(`suggestion`)로 내립니다:
  ```json
  { "placeId": null, "name": "스타벅스 상무점", "source": "memory", "ambiguous": true,
    "place": { "name": "스타벅스 상무점", "address": "광주 서구 상무로 1", "lat": 35.15, "lng": 126.85 } }
  ```
  `/schedules/places`는 기존 `suggestion` 자리에, `/schedules/today`는 이 경우에만 `suggestion` 필드를 덧붙입니다(그 밖에는 필드가 없음). 지금 차 앱은 모르는 필드를 무시하고 장소 없음으로 다루므로 **확인 없이 길안내하지 않습니다.** 차 쪽 묶음이 "지난번처럼 {장소}로 갈까요?"를 구현할 때 `suggestion.source === "memory"`·`ambiguous`·`place`를 씁니다. 폰 3단계의 '여기 맞아요'는 이 `place`를 스냅숏으로 저장합니다(`placeId`가 `null`이므로).
- 목 장소 후보의 `suggestion`은 기존 그대로 `{ placeId, name }`입니다(`source`·`ambiguous` 없음).
- 보정(장소 넣기)이 이기고, 이동 없음이면(일정별 이동 없음이든 이름으로 기억한 이동 없음 `skipped`든 — `docs/calendar-sync.md`) 기억을 쓰지 않으며, 보정을 지우면 기억으로 돌아갑니다. 좌표가 이미 있는 픽스처 일정(`place`)에는 쓰지 않습니다. 기억이 있으면(애매하든 아니든) 같은 일정의 목 장소 완전 일치·부분 일치·제목 시드는 쓰지 않습니다.
- `fixtures/places/remembered.json`(제목 → 목 장소)은 **픽스처·데모 자리(기본 자리와 `FIXTURE_SEATS=1`)의 시드**로만 쓰며 확정하지 않는 `suggestion`으로만 내립니다(기존 계약). 기억 저장소에는 들어가지 않고 `GET /places/memory`에도 안 나오며, 실제 자리에는 새지 않습니다.
- 이 라우트들은 외부 검색을 부르지 않습니다(주소 지오코딩·키워드 검색은 차가 `POST /places/resolve`로 부릅니다).

## 자리별 저장 (정책서 10.1·10.9·11장)

기억은 `SeatData.memory`(자리 하나의 저장소, `server/src/placeMemory.ts`)라서:
- 자리마다 따로 쌓입니다(자리 A의 기억이 자리 B의 목록·resolve·일정에 보이지 않음).
- 폰의 연결 끊기(`DELETE /pair`), 차의 `DELETE /car`·옛 초기화로 자리가 지워지면 함께 지워집니다.
- 폰 바꾸기(같은 자리 이어받기)에서는 유지됩니다(폰 바꾸기는 일정·캘린더 선택만 비웁니다).
- 연결 전 폰(기기 id만)이 쓰면 그 기기의 버킷(20개까지)에 쌓이고 연결할 때 새 자리가 이어받습니다(그때 상한이 200개로 풀림). 저장은 메모리뿐이라 서버를 다시 켜면 사라집니다.

## 8장 단계별: 서버가 맡은 것과 차가 맡을 것

| 8장 단계 | 서버 | 차 |
| --- | --- | --- |
| 1. 좌표·정확한 주소면 검색하지 않음 | `resolve`가 `query`가 좌표(소수 3자리 이상·한국 범위)면 `via: coordinates`, 정확한 주소(주소 검색이 정확히 한 곳)면 `via: address`로 답함. 서버의 일정 라우트는 기본 자리·`FIXTURE_SEATS=1`에서만 목 장소 이름 완전 일치를 확정 | 캘린더가 좌표·주소를 주면 그 글자를 `query`로 `resolve`를 부르고 `via`가 `address`·`coordinates`면 그대로 씀 |
| 2. 기억이 1순위 | `memory`로 답함(`key`로 조회), 일정 응답에도 `place`+`placeMemory` 반영 | 기억 있으면 출발 제안으로 |
| 2a. 후보 하나였던 이름: 확인 없이 | `ambiguous: false` 표시, 일정 `place` 확정 | 확인 없이 출발 제안 |
| 2b. 애매한 이름: "지난번처럼 {장소}로 갈까요?" | `ambiguous: true` 표시(`resolve.memory`), 일정 응답은 **확정하지 않고** `suggestion { source: "memory", ambiguous: true, place }` | 매번 그 문장으로 확인(말·카드), 예면 `suggestion.place`로 길안내 |
| 3. 검색(현재 위치 기준 가까운 순) | `candidates` 최대 2개 + `total` + `distanceMeters` (`query`만 외부로, 50자·위치 소수 3자리) | 현재 위치(`lat`·`lng`)를 같이 보내고, `distanceMeters`로 먼 후보를 거름 |
| 3a. 1개: 바로 쓰고 기억 | `total: 1` | 거리 상한 안이면 바로 쓰고 `PUT /places/memory`(`ambiguous: false`) |
| 3b. 2개 이상: 가까운 2개 타일 "어느 쪽이에요?" | `total ≥ 2`, 후보 2개 | 타일·고르기, 고른 곳을 `ambiguous: true`로 `PUT` |
| 3c. 0개: 폰 홈 '장소 빈 일정'에 올리고 "어디로 갈까요?" | `total: 0`(`source`가 `unavailable`이 아닐 때). '장소 빈 일정'은 별도 저장 없이 `GET /schedules/places`에서 `place: null`·이동 없음 아님인 일정으로 이미 보임 | "어디로 갈까요?"로. `source: "unavailable"`이면 못 찾음이 아니라 검색 장애로 구분 |
| 4. 장소 칸이 빈 일정: 60분 전부터 묻기, 들은 이름으로 3번, "안 가요"면 이동 없음 | `resolve`가 들은 이름을 `query`, 일정 제목을 `key`로 받아 처리(제목은 외부로 안 나감) | 질문·60분 조건·음성 인식. "안 가요"의 이동 없음 기억은 `PUT /skips`(J2b, `docs/calendar-sync.md`) |
| 5. "다음부터 '{일정}'은 여기로 기억할게요." + 서버 저장 | `PUT /places/memory`(이름 → 장소, 애매 여부), 일정 응답 반영 | 말하기와 저장 호출(이름은 장소 칸 글자, 비면 제목) |
| 5'. '캘린더에 장소 적기' | **만들지 않음**(사용자가 뺌). `GET /places/memory`는 폰의 기억 목록 화면용 | — |
| 10.8 기억한 장소 지우기 | `GET /places/memory`·`DELETE /places/memory?name=` | — (폰 화면은 장소 탭의 '기억한 장소') |

## 차 쪽 묶음이 알아야 할 점

- **자리**: `driver=<seatId>`와 **차 토큰을 꼭 함께** 보냅니다(`resolve`·`GET`·`PUT`·`DELETE` 모두). 차 토큰만 보내면 400 `driver-required`이고, 식별 없이 보내면 서버에 자리 있는 차가 있을 때 기억을 읽지도 쓰지도 못합니다(옛 차 앱 호환은 이 API에 없습니다).
- **일정의 기억 키는 일정 제목(장소 칸이 비었을 때)이고, 외부 검색어는 들은 이름**입니다. 장소 칸이 빈 일정은 `resolve`에 `{ query: 들은 이름, key: 일정 제목 }`을 보내고, 저장은 `PUT /places/memory`의 `name`에 같은 일정 제목(장소 칸이 있으면 그 글자)을 보내야 `/schedules/today`가 다음 번에 그 기억을 반영합니다. 일정 제목을 `query`로 보내면 제목이 외부 검색으로 나갑니다(50자로 잘리긴 하지만 보내지 마세요).
- `GET /schedules/today`에서 `placeMemory`가 있는 일정은 확정된 기억(애매하지 않음)이고, **`suggestion.source === "memory"`·`ambiguous === true`인 일정은 `place`가 `null`이며 "지난번처럼 {suggestion.place.name}로 갈까요?"로 확인해야 합니다.**
- `resolve`의 `total`은 카카오 `meta.total_count`라 전국 일치 수이고 목록 크기보다 훨씬 클 수 있습니다. 0·1·2 이상만 가르는 값으로 쓰되, **`total: 1`이 아주 먼 곳일 수 있으니 `distanceMeters`로 거리 상한을 보세요.**
- `source: "unavailable"`(시간 초과 3초·키 없음 포함)은 재시도 대상이 아니라 "어디로 갈까요?"로 넘어가는 경우입니다.
- 현재 위치는 `lat`·`lng`로 같이 보냅니다(서버가 소수 3자리로 줄여 외부에 보냅니다). 위치를 못 얻었으면 생략해도 되지만 거리순이 아닙니다.
- 이동 일정에만 부르세요(이동 없음 일정은 서버가 해석하지 않습니다).

## 한계

- 서버의 일정 응답은 외부 검색을 하지 않으므로 주소로만 적힌 일정은 차가 `resolve`를 불러야 좌표가 생깁니다.
- 속도 제한·요청 주소는 프록시 뒤에서 `createApp({ clientAddress })`를 바꿔야 맞게 셉니다(`docs/pairing.md`와 같음). 캐시·제한·기억은 모두 메모리라 서버를 다시 켜면 사라집니다.
- 주소처럼 보이는지는 정규식 휴리스틱입니다(`…로·길·동·읍·면·리 + 번지`). 틀려도 정확히 한 곳이 아니면 키워드 검색으로 넘어가 좌표를 잘못 확정하지는 않습니다.
- 키가 없는 서버에서 실제 자리는 장소 검색을 쓸 수 없습니다(`unavailable`). 목 검색으로 시연하려면 `FIXTURE_SEATS=1`(데모 전용)입니다. 폰 E2E(`scripts/e2e-phone.sh`)는 그래서 서버를 `FIXTURE_SEATS=1`로 띄웁니다.
- 스냅숏 저장은 폰이 보낸 이름·좌표를 그대로 믿습니다(서버는 외부 id를 다시 확인하지 않음). 그 자리 안에서만 보이는 값입니다.

## 검증

`pnpm server:test`: `server/test/place-search.test.ts`(목·카카오 요청 조립·문서 예시 응답 읽기·실패·본문 수신 중·`signal` 무시 시간 초과·키 미노출·캐시·속도 제한·실패 로그 간격·좌표 글자 판정), `place-resolve.test.ts`(resolve 0/1/2개 이상·거리순·주소·좌표·기억 우선·`query`/`key` 분리·50자·위치 소수 3자리·실제 자리에서 목 안 씀·`unavailable`·검증·속도 제한·`GET /places/search` 호환), `place-memory.test.ts`(저장·정규화·검증·자리 정하기(차 토큰 `driver` 필수·식별 없음 빈 범위)·용량·속도 제한·자리 격리·끊기·폰 바꾸기·쿼리로 지우기·일정 반영·애매 기억 suggestion·픽스처 회귀), `place-snapshot.test.ts`(스냅숏 검증·자주 가는 곳·일정 보정·차 응답). 폰: `pnpm phone:test`(`memoryApi.test.ts`, 실제 `hc`를 서버 앱에 묶은 `memoryWiring.test.ts`, `PlaceSearchScreen.test.tsx`의 외부 결과·검색 불가 안내).
