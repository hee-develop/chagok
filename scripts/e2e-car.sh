#!/usr/bin/env bash
# 차량 앱 E2E(Maestro): debug 앱을 설치하고 서버를 띄운 뒤 flow를 돌리고 서버를 내린다.
# flow는 e2e/maestro/car/ 아래 pairing.yaml, boarding-briefing.yaml, depart-route.yaml, arrival-next.yaml, home-exit.yaml, fake-navi.yaml(가짜 길안내, debug 전용) 순서로 돈다.
# 위치 권한(ACCESS_FINE_LOCATION·COARSE)은 설치 직후 adb로 미리 허용해 권한 설명 카드가 flow를 가리지 않게 한다(앱이 도는 사용자 기준).
# home-exit는 앞뒤로 서버 자주 가는 곳의 집(mock-home-apt)을 등록·해제한다(끝나는 즉시 해제해 뒤 flow가 집이 등록된 채 돌지 않게 한다).
# 사용: pnpm e2e:car   (에뮬레이터 하나가 떠 있어야 한다. 여러 기기가 붙어 있으면 ANDROID_SERIAL=emulator-5554)
# 환경 변수: E2E_FRESH_INSTALL=1 이면 앱을 지우고 설치한다(처음 설치 상태). E2E_OUT은 산출물 루트(기본 e2e/output/car).
# 실행마다 $E2E_OUT/<시각>/ 폴더를 새로 만들고 스크린샷(shots/)과 로그는 그 안에만 둔다.
set -euo pipefail
# 백그라운드로 띄운 서버가 자기 프로세스 그룹을 갖도록 job control을 켠다(그룹 전체를 한 번에 종료하려고 쓴다)
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"
RUN_DIR="${E2E_OUT:-$ROOT/e2e/output/car}/$(date +%Y%m%d-%H%M%S)"
SHOTS="$RUN_DIR/shots"
MAESTRO="${MAESTRO_BIN:-$(command -v maestro || echo "$HOME/.maestro/bin/maestro")}"

if [ ! -x "$MAESTRO" ]; then
  echo "maestro가 없습니다. 설치: curl -Ls https://get.maestro.mobile.dev | bash" >&2
  exit 1
fi

if [ -z "${ANDROID_SERIAL:-}" ]; then
  devices=$(adb devices | awk '$2=="device"{print $1}')
  if [ "$(echo "$devices" | grep -c .)" -ne 1 ]; then
    echo "기기가 하나가 아닙니다. ANDROID_SERIAL을 지정하세요:" >&2
    echo "$devices" >&2
    exit 1
  fi
  export ANDROID_SERIAL="$devices"
fi

if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "포트 $PORT 를 이미 쓰고 있습니다. 서버를 내리고 다시 실행하세요." >&2
  exit 1
fi

# 화면에 찍히는 시각이 장면(09:20 KST)과 같도록 기기 시간대를 서울로 맞추고, 끝나면 원래대로 되돌린다.
# 원래 값이 비어 있었으면(기본 시간대) UTC로 맞춘 뒤 persist.sys.timezone을 다시 비운다.
PREV_TZ="$(adb shell getprop persist.sys.timezone | tr -d '\r')"
adb shell cmd alarm set-timezone Asia/Seoul >/dev/null

SERVER_PGID=""
stop_server() {
  [ -n "$SERVER_PGID" ] || return 0
  kill -TERM -- "-$SERVER_PGID" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 -- "-$SERVER_PGID" 2>/dev/null || break
    sleep 0.25
  done
  kill -KILL -- "-$SERVER_PGID" 2>/dev/null || true
  wait "$SERVER_PGID" 2>/dev/null || true
  SERVER_PGID=""
}

restore_timezone() {
  if [ -n "$PREV_TZ" ]; then
    adb shell cmd alarm set-timezone "$PREV_TZ" >/dev/null 2>&1 || true
  else
    adb shell cmd alarm set-timezone UTC >/dev/null 2>&1 || true
    adb shell setprop persist.sys.timezone "" >/dev/null 2>&1 ||
      echo "경고: persist.sys.timezone을 비우지 못했습니다. 기기 시간대가 UTC로 남아 있을 수 있습니다." >&2
  fi
}

# flow가 중간에 실패해도 flow가 바꾼 debug 주입값(가짜 내비·소요 시간·길안내 결과·듣기·가짜 경로 시간·위치·하차 카드 시간)이 앱에 남지 않게 되돌린다.
# 이 스크립트(flow)가 바꾸는 값만 되돌린다. 연결 상태(paired)·시계(now)는 기존처럼 되돌리지 않는다. adb가 실패해도 정리는 계속한다.
reset_injection() {
  adb shell "am start -a android.intent.action.VIEW -d 'chagok-debug://signal?navi=real&trip=real&route=real&listen=real&drive=4.5&loc=real&exitcard=real'" </dev/null >/dev/null 2>&1 ||
    echo "경고: debug 주입값을 되돌리지 못했습니다(adb 실패). 앱에 navi·trip·route·listen·drive·loc·exitcard 주입값이 남아 있을 수 있습니다." >&2
  sleep 1
}

cleanup() {
  # trap 안에서는 한 단계가 실패해도 끝까지 간다(set -e 해제)
  set +e
  # Maestro가 테스트 출력 폴더 깊은 곳에 두는 이번 실행의 스크린샷을 $SHOTS 로 모은다
  mkdir -p "$SHOTS"
  find "$RUN_DIR/maestro" -path '*takeScreenshot*' -name '*.png' -exec cp {} "$SHOTS/" \; 2>/dev/null || true
  # flow가 home-exit 중간에 실패해도 서버에 집이 남지 않게 한다(서버는 곧 내려가지만 실행 중인 동안의 정리).
  curl -fs -X PUT "http://127.0.0.1:$PORT/places/favorites/home" -H 'content-type: application/json' -d '{"placeId":null}' >/dev/null 2>&1
  reset_injection
  restore_timezone
  stop_server
}
trap cleanup EXIT

if [ "${E2E_FRESH_INSTALL:-}" = "1" ]; then
  echo "== 앱 삭제(처음 설치 상태)"
  adb uninstall com.chagok.car >/dev/null 2>&1 || true
fi
echo "== debug 앱 설치"
(cd "$ROOT/car" && ./gradlew :app:installDebug -q -Pchagok.serverPort="$PORT")

# 위치 권한 미리 허용. Pleos 에뮬레이터는 앱이 현재 사용자(예: 10)에서 돌아 그 사용자로 허용한다.
# 허용하지 못하면 권한 설명 카드가 flow를 가릴 수 있어 경고한다(멈추지는 않는다: 이미 허용돼 있을 수 있다).
CUR_USER="$(adb shell am get-current-user 2>/dev/null | tr -d '\r')"
for perm in android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION; do
  if ! adb shell pm grant --user "${CUR_USER:-0}" com.chagok.car "$perm" >/dev/null 2>&1 &&
     ! adb shell pm grant com.chagok.car "$perm" >/dev/null 2>&1; then
    echo "경고: $perm 을 허용하지 못했습니다(사용자 ${CUR_USER:-0}). 권한 설명 카드가 flow를 가릴 수 있습니다." >&2
  fi
done

echo "== 서버 시작 (포트 $PORT)"
mkdir -p "$RUN_DIR"
# watch 없이 한 번만 띄운다. 서브셸이 곧 프로세스 그룹 리더라 그룹 전체(tsx와 자식 node)를 함께 종료한다.
# FIXTURE_SEATS=1: pairing flow가 연결한 자리(일정을 받은 적 없음)도 이어지는 flow에서 픽스처 일정을 쓰게 한다(데모·E2E 전용).
(cd "$ROOT/server" && PORT="$PORT" FIXTURE_SEATS=1 exec ./node_modules/.bin/tsx src/index.ts >"$RUN_DIR/server.log" 2>&1) &
SERVER_PGID=$!
for _ in $(seq 1 30); do
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "http://127.0.0.1:$PORT/health" >/dev/null || { echo "서버가 뜨지 않았습니다. $RUN_DIR/server.log 를 확인하세요." >&2; exit 1; }

echo "== Maestro 실행 (스크린샷: $SHOTS)"
cd "$ROOT"
# 서버 자주 가는 곳의 집을 정한다(placeId가 null이면 지운다). 차는 일정 응답(favorites)으로 받아 간다.
set_home() {
  curl -fs -X PUT "http://127.0.0.1:$PORT/places/favorites/home" -H 'content-type: application/json' -d "{\"placeId\":$1}" >/dev/null ||
    { echo "서버에 집을 등록하지 못했습니다($1)." >&2; exit 1; }
}

for flow in pairing boarding-briefing depart-route arrival-next home-exit fake-navi; do
  echo "-- $flow"
  if [ "$flow" = "home-exit" ]; then set_home '"mock-home-apt"'; fi
  "$MAESTRO" test "e2e/maestro/car/$flow.yaml" \
    --device "$ANDROID_SERIAL" \
    -e SHOT_DIR="$SHOTS" \
    -e SERVER_URL="http://127.0.0.1:$PORT" \
    --test-output-dir "$RUN_DIR/maestro/$flow"
  # home-exit가 끝나면 바로 집 등록을 풀어 뒤 flow(fake-navi)가 집이 등록된 채 돌지 않게 한다.
  if [ "$flow" = "home-exit" ]; then set_home null; fi
done
