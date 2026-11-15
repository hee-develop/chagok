#!/usr/bin/env bash
# 차량 앱 E2E(Maestro): debug 앱을 설치하고 서버를 띄운 뒤 flow를 돌리고 서버를 내린다.
# flow는 e2e/maestro/car/ 아래 pairing.yaml, boarding-briefing.yaml, depart-route.yaml, arrival-next.yaml, home-exit.yaml, fake-navi.yaml(가짜 길안내, debug 전용), reask.yaml(무응답 30초 → 다시 묻기), target.yaml(이미 그곳), overlap.yaml(일정 겹침, 전용 픽스처 overlap-day.json이라 서버를 다시 띄움) 순서로 돈다.
# 환경 변수 E2E_FLOWS로 일부만 돌릴 수 있다. 전용 픽스처 flow(overlap)가 끝나면 종료 때 기본 픽스처로 다시 받아 앱에 남은 그 일정 사본을 덮어쓴다.
# 위치 권한(ACCESS_FINE_LOCATION·COARSE)은 설치 직후 adb로 미리 허용해 권한 설명 카드가 flow를 가리지 않게 한다(앱이 도는 사용자 기준).
# home-exit flow는 안에서 연결을 새로 만들고(차 화면 번호를 폰 대신 서버에 보냄) 그 폰 토큰으로 서버 자주 가는 곳의 집(mock-home-apt)을 등록·해제한다.
# 연결된 자리가 있는 서버는 식별 없는 읽기(차 앱)를 그 자리로 보내므로, 이 스크립트가 식별 없이 PUT하면 기본 자리에 들어가 차가 못 본다(docs/pairing.md).
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
# 가짜 내비는 debug 기본값(켬)으로 되돌린다(flow는 시작 신호에서 navi=real을 명시한다). 이 스크립트(flow)가 바꾸는 값만 되돌린다. 연결 상태(paired)·시계(now)는 기존처럼 되돌리지 않는다. adb가 실패해도 정리는 계속한다.
reset_injection() {
  adb shell "am start -a android.intent.action.VIEW -d 'chagok-debug://signal?navi=fake&trip=real&route=real&listen=real&drive=4.5&loc=real&exitcard=real'" </dev/null >/dev/null 2>&1 ||
    echo "경고: debug 주입값을 되돌리지 못했습니다(adb 실패). 앱에 navi·trip·route·listen·drive·loc·exitcard 주입값이 남아 있을 수 있습니다." >&2
  sleep 1
}

# 전용 픽스처(overlap)로 돈 flow가 끝나면 앱이 그 픽스처의 오늘 일정 사본을 저장해 둔 채 남는다(다른 데모·E2E·수동 확인에 겹침 일정이 보임).
# 서버를 기본 픽스처로 다시 띄우고 데모 초기화 신호로 일정을 다시 받게 해 그 사본을 기본 일정으로 덮어쓴다. 시각은 flow들이 쓰는 데모 시각(09:20 서울)이다.
restore_default_schedules() {
  [ -n "$CURRENT_FIXTURE" ] || return 0
  stop_server
  CURRENT_FIXTURE=""
  if start_server ""; then
    adb shell "am start -a android.intent.action.VIEW -d 'chagok-debug://signal?now=2026-11-06T00:20:00Z'" </dev/null >/dev/null 2>&1 ||
      echo "경고: 데모 초기화 신호를 보내지 못했습니다(adb 실패). 앱에 전용 픽스처의 일정 사본이 남아 있을 수 있습니다." >&2
    sleep 2
  else
    echo "경고: 기본 픽스처 서버를 띄우지 못해 앱에 전용 픽스처의 일정 사본이 남아 있을 수 있습니다." >&2
  fi
}

cleanup() {
  # trap 안에서는 한 단계가 실패해도 끝까지 간다(set -e 해제)
  set +e
  # Maestro가 테스트 출력 폴더 깊은 곳에 두는 이번 실행의 스크린샷을 $SHOTS 로 모은다
  mkdir -p "$SHOTS"
  find "$RUN_DIR/maestro" -path '*takeScreenshot*' -name '*.png' -exec cp {} "$SHOTS/" \; 2>/dev/null || true
  reset_injection
  restore_default_schedules
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

mkdir -p "$RUN_DIR"
# 서버를 띄운다. $1은 픽스처 경로(저장소 루트 기준, 비우면 기본 픽스처). watch 없이 한 번만 띄운다.
# 서브셸이 곧 프로세스 그룹 리더라 그룹 전체(tsx와 자식 node)를 함께 종료한다.
# FIXTURE_SEATS=1: pairing flow가 연결한 자리(일정을 받은 적 없음)도 이어지는 flow에서 픽스처 일정을 쓰게 한다(데모·E2E 전용).
start_server() {
  echo "== 서버 시작 (포트 $PORT${1:+, 픽스처 $1})"
  (cd "$ROOT/server" && exec env PORT="$PORT" FIXTURE_SEATS=1 ${1:+"FIXTURE_PATH=$1"} ./node_modules/.bin/tsx src/index.ts >>"$RUN_DIR/server.log" 2>&1) &
  SERVER_PGID=$!
  for _ in $(seq 1 30); do
    curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null || { echo "서버가 뜨지 않았습니다. $RUN_DIR/server.log 를 확인하세요." >&2; return 1; }
}

# flow마다 쓰는 픽스처: overlap은 점심과 경기가 이동 시간상 겹치는 전용 픽스처, 나머지는 기본 픽스처
fixture_for() {
  case "$1" in
    overlap) echo "fixtures/schedules/overlap-day.json" ;;
    *) echo "" ;;
  esac
}

CURRENT_FIXTURE="$(fixture_for "$(echo "${E2E_FLOWS:-pairing}" | awk '{print $1}')")"
start_server "$CURRENT_FIXTURE" || exit 1

echo "== Maestro 실행 (스크린샷: $SHOTS)"
cd "$ROOT"
# E2E_FLOWS="reask overlap"처럼 flow 이름을 공백으로 주면 그것만 돈다(기본은 전부). 새 flow 하나를 확인할 때 쓴다.
for flow in ${E2E_FLOWS:-pairing boarding-briefing depart-route arrival-next home-exit fake-navi reask target overlap}; do
  # 픽스처가 다른 flow로 넘어갈 때는 서버를 내리고 그 픽스처로 다시 띄운다(서버 저장은 메모리라 연결·보정이 사라진다. 각 flow는 paired=true로 시작한다).
  want="$(fixture_for "$flow")"
  if [ "$want" != "$CURRENT_FIXTURE" ]; then
    stop_server
    CURRENT_FIXTURE="$want"
    start_server "$CURRENT_FIXTURE" || exit 1
  fi
  echo "-- $flow"
  "$MAESTRO" test "e2e/maestro/car/$flow.yaml" \
    --device "$ANDROID_SERIAL" \
    -e SHOT_DIR="$SHOTS" \
    -e SERVER_URL="http://127.0.0.1:$PORT" \
    --test-output-dir "$RUN_DIR/maestro/$flow"
done
