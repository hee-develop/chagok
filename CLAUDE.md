# 차곡

Pleos Connect(현대차그룹 AAOS 기반 인포테인먼트) 차량 앱 사이드 프로젝트입니다.

## 구조

- `car/`: 차량 앱. Kotlin 네이티브 + Pleos Connect SDK. 독립 Gradle 프로젝트이고 패키지는 `com.chagok.car`
- `phone/`: 휴대폰 앱. React Native(Expo). 패키지는 `@chagok/phone`
- `server/`: 서버. TypeScript + Hono, Node 런타임. 패키지는 `@chagok/server`
- `docs/`: 기획·설계 문서
- JS 쪽(`phone/`, `server/`)은 pnpm 워크스페이스로 묶여 있습니다. 설치는 루트에서 `pnpm install`로 하고, 폰 앱은 서버의 라우트 타입(`AppType`)을 Hono RPC 클라이언트로 가져다 씁니다.

## Pleos 설계 가이드 점검

차량 앱(`car/`) 코드는 [Pleos Connect 앱 설계 가이드](https://document.pleos.ai/docs/pleos-only/vehicle-app-planning-guide/intro)와 [앱 개발 가이드](https://document.pleos.ai/docs/pleos-only/vehicle-app-developer-guide/intro)를 따라야 합니다. 준수 여부는 `pleos-guide-checker` 에이전트로 점검합니다.

- 정의: `.claude/agents/pleos-guide-checker.md`. 읽기 전용이라 코드를 고치지 않고 보고만 합니다.
- 부르는 법: 이 폴더에서 연 세션에서 `@agent-pleos-guide-checker <요청>`을 입력합니다. 범위를 주지 않으면 커밋하지 않은 변경분을 보고, 변경분이 없으면 차량 앱 모듈 전체를 봅니다.
- 다른 폴더의 세션에서 부를 때: `cd ~/Projects-my/chagok && claude -p "@agent-pleos-guide-checker 차량 앱 가이드 점검해줘"`처럼 별도 실행으로 부릅니다. 결과만 받고 이어서 대화할 수는 없습니다.
- 언제 부르나: 차량 앱 기능 하나를 끝냈을 때, 또는 화면·매니페스트·오디오·주행 규제·SDK 연동 코드를 바꿨을 때 부릅니다. 자동 실행 훅은 두지 않았습니다.
- 기준 원문: `.claude/pleos-guide-snapshot/`에 2026-10-29 시점 원문이 있습니다. 가이드가 바뀌면 에이전트가 "가이드 변경 감지"로 알려 주는데, 이때 체크리스트와 스냅샷을 함께 갱신합니다.

### 가이드에서 해석이 갈리는 지점

- 주행 중 사용 가능 선언(DO)을 매니페스트에 쓰는 방법은 Pleos 문서에 없습니다. 그래서 AAOS 방식(`distractionOptimized` meta-data)을 기준으로 점검합니다. 실제로 동작하는지는 에뮬레이터에서 확인해야 합니다.
- 지역별 주행 제한을 적용하는 주체를 두고 두 문서가 다르게 말합니다.
  - FAQ: 앱이 `product.sw.target_region`으로 지역별 UX 정책을 직접 적용해야 한다.
  - 주행 규제 개발 가이드: 플랫폼이 지역에 맞는 `ActiveRestrictions`를 내려주므로 앱은 그것만 반영하면 된다.
  - 그래서 지역 코드로 분기하는 코드는 위반으로 보지 않고 "확인 필요"로 다룹니다.
