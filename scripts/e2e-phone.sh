#!/usr/bin/env bash
# 폰 앱 E2E (Android 기준): 서버와 Metro를 띄우고 Expo Go에서 Maestro flow(calendar-select, places)를 차례로 실행한다.
# 사용법: scripts/e2e-phone.sh
#
# 환경 변수
#   E2E_SERVER_PORT   서버 포트 (기본 8788)
#   E2E_METRO_PORT    Metro 포트 (기본 8082)
#   E2E_AVD           Android AVD 이름 (기본 Pixel_10_Pro_XL)
#   E2E_ANDROID_PORT  에뮬레이터 포트 (기본 5556). 5554는 다른 작업이 쓰므로 건드리지 않는다
#   E2E_SHOT_DIR      스크린샷 저장 폴더 (기본 <루트>/.e2e-shots/phone). <루트>/.e2e-shots/ 아래여야 한다
#   E2E_KEEP_DEVICES  1이면 스크립트가 띄운 에뮬레이터를 끝나도 끄지 않는다
# 서버는 127.0.0.1에만 바인딩한다. 기기의 127.0.0.1:<포트>를 adb reverse로 호스트의 Metro·서버 포트에 이어,
# 앱은 exp://127.0.0.1:<Metro>와 http://127.0.0.1:<서버>로 접속한다.
# 에뮬레이터가 이미 떠 있어 쓰는 경우에도 이 스크립트가 만든 reverse 규칙만 끝나면 지운다.
set -uo pipefail
set -m # 백그라운드 작업을 각자 프로세스 그룹으로 띄워 그룹 단위로 정리한다

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SERVER_PORT="${E2E_SERVER_PORT:-8788}"
METRO_PORT="${E2E_METRO_PORT:-8082}"
AVD="${E2E_AVD:-Pixel_10_Pro_XL}"
ANDROID_PORT="${E2E_ANDROID_PORT:-5556}"
SERIAL="emulator-${ANDROID_PORT}"
SHOT_DIR="${E2E_SHOT_DIR:-$ROOT/.e2e-shots/phone}"
LOG_DIR="${E2E_LOG_DIR:-$ROOT/.e2e-shots/logs}"
MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"

if [ "$ANDROID_PORT" = "5554" ]; then
  echo "5554는 Pleos 차량 에뮬레이터 포트입니다. E2E_ANDROID_PORT를 바꿔 주세요." >&2
  exit 2
fi

# 만들거나 지우기 전에 결과 폴더가 $ROOT/.e2e-shots/ 아래인지 확인한다
case "$SHOT_DIR" in /*) ;; *) SHOT_DIR="$PWD/$SHOT_DIR" ;; esac
case "$SHOT_DIR/" in
  */../*|*/./*) echo "E2E_SHOT_DIR에 . 또는 .. 경로 요소를 쓸 수 없습니다: $SHOT_DIR" >&2; exit 2 ;;
esac
case "$SHOT_DIR" in
  "$ROOT/.e2e-shots"/?*) ;;
  *) echo "E2E_SHOT_DIR은 $ROOT/.e2e-shots/ 아래여야 합니다: $SHOT_DIR" >&2; exit 2 ;;
esac
mkdir -p "$SHOT_DIR" || exit 2
SHOT_DIR="$(cd "$SHOT_DIR" && pwd -P)"
case "$SHOT_DIR" in
  "$ROOT/.e2e-shots"/?*) ;;
  *) echo "E2E_SHOT_DIR이 $ROOT/.e2e-shots/ 밖을 가리킵니다: $SHOT_DIR" >&2; exit 2 ;;
esac
mkdir -p "$LOG_DIR"

SERVER_PID=""
METRO_PID=""
EMULATOR_PID=""
REVERSED_PORTS=""

# 프로세스 그룹 전체에 TERM, 남아 있으면 KILL
kill_group() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 -- "-$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
}

cleanup() {
  kill_group "$METRO_PID"
  kill_group "$SERVER_PID"
  # 이 스크립트가 만든 reverse 규칙만 지운다(다른 포트의 규칙은 그대로 둔다)
  for port in $REVERSED_PORTS; do
    "$ADB" -s "$SERIAL" reverse --remove "tcp:$port" >/dev/null 2>&1 || true
  done
  # 이 스크립트가 직접 띄운 에뮬레이터만 끈다
  if [ -n "$EMULATOR_PID" ] && [ "${E2E_KEEP_DEVICES:-0}" != "1" ]; then
    "$ADB" -s "$SERIAL" emu kill >/dev/null 2>&1 || true
    kill_group "$EMULATOR_PID"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

wait_for() { # wait_for <설명> <초> <명령...>
  local what="$1" secs="$2"; shift 2
  local i=0
  while ! "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt "$secs" ]; then echo "시간 초과: $what" >&2; return 1; fi
    sleep 1
  done
}

booted() {
  if [ -n "$EMULATOR_PID" ] && ! kill -0 "$EMULATOR_PID" 2>/dev/null; then
    echo "에뮬레이터 프로세스가 종료되었습니다. 로그: $LOG_DIR/emulator.log" >&2
    exit 1
  fi
  [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]
}

ensure_emulator() {
  local state
  state="$("$ADB" -s "$SERIAL" get-state 2>/dev/null || true)"
  case "$state" in
    device) return 0 ;;
    "") ;;
    *) echo "$SERIAL 상태가 '$state'입니다. 다른 작업이 쓰는 기기일 수 있어 건드리지 않습니다." >&2; return 1 ;;
  esac
  echo "에뮬레이터 $AVD 를 포트 $ANDROID_PORT 로 부팅합니다"
  "$EMULATOR" -avd "$AVD" -port "$ANDROID_PORT" -no-snapshot-save -no-audio -no-boot-anim \
    >"$LOG_DIR/emulator.log" 2>&1 &
  EMULATOR_PID=$!
  sleep 2
  if ! kill -0 "$EMULATOR_PID" 2>/dev/null; then
    echo "에뮬레이터가 바로 종료되었습니다. 로그: $LOG_DIR/emulator.log" >&2
    return 1
  fi
  wait_for "에뮬레이터 부팅" 240 booted
}

# Expo Go의 SDK 58용 버전과 다운로드 주소는 Expo 버전 API에서 읽는다.
expo_go_info() { # expo_go_info androidClientVersion|androidClientUrl
  curl -sf https://api.expo.dev/v2/versions/latest |
    node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.sdkVersions["58.0.0"][process.argv[1]]))' "$1"
}

install_expo_go() {
  local want have apk url
  have="$("$ADB" -s "$SERIAL" shell dumpsys package host.exp.exponent | tr -d '\r' | sed -n 's/^ *versionName=//p' | head -1)"
  if ! want="$(expo_go_info androidClientVersion)" || [ -z "$want" ]; then
    if [ -n "$have" ]; then
      echo "경고: api.expo.dev에서 Expo Go 버전을 확인하지 못했습니다. 설치된 $have 로 진행합니다." >&2
      return 0
    fi
    echo "Expo Go가 없고 api.expo.dev에서 버전을 확인하지 못했습니다" >&2
    return 1
  fi
  [ "$have" = "$want" ] && return 0
  echo "Expo Go 설치 (기기 ${have:-없음} -> $want)"
  apk="$ROOT/.e2e-shots/cache/expo-go-$want.apk"
  if [ ! -s "$apk" ]; then
    mkdir -p "$(dirname "$apk")"
    url="$(expo_go_info androidClientUrl)" && curl -fsSL -o "$apk" "$url" || {
      if [ -n "$have" ]; then
        echo "경고: Expo Go $want 를 받지 못했습니다. 설치된 $have 로 진행합니다." >&2
        return 0
      fi
      return 1
    }
  fi
  "$ADB" -s "$SERIAL" install -r "$apk"
}

start_server() {
  port_in_use "$SERVER_PORT" && { echo "포트 $SERVER_PORT 사용 중. E2E_SERVER_PORT로 바꿔 주세요." >&2; return 1; }
  # watch 없이 한 번만 띄운다. pnpm을 거치지 않고 tsx를 직접 실행해 그룹 정리가 확실하다.
  (cd "$ROOT/server" && PORT="$SERVER_PORT" exec "$ROOT/server/node_modules/.bin/tsx" src/index.ts) \
    >"$LOG_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  wait_for "서버 기동" 30 curl -sf "http://127.0.0.1:$SERVER_PORT/health"
}

start_metro() {
  port_in_use "$METRO_PORT" && { echo "포트 $METRO_PORT 사용 중. E2E_METRO_PORT로 바꿔 주세요." >&2; return 1; }
  (cd "$ROOT/phone" && CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_URL="http://127.0.0.1:$SERVER_PORT" \
    exec "$ROOT/phone/node_modules/.bin/expo" start --port "$METRO_PORT" --clear) \
    >"$LOG_DIR/metro.log" 2>&1 &
  METRO_PID=$!
  wait_for "Metro 기동" 120 curl -sf "http://127.0.0.1:$METRO_PORT/status"
}

# 기기의 127.0.0.1:<포트>를 호스트 포트에 잇는다. 같은 포트가 이미 reverse돼 있으면 남의 규칙이므로 쓰지 않는다.
reverse_port() {
  local port="$1"
  if "$ADB" -s "$SERIAL" reverse --list 2>/dev/null | grep -q "tcp:$port "; then
    echo "$SERIAL 에 tcp:$port reverse 규칙이 이미 있습니다. 이전 실행이 남긴 규칙이면 'adb -s $SERIAL reverse --remove tcp:$port'로 지우고, 다른 작업이 쓰는 포트면 E2E 포트를 바꿔 주세요." >&2
    return 1
  fi
  "$ADB" -s "$SERIAL" reverse "tcp:$port" "tcp:$port" >/dev/null || return 1
  REVERSED_PORTS="$REVERSED_PORTS $port"
}

ensure_emulator || exit 1
install_expo_go || exit 1
rm -rf "$SHOT_DIR"; mkdir -p "$SHOT_DIR"
start_server || exit 1
start_metro || exit 1
reverse_port "$METRO_PORT" || exit 1
reverse_port "$SERVER_PORT" || exit 1

# flow 이름 -> 앱을 여는 주소. places는 1단계를 거치지 않고 2단계 화면으로 바로 들어간다.
FLOWS="calendar-select places"
expo_url() { # expo_url <경로>
  echo "exp://127.0.0.1:$METRO_PORT${1}?__expo_disable_fab=1"
}

code=0
for flow in $FLOWS; do
  case "$flow" in
    places) url="$(expo_url /--/setup/places)" ;;
    *) url="$(expo_url "")" ;;
  esac
  echo "== Maestro 실행: $flow (기기 $SERIAL)"
  "$MAESTRO" --device "$SERIAL" test "$ROOT/e2e/maestro/phone/$flow.yaml" \
    -e APP_ID="host.exp.exponent" \
    -e EXPO_URL="$url" \
    -e SERVER_URL="http://127.0.0.1:$SERVER_PORT" \
    --test-output-dir "$SHOT_DIR/$flow"
  flow_code=$?
  [ "$flow_code" = 0 ] && echo "$flow: 통과" || echo "$flow: 실패"
  [ "$flow_code" = 0 ] || code=$flow_code
done

echo
[ "$code" = 0 ] && echo "android: 통과" || echo "android: 실패"
echo "스크린샷: $SHOT_DIR"
exit "$code"
