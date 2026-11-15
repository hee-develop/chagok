#!/usr/bin/env bash
# 차량 앱 시나리오 데모(터미널): 광주 직관 하루(fixtures/schedules/gwangju-day.json)를 처음부터 끝까지 한 번에 이어서 보인다.
# 초기화(09:20)는 맨 처음 한 번뿐이고 그 뒤로는 데모 시계를 앞으로만 보낸다(advance):
#   09:20 첫 탑승 브리핑 → 육전집 길안내 → 도착 하차 카드 → 13:30 재탑승(집까지 모자라 충전소 경유 제안) → 도착 → 20:30 재탑승(콩물 픽업) → 도착 → 21:10 갈 곳 묻기(집) → 집 하차 카드
# 이야기 설정: 광주로 직관을 온 날이라 집이 멀리(약 300km) 있고 전기차다. 초기화 때 fuel=ev·range=900(넉넉)·home=먼 집 좌표를 주입하고, 13:30에 range를 줄여 에너지 장면을 낸다(docs/energy.md).
# 단계마다 신호를 넣고 debug 빌드가 남기는 ChagokFlow 로그를 읽어 정책서 기준 기대 동작과 맞는지 ✓/✗로 알려 준다(docs/fake-navi.md).
# 사용: pnpm demo:car   (에뮬레이터가 떠 있어야 한다. 화면은 직접 보면서 Enter로 한 단계씩 넘긴다)
#   각 단계는 "무엇을 볼지" 설명을 먼저 보이고 Enter를 기다린 뒤에야 신호를 넣는다. Enter 입력은 표준 입력이 아니라 /dev/tty에서 읽는다
#   (pnpm 경유·파이프·표준 입력 상태와 무관). 터미널이 없으면(tty 없음) 안내하고 멈춘다. 그때는 DEMO_AUTO=1로 자동 진행한다.
#   언제든 중단: Enter 대기에서 q+Enter, 어디서든 Ctrl-C(또는 TERM/HUP) 한 번. 주입값 되돌림·서버·logcat 종료·집 해제를 하고
#   "중단했습니다"와 그때까지의 요약을 보인다. 정리 중에 또 눌러도 반쯤 정리된 채 끊기지 않는다(정리가 끝날 때까지 신호를 무시).
# 환경 변수:
#   ANDROID_SERIAL  대상 기기(기본 emulator-5554). adb는 항상 -s로 지정한다.
#   DEMO_INSTALL=1  시작 전에 debug 앱을 설치한다.
#   DEMO_AUTO=1     Enter를 기다리지 않고 자동으로 끝까지 진행한다(tty 없이 돌릴 때). Ctrl-C로는 똑같이 중단된다.
#   DEMO_EXTRA=1    이야기 뒤에 '추가 점검'을 붙인다(내비 도착 없이 위치만으로 일정 장소 도착, 집 하차 인사 '오늘도 수고했어요.', 같은 날 다시 들러도 말 없음).
#                   이 점검들은 이어지는 하루에 못 넣어서 단계마다 상태를 초기화한다(시작할 때 화면에 알린다). 기본 실행은 이어지는 하루만 보인다.
#   PORT            서버 포트(기본 8787). 이미 떠 있으면 그대로 쓰고, 없으면 tsx src/index.ts로 띄웠다가 끝날 때 내린다.
#   DEMO_HOME=1     이미 떠 있는 서버에도 집 하차 단계를 위해 서버 자주 가는 곳의 집(mock-home-apt)을 등록했다가 끝나면 해제한다.
#                   이 스크립트가 서버를 띄운 경우에는 늘 한다. 기존 서버에 DEMO_HOME 없이 돌리면 집으로 가는 마지막 단계들(갈 곳 묻기·집 하차)은 건너뛴다(폰이 쓰는 서버의 집을 바꾸지 않으려고).
# 시작할 때 앱을 force-stop한 뒤 MainActivity를 다시 띄운다(DemoClock이 시작할 때 시간대를 잡고, 가짜 내비는 MainActivity가 앞에 있어야 움직인다).
# 끝날 때(Ctrl-C 포함) 주입값(trip·route·listen·drive·loc·exitcard·range·fuel·home)을 실제 값으로, navi는 debug 기본값(fake)으로 되돌린다. 휴대폰 연결 상태는 되돌리지 않는다:
# 시작할 때 paired=true로 '연결됨'으로 두므로(연결 카드가 단계 판정을 가리지 않게), PT 시연 전에는 `pnpm demo:pt reset`으로 다시 연결 전으로 돌린다.
# 시계는 실제 시간과 같이 흐르므로 `AT=HH:MM` 신호(이 스크립트 안의 약속)는 그동안 지난 시간(Enter로 지체한 시간 포함)을 빼서 그 시각에 맞춘다. 서버·앱 데이터는 바꾸지 않는다.
# 같은 에뮬레이터를 다른 세션이 쓰는 중일 수 있어 그 에뮬레이터를 대상으로 한 Maestro가 돌고 있으면 멈춘다. 이 스크립트는 e2e-car.sh와 달리 flow를 돌리지 않는다.
# 로그 문구는 car/app/src/debug/.../FlowLog.kt가 정한다. 바꾸면 아래 기대 패턴도 함께 고친다.
set -uo pipefail
# job control(set -m)은 서버를 띄우는 순간에만 켠다(서버가 자기 프로세스 그룹을 갖게 해 그룹째 종료하려고).
# 스크립트 내내 켜 두면 포그라운드 명령(sleep·adb 등)이 터미널을 따로 받아 Ctrl-C가 bash에 안 닿고 trap이 안 돈다(아래 '중단 처리').

# 한 단계씩 Enter로 넘기려면 터미널(/dev/tty)이 필요하다. 없으면 기기를 건드리기 전에 안내하고 끝낸다.
if [ "${DEMO_AUTO:-}" != "1" ] && ! ( : </dev/tty ) 2>/dev/null; then
  echo "이 실행에는 터미널(/dev/tty)이 없어 Enter로 한 단계씩 진행할 수 없습니다." >&2
  echo "자동으로 끝까지 돌리려면 DEMO_AUTO=1 pnpm demo:car 로 실행하세요(터미널에서 직접 돌리면 Enter 단계 진행이 됩니다)." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
ADB=(adb -s "$SERIAL")
RUN_DIR="${DEMO_OUT:-$ROOT/e2e/output/car-demo}/$(date +%Y%m%d-%H%M%S)"
FLOW_LOG="$RUN_DIR/flow.log"
SETTLE="${DEMO_SETTLE:-4}"   # 신호를 넣은 뒤 로그를 모으는 기본 시간(초)

# 같은 에뮬레이터를 쓰는 Maestro만 막는다(다른 에뮬레이터를 대상으로 --device를 준 실행은 상관없다).
# macOS의 `pgrep -fl`은 명령줄을 잘라 --device가 안 보이므로(다른 에뮬레이터 실행도 막게 됨) ps로 전체 명령줄을 읽는다.
maestro_cmds() { ps -axo command 2>/dev/null | grep -E '^[^ ]*/bin/java .*maestro\.cli\.AppKt' || true; }
if maestro_cmds | grep -v -- '--device' >/dev/null || maestro_cmds | grep -- "--device $SERIAL " >/dev/null; then
  echo "같은 에뮬레이터($SERIAL)를 쓰는 Maestro가 실행 중입니다. 끝난 뒤 다시 실행하세요." >&2
  exit 1
fi
if ! "${ADB[@]}" get-state >/dev/null 2>&1; then
  echo "기기 $SERIAL 에 연결할 수 없습니다. ANDROID_SERIAL을 확인하세요." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"

# ---- 단계 결과 기록·중단 처리에 쓰는 상태(정리·요약이 어느 시점에 불려도 안전하게 앞에서 정의한다) ----
PASS_COUNT=0
FAIL_COUNT=0
SUMMARY=()
STEP_NO=0
PREV_START=0
CURRENT_TITLE=""
CURRENT_PHASE=""        # Enter 대기 | 진행 중
INTERRUPTED=0
ABORT_REASON=""
NAP_PID=""
CLEANED=0

print_summary() {
  echo
  echo "━━ 요약"
  if [ "${#SUMMARY[@]}" -gt 0 ]; then printf '%s\n' "${SUMMARY[@]}"; fi
  echo "통과 $PASS_COUNT, 실패 $FAIL_COUNT"
}

# 신호를 받으면 바로 깨어나는 대기. 백그라운드 sleep을 wait로 기다리면 trap이 걸린 신호가 wait를 즉시 끝낸다(포그라운드 sleep은 끝나야 trap이 돈다).
nap() {
  sleep "$1" &
  NAP_PID=$!
  wait "$NAP_PID" 2>/dev/null
  NAP_PID=""
}

# ---- 기기 시간대·서버·logcat 준비와 정리 (e2e-car.sh와 같은 방식) ----
PREV_TZ="$("${ADB[@]}" shell getprop persist.sys.timezone | tr -d '\r')"
"${ADB[@]}" shell cmd alarm set-timezone Asia/Seoul >/dev/null
SERVER_PGID=""
LOGCAT_PID=""
APP_STARTED=0

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
    "${ADB[@]}" shell cmd alarm set-timezone "$PREV_TZ" >/dev/null 2>&1 || true
  else
    "${ADB[@]}" shell cmd alarm set-timezone UTC >/dev/null 2>&1 || true
    "${ADB[@]}" shell setprop persist.sys.timezone "" >/dev/null 2>&1 ||
      echo "경고: persist.sys.timezone을 비우지 못했습니다. 기기 시간대가 UTC로 남아 있을 수 있습니다." >&2
  fi
}

# 주입값을 되돌려 이 데모가 남긴 trip·route·listen·navi·drive·loc·exitcard가 이어지는 다른 확인에 영향을 주지 않게 한다.
reset_injection() {
  [ "$APP_STARTED" = "1" ] || return 0
  "${ADB[@]}" shell "am start -a android.intent.action.VIEW -d 'chagok-debug://signal?trip=real&route=real&listen=real&navi=fake&drive=4.5&loc=real&exitcard=real&range=real&fuel=real&home=real'" </dev/null >/dev/null 2>&1 || true
  nap 1
}

# 서버 자주 가는 곳의 집을 정한다(placeId가 null이면 지운다). 이 스크립트가 등록했을 때만 끝나면 지운다.
HOME_SET=0
set_home() {
  curl -fs -X PUT "http://127.0.0.1:$PORT/places/favorites/home" -H 'content-type: application/json' -d "{\"placeId\":$1}" >/dev/null 2>&1
}

# 차 앱이 읽는 것과 같은 식별 없는 읽기(/schedules/today)에 집이 보이는가. 폰이 연결된(자리 있는 차가 있는) 서버는 식별 없는 읽기를
# 그 자리로 보내므로 식별 없는 PUT(기본 자리)로 등록한 집은 차에 보이지 않는다(docs/pairing.md).
home_visible() {
  curl -fs "http://127.0.0.1:$PORT/schedules/today" 2>/dev/null |
    python3 -c 'import sys,json; sys.exit(0 if any(f.get("kind")=="home" for f in json.load(sys.stdin).get("favorites",[])) else 1)' 2>/dev/null
}

# 정리. 중단 때 정리 도중 Ctrl-C를 또 눌러도 끊기지 않게 정리 내내 INT·TERM·HUP을 무시한다(이 안에서 띄우는 명령도 같이 무시한다).
# 중단(Ctrl-C·q·TERM)으로 끝나면 정리를 마친 뒤에 "중단했습니다"와 그때까지의 요약을 보인다.
say() {
  [ "$INTERRUPTED" = "1" ] || return 0
  local ts
  ts="$(date +%H:%M:%S)"
  echo "   · $1" 2>/dev/null || true   # 터미널이 이미 닫혔어도(EIO) 정리는 계속한다
  echo "$ts $1" >>"$RUN_DIR/cleanup.log" 2>/dev/null || true
  return 0
}
cleanup() {
  trap '' INT TERM HUP
  [ "$CLEANED" = "1" ] && return 0
  CLEANED=1
  if [ "$INTERRUPTED" = "1" ]; then echo; echo "== 정리 중입니다(끝날 때까지 잠시 기다려 주세요)" 2>/dev/null; echo "$(date +%H:%M:%S) 정리 시작: $ABORT_REASON" >>"$RUN_DIR/cleanup.log" 2>/dev/null; fi
  [ -n "$NAP_PID" ] && kill "$NAP_PID" 2>/dev/null
  if [ "$HOME_SET" = "1" ]; then set_home null; say "서버 자주 가는 곳의 집 등록 해제"; fi
  if [ "$APP_STARTED" = "1" ]; then reset_injection; say "주입값 되돌림(trip·route·listen·drive·loc·exitcard·range·fuel·home 실제 값, navi 기본값 fake)"; fi
  if [ -n "$LOGCAT_PID" ]; then kill "$LOGCAT_PID" 2>/dev/null; wait "$LOGCAT_PID" 2>/dev/null; say "logcat 종료"; fi
  restore_timezone
  say "기기 시간대 복원"
  if [ -n "$SERVER_PGID" ]; then stop_server; say "이 스크립트가 띄운 서버 종료"; fi
  if [ "$INTERRUPTED" = "1" ]; then
    echo
    echo "== 중단했습니다 ($ABORT_REASON)"
    if [ -n "$CURRENT_TITLE" ]; then echo "   멈춘 곳: $STEP_NO) $CURRENT_TITLE ($CURRENT_PHASE)"; fi
    print_summary
    echo "   (중단했으므로 요약은 여기까지 본 단계만입니다. 휴대폰 연결 상태는 되돌리지 않습니다)"
  fi
}
trap cleanup EXIT

# ---- 중단 처리 ----
# Ctrl-C(INT)·TERM·HUP이 오면 표시를 남기고 exit한다. exit가 EXIT trap(cleanup)을 부른다.
# bash는 포그라운드 명령이 끝나야 trap을 돌리지만, 터미널의 Ctrl-C는 같은 프로세스 그룹의 그 명령에게도 가서 바로 끝난다.
# (kill -INT <bash pid>처럼 bash에만 보내도 긴 대기는 nap/wait로 즉시 깨어난다.)
on_signal() {
  trap '' INT TERM HUP
  INTERRUPTED=1
  ABORT_REASON="$1"
  echo
  echo "!! 중단 요청을 받았습니다($1)"
  exit "$2"
}
trap 'on_signal "Ctrl-C" 130' INT
trap 'on_signal "종료 신호" 143' TERM
trap 'on_signal "터미널 닫힘" 129' HUP

# Enter 대기. 입력은 표준 입력이 아니라 /dev/tty에서 읽는다. q를 넣으면 중단한다. 대기 중에 미리 눌러 둔 Enter가 다음 단계를 건너뛰지 않게 먼저 비운다.
wait_enter() {
  local answer=""
  python3 -c 'import sys,termios; termios.tcflush(sys.stdin.fileno(), termios.TCIFLUSH)' </dev/tty >/dev/null 2>&1 || true
  printf '   ▶ Enter: 이 단계 진행  /  q + Enter: 중단  (Ctrl-C도 됩니다) '
  if ! IFS= read -r answer </dev/tty; then
    INTERRUPTED=1; ABORT_REASON="입력이 끝남(Ctrl-D)"; echo; exit 130
  fi
  case "$answer" in
    q|Q|quit|exit) INTERRUPTED=1; ABORT_REASON="q 입력"; exit 130 ;;
  esac
}

if [ "${DEMO_INSTALL:-}" = "1" ]; then
  echo "== debug 앱 설치"
  (cd "$ROOT/car" && ANDROID_SERIAL="$SERIAL" ./gradlew :app:installDebug -q -Pchagok.serverPort="$PORT") || exit 1
fi

if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "== 서버가 이미 $PORT 에 떠 있어 그대로 씁니다"
  # 폰 일정이 출처인 서버(폰이 일정을 보냄)면 이 데모의 픽스처 시나리오가 맞지 않는다. 일정은 바꾸지 않고 멈춘다.
  RECEIVED_AT="$(curl -fs "http://127.0.0.1:$PORT/events" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("receivedAt") or "")' 2>/dev/null)"
  if [ -n "$RECEIVED_AT" ]; then
    echo "이 서버는 폰이 보낸 일정(receivedAt=$RECEIVED_AT)을 출처로 쓰고 있어 픽스처 데모가 맞지 않습니다." >&2
    echo "서버를 내리고 다시 띄우거나(메모리 상태가 사라짐), 일정을 되돌려도 되면 직접 DELETE /events(127.0.0.1)를 호출한 뒤 다시 실행하세요. 이 스크립트는 일정을 바꾸지 않습니다." >&2
    exit 1
  fi
elif lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "포트 $PORT 를 다른 프로그램이 쓰고 있습니다(/health 응답 없음). 내리거나 PORT를 바꾸세요." >&2
  exit 1
else
  echo "== 서버 시작 (포트 $PORT)"
  set -m   # 이 서버만 자기 프로세스 그룹을 갖게 한다(터미널 Ctrl-C가 서버에 닿지 않고 정리에서 그룹째 내린다)
  (cd "$ROOT/server" && PORT="$PORT" exec ./node_modules/.bin/tsx src/index.ts >"$RUN_DIR/server.log" 2>&1) &
  SERVER_PGID=$!
  set +m
  for _ in $(seq 1 30); do
    curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
    nap 1
  done
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null || { echo "서버가 뜨지 않았습니다. $RUN_DIR/server.log 를 확인하세요." >&2; exit 1; }
fi

# 집 하차 단계는 서버에 집을 등록해야 한다. 서버를 직접 띄웠거나 DEMO_HOME=1일 때만 한다.
if [ -n "$SERVER_PGID" ] || [ "${DEMO_HOME:-}" = "1" ]; then
  HOME_SET=1   # 등록 중에 끊겨도 정리에서 해제하도록 먼저 표시한다
  if set_home '"mock-home-apt"'; then
    if ! home_visible; then
      echo "경고: 집을 등록했지만 차가 읽는 자리에 보이지 않아(폰이 연결된 서버) 집 하차 단계를 건너뜁니다. 등록한 집은 되돌립니다." >&2
      set_home null; HOME_SET=0
    fi
  else
    HOME_SET=0
    echo "경고: 서버에 집을 등록하지 못해 집 하차 단계를 건너뜁니다." >&2
  fi
else
  echo "== 이미 떠 있는 서버라 집 하차 단계는 건너뜁니다(DEMO_HOME=1이면 집을 등록했다가 해제합니다)"
fi

# 시작 이후 줄만 보려고 현재 위치(줄 수)를 단계마다 적어 둔다. 오래된 줄이 한 줄 섞여도 시작 위치 뒤만 읽어 영향이 없다.
"${ADB[@]}" logcat -v brief -T 1 -s ChagokFlow:I ChagokFakeNavi:I </dev/null >"$FLOW_LOG" 2>&1 &
LOGCAT_PID=$!
nap 1

# 시간대를 바꾼 뒤 앱을 새로 띄운다. 떠 있던 프로세스는 옛 시간대를 쓰고, MainActivity가 앞에 없으면 가짜 내비가 움직이지 않는다.
echo "== 앱 다시 시작 (시간대 반영)"
"${ADB[@]}" shell am force-stop com.chagok.car </dev/null >/dev/null 2>&1
"${ADB[@]}" shell am start -n com.chagok.car/.MainActivity </dev/null >/dev/null 2>&1 || { echo "앱을 시작하지 못했습니다. debug 앱이 설치돼 있는지 확인하세요(DEMO_INSTALL=1)." >&2; exit 1; }
APP_STARTED=1
nap 5

# ---- 단계 실행 ----

send_signal() {
  echo "   → 신호: $1"
  # adb shell은 표준 입력을 읽으므로 /dev/null로 막는다(Enter 입력을 빼앗거나 job control에서 멈추지 않게).
  "${ADB[@]}" shell "am start -a android.intent.action.VIEW -d 'chagok-debug://signal?$1'" </dev/null >/dev/null 2>&1 || echo "   ! 신호를 넣지 못했습니다"
}

log_lines_since() { tail -n +"$(($1 + 1))" "$FLOW_LOG"; }

# 사람이 읽기 쉽게 logcat 접두("I/ChagokFlow( 1234): ")를 떼어 출력한다.
show_lines() { sed -E 's/^[A-Z]\/(ChagokFlow|ChagokFakeNavi) *\( *[0-9]+\): /   | /'; }

# step <제목> <기대 동작> <화면에서 볼 것> <신호들(공백 구분, 없으면 "")> <기다릴 패턴(없으면 "")> <최대 대기 초> <필수 패턴들(;; 구분)> <금지 패턴(없으면 "")> [이전 단계부터 보기: 1]
step() {
  local title="$1" expect="$2" see="$3" signals="$4" wait_re="$5" max_wait="$6" musts="$7" mustnot="$8" from_prev="${9:-0}"
  STEP_NO=$((STEP_NO + 1))
  CURRENT_TITLE="$title"
  CURRENT_PHASE="Enter 대기 중, 아직 신호를 넣지 않음"
  echo
  echo "━━ $STEP_NO) $title"
  echo "   기대: $expect"
  echo "   화면: $see"
  if [ "${DEMO_AUTO:-}" != "1" ]; then
    wait_enter
  fi
  CURRENT_PHASE="진행 중"
  local start
  start=$(wc -l <"$FLOW_LOG" | tr -d ' ')
  local from=$start
  [ "$from_prev" = "1" ] && from=$PREV_START
  PREV_START=$start
  local s
  for s in $signals; do
    case "$s" in
      AT=*)
        # AT=HH:MM[&나머지 신호]: 데모 시계를 그 시각(서울)으로 앞으로만 보낸다. 시계는 실제 시간과 같이 흐르므로 그동안 지난 시간(Enter 대기 포함)과
        # 이미 보낸 advance 합계는 빼서 맞춘다. advance는 1분 미만이면 신호 전체가 거부되므로(1~10080) 1 밑으로는 내리지 않는다.
        local at="${s#AT=}" rest="" want minutes elapsed
        case "$at" in *"&"*) rest="&${at#*&}"; at="${at%%&*}" ;; esac
        want=$(( 10#${at%%:*} * 60 + 10#${at##*:} - (9 * 60 + 20) ))
        elapsed=$(( ($(date +%s) - RESET_EPOCH + 30) / 60 ))
        minutes=$((want - elapsed - ADVANCED_TOTAL))
        [ "$minutes" -lt 1 ] && minutes=1
        ADVANCED_TOTAL=$((ADVANCED_TOTAL + minutes))
        s="advance=$minutes$rest"
        ;;
    esac
    send_signal "$s"
    case "$s" in now=*|*"&now="*) RESET_EPOCH=$(date +%s); ADVANCED_TOTAL=0 ;; esac
    nap 1
  done
  if [ -n "$wait_re" ]; then
    local waited=0
    while [ "$waited" -lt "$max_wait" ]; do
      log_lines_since "$from" | tr '\n' '\t' | grep -Eq "$wait_re" && break
      nap 1
      waited=$((waited + 1))
    done
    nap 1
  else
    nap "$SETTLE"
  fi
  echo "   로그:"
  local lines
  lines="$(log_lines_since "$from")"
  if [ -n "$lines" ]; then echo "$lines" | show_lines; else echo "   | (새 로그 없음)"; fi

  # 필수 패턴은 줄을 탭으로 이어 붙인 한 줄에서 찾는다(".*"로 줄 순서도 확인할 수 있다). 금지 패턴은 줄 단위다.
  local joined
  joined="$(printf '%s' "$lines" | tr '\n' '\t')"
  local ok=1 reason="" m
  local IFS_SAVE="$IFS"
  if [ -n "$musts" ]; then
    local rest="$musts"
    while [ -n "$rest" ]; do
      if [[ "$rest" == *";;"* ]]; then m="${rest%%;;*}"; rest="${rest#*;;}"; else m="$rest"; rest=""; fi
      if ! printf '%s' "$joined" | grep -Eq "$m"; then ok=0; reason="$reason 기대: /$m/ 없음."; fi
    done
  fi
  IFS="$IFS_SAVE"
  if [ -n "$mustnot" ] && echo "$lines" | grep -Eq "$mustnot"; then
    ok=0
    reason="$reason 나오면 안 되는 로그: /$mustnot/ 가 있음."
  fi
  if [ "$ok" = "1" ]; then
    echo "   ✓ $title"
    PASS_COUNT=$((PASS_COUNT + 1))
    SUMMARY+=("✓ $STEP_NO) $title")
  else
    echo "   ✗ $title —$reason"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    SUMMARY+=("✗ $STEP_NO) $title —$reason")
  fi
  CURRENT_TITLE=""
  CURRENT_PHASE=""
}

SILENT='말함:|카드 칩='
FIRST_AT=2026-11-06T00:20:00Z   # 데모 시계 09:20 KST
RESET_EPOCH=0
ADVANCED_TOTAL=0
YES='heard=%EC%9D%91'            # "응"
RANGE_PLENTY=900                 # 주행 가능 거리(km). 넉넉해서 에너지 체크가 모자람으로 보지 않는다
RANGE_LOW=150                    # 모자람 장면의 주행 가능 거리(km). 집까지 필요 거리 약 300km의 90%에 못 미친다
FAR_HOME='37.153,127.0'           # 집 좌표(경기도 남부). 광주 육전집에서 집까지 필요 거리가 직선×1.3으로 300km로 나오게 잡은 값
LUNCH_LOC='35.1595,126.8526'     # 육전집(픽스처 gwangju-lunch). 13:30 재탑승 때 차가 있는 곳

echo "== 차곡 차량 앱 시나리오 데모 (기기 $SERIAL, 서버 :$PORT)"
echo "   로그: $FLOW_LOG"
echo "   하루가 이어지는 이야기입니다: 초기화는 맨 처음 한 번뿐이고 그 뒤로는 시계를 앞으로만 보냅니다(09:20 → 13:30 → 20:30 → 21:10)."
if [ "${DEMO_AUTO:-}" = "1" ]; then
  echo "   자동 진행(DEMO_AUTO=1)입니다. 중단은 Ctrl-C."
else
  echo "   단계마다 설명을 보여 드리고 Enter를 누르면 그 단계를 실행합니다. 중단은 q+Enter 또는 Ctrl-C(정리 후 종료)."
fi

# ================= 이어지는 하루 (광주 직관 픽스처, 기준 09:20) =================

step "초기화(09:20)" \
  "휴대폰 연결됨(paired=true), 데모 시계 09:20, 가짜 내비 켬, 상태 초기화(정책서 3장: 일정 상태 예정), 이야기 설정 주입(전기차 fuel=ev, 주행 가능 거리 range=$RANGE_PLENTY km로 넉넉해 하루 초반에는 에너지 카드가 안 뜸, 집은 home=$FAR_HOME 광주에서 약 300km 떨어진 곳). 이날 하루의 유일한 초기화다. 초기화가 앱 진입으로도 잡혀 첫 탑승 브리핑이 이어서 바로 뜬다(탑승 규칙상 정상, 다음 단계에서 확인)" \
  "지도(시연용 가짜 지도)가 보이고 곧이어 첫 탑승 브리핑 카드가 뜸" \
  "paired=true&now=$FIRST_AT&navi=fake&drive=3&trip=12000&route=ok&listen=off&fuel=ev&range=$RANGE_PLENTY&home=$FAR_HOME&gear=P" \
  "카드 칩=" 15 \
  "이벤트 Reset;;GearChanged\\(gear=PARK\\)" \
  ""

step "첫 탑승(09:20): 전체 브리핑" \
  "정책서 5장 첫 탑승: 종일 일정 인사 + 대상 일정까지 남은 시간 + 출발할까요? 앞 단계의 초기화가 그날 첫 진입이라 브리핑은 이미 떠 있다(그 단계부터 이어서 본다). 대상은 13:00 육전집 점심이고(에너지 체크는 주행 가능 거리 900km로 넉넉함이라 평소 제안), 점심에는 챙길 것이 없어 메모·채비 문장이 없다(유니폼·응원봉·티켓은 17:00 KIA 직관의 메모이고 첫 탑승은 다른 일정의 메모를 읽지 않는다)" \
  "'광주 직관 날이에요! 1시 육전집 점심까지 3시간 40분이에요.' + '출발할까요?', 오늘 일정 타일(채비 타일 없음), [응, 출발][잠깐만]" \
  "" \
  "" 0 \
  "에너지: 필요 [0-9]+km, 가능 ${RANGE_PLENTY}km → 넉넉함;;카드 칩=정차 중 · 출발 전 \\| voice=광주 직관 날이에요!.*1시 육전집 점심까지 3시간.40분이에요;;sub=출발할까요;;말함: .*1시 육전집 점심까지 3시간.40분이에요.*출발할까요" \
  "메모에|유니폼|채비" 1

step "수락: 육전집 길안내 시작" \
  "정책서 7장: '응' → 길안내 요청 + 결과 한 줄 '길안내를 시작할게요.'" \
  "카드가 접히고 결과 한 줄, 지도에 곡선 경로와 왼쪽 아래 길안내 패널(목적지 · 광주 육전집, 큰 도착 시각, 도착 · N km 남음)" \
  "$YES" \
  "결과 한 줄: 길안내를 시작할게요" 10 \
  "길안내 요청: 광주 육전집;;결과 한 줄: 길안내를 시작할게요" \
  ""

# 하차 카드(일정 장소): 주행 중 내비 도착 순간에 바로 뜬다(사용자 결정 2026-11-15, 주행 중 카드 금지의 유일한 예외. Pleos 주행 규제와 충돌할 수 있어 실차 전 확인 필요).
# 한 번 말하고(듣지 않음) 5초(Rules.EXIT_CARD) 뒤 닫힌다. 육전집 점심은 챙길 것·메모가 없어(유니폼·응원봉·티켓은 KIA 직관의 것) 도착 기록 한 줄이고 버튼이 없다
# ("{일정}, 도착으로 기록했어요.", 사용자 결정 2026-11-15, 정책서 9장의 "잘 다녀오세요."를 대신함).
# 닫힌 뒤에 다음 단계가 오도록 "카드 접음"까지 기다린다(카드가 떠 있는 채 탑승 신호가 오면 잠깐 정차 규칙을 따른다).
step "주행(09:20): 도착하면 바로 하차 카드" \
  "정책서 6장: 주행 중에는 먼저 말하지 않고(카드 접기) 다음 일정 칩만 남긴다. 단 가짜 내비가 목적지에 닿아 내비 도착 알림이 들어오는 순간만 예외로 일정 장소 하차 카드(docs/exit-card.md)를 바로 띄워 한 번 말한다(듣지 않음). 카드가 떠 있는 동안 칩은 숨고 5초 뒤 닫히면 칩이 다음 일정으로 바뀐다. 점심이 도착으로 기록돼 대상은 17:00 KIA 직관으로 넘어간다" \
  "카드·말 없이 왼쪽 위에 칩 '다음 13:00 육전집 점심'(누를 수 없음), 지도에서 차가 곡선 경로를 따라 움직이고 남은 거리가 줄어듦(약 3초). 도착하는 순간 칩이 사라지고 '도착 · 내리기 전' 칩, '육전집 점심, 도착으로 기록했어요.'(버튼·채비 타일 없음, 유니폼 얘기 없음), '5초 뒤 자동으로 닫혀요', 지도 덮개 72%(패널은 카드가 떠 있는 동안 숨음). 5초 뒤 카드가 접히고 패널이 '광주 육전집 도착', 칩이 '다음 17:00 KIA 직관'" \
  "gear=D" \
  "카드 칩=도착 · 내리기 전.*카드 접음.*다음 일정 칩: 17:00 KIA 직관" 50 \
  "GearChanged\\(gear=DRIVE\\);;다음 일정 칩: 13:00 육전집 점심;;ChagokFakeNavi.*도착: 광주 육전집;;이벤트 DestinationArrived.*카드 칩=도착 · 내리기 전 \\| voice=육전집 점심, 도착으로 기록했어요\\.;;이벤트 DestinationArrived.*말함: 육전집 점심, 도착으로 기록했어요\\.;;다음 일정 칩 숨김;;저장: gwangju-lunch 예정→도착;;카드 접음.*다음 일정 칩: 17:00 KIA 직관" \
  "\\(듣기\\)|sub=|소요 시간 요청|결과 한 줄:|voice=육전집 점심, 도착으로 기록했어요\\..*(버튼=|각주=)|유니폼|챙기세요"

step "정차(P, 09:2x): 같은 카드는 다시 뜨지 않음" \
  "도착 때 하차 카드를 이미 한 번 보였으므로 이어지는 P단에는 말도 카드도 없다. 주행 중 칩은 같은 이벤트에서 바로 숨는다" \
  "카드·말 없이 패널 '광주 육전집 도착'만 보임(칩 없음)" \
  "gear=P" \
  "" 0 \
  "GearChanged\\(gear=PARK\\);;다음 일정 칩 숨김" \
  "$SILENT|결과 한 줄:"

# 재탑승 13:30(에너지 장면). 점심(13:00~14:00)이 끝나기 전이라, 도착이 기록됐을 때만 대상이 KIA 직관이고 기록되지 않았으면 점심 늦게 탐 카드가 뜬다(14:00 뒤면 건너뜀 처리로 구분이 안 된다).
# 정책서 5장(출발 시각 = 시작 - 소요 - 여유 10분, 60분 넘게 이르면 '어디로 갈까요?'): trip=9000(150분)이면 KIA 출발 시각 14:20이라 지금(13:30)까지 50분 → 출발 제안.
# 에너지 체크(docs/energy.md): 지금 위치(육전집) → KIA 직관 장소 → 콩물집 → 집(약 300km 밖)의 필요 거리가 주행 가능 거리 150km의 90%를 넘어
# 출발 제안이 '집까지 300km인데 배터리로는 모자라요.' + 충전 제안으로 바뀐다. 전기차는 대상 일정이 2시간 이상이면(KIA 직관 17:00~19:40) 그 장소 근처 완속 충전소를 묻는다
# (콩물 픽업은 60분이라 시내에서는 후보가 없어 한 문장만 붙으므로 이 장면은 20:30이 아니라 13:30에 둔다). 위치는 측위한 지 5분 안이어야 써서 시계를 보낸 뒤(AT) loc을 넣는다.
step "재탑승(13:30): 집까지 모자라면 충전을 넣은 제안" \
  "정책서 5·6·9장: 같은 날 두 번째 탑승(P 뒤 10분 넘음) → 대상은 17:00 KIA 직관(점심은 도착으로 끝남). 필요 거리(집까지 약 300km)가 주행 가능 거리 ${RANGE_LOW}km의 90%를 넘어 서버에 충전 후보를 묻고 출발 제안을 충전 제안으로 바꾼다(에너지 체크는 하루 한 번)" \
  "'집까지 300km인데 배터리로는 모자라요.' + '예시 챔필 주차장 충전소에서 충전하고 갈까요?'(후보 타일 하나), [응, 충전하고 출발][잠깐만]. 평소 한 줄('5시 KIA 직관까지…')은 이 제안에 가려지고 20:30 재탑승에서 본다. 육전집 점심 이야기는 나오지 않음" \
  "AT=13:30&fuel=ev&range=$RANGE_LOW&loc=$LUNCH_LOC&trip=9000&enter=true" \
  "카드 칩=" 25 \
  "소요 시간 요청: .*챔피언스필드;;에너지: 필요 300km, 가능 ${RANGE_LOW}km → 모자람;;에너지 후보 요청: ev;;카드 칩=정차 중 · 출발 전 \\| voice=집까지 300km인데 배터리로는 모자라요\\.;;sub=.*충전소에서 충전하고 갈까요\\?;;버튼=응, 충전하고 출발/잠깐만;;말함: 집까지 300km인데 배터리로는 모자라요\\..*충전하고 갈까요\\? \\(듣기\\)" \
  "광주 직관 날이에요|육전집 점심까지|점심이 1시인데|5시 KIA 직관까지|출발할까요"

# loc 주입(위 단계의 육전집 위치)은 지금 풀어 가짜 경로가 위치를 정하게 한다(주입이 켜져 있으면 가짜 경로의 위치가 세션에 안 들어간다).
step "수락: 충전소를 들러 챔피언스필드로 길안내(13:30)" \
  "'응' → 충전소를 경유지로 넣고 KIA 직관 장소로 길안내 요청 + 결과 한 줄 '{충전소} 들렀다 갈게요.'(docs/energy.md). 이 단계 앞에서 loc 주입을 풀어 이후 위치는 가짜 경로가 정한다" \
  "카드가 접히고 결과 한 줄 '예시 챔필 주차장 충전소 들렀다 갈게요.', 패널 '경유 · 예시 챔필 주차장 충전소 → 광주-기아 챔피언스필드'(경로 모양은 그대로)" \
  "loc=real $YES" \
  "결과 한 줄: .*들렀다 갈게요" 10 \
  "길안내 요청: 광주-기아 챔피언스필드 \\(경유 [^)]*충전소\\);;결과 한 줄: [^ ]+( [^ ]+)* 들렀다 갈게요\\." \
  "결과 한 줄: 길안내를 시작할게요|소요 시간 요청"

# 같은 장소의 'KIA vs 두산'(18:30~20:50, 캘린더 mock-kia)은 기본 캘린더 선택(구독 캘린더라 꺼짐)에 들지 않아 이 하루의 차 일정에 없다. 그래서 칩은 바로 21:00 콩물 픽업이 된다.
# (선택에 켠 상태의 동작은 이 스크립트 밖이다: 앱은 장소가 같아도 일정을 묶어 도착 처리하지 않고 도착한 그 일정 하나만 기록한다.)
step "주행(13:30): 도착하면 하차 카드, 칩은 다음 일정 콩물 픽업으로" \
  "내비 도착 → 'KIA 직관'을 도착으로 기록하고 하차 카드('유니폼·응원봉·티켓 챙기세요!', 메모는 KIA 직관의 것). 5초 뒤 닫히면 칩은 남은 대상 일정인 21:00 콩물 픽업이다" \
  "주행 중 칩 '다음 17:00 KIA 직관'(카드 없음) → 도착하는 순간 '도착 · 내리기 전' 카드 → 5초 뒤 접히고 패널 '광주-기아 챔피언스필드 도착', 칩 '다음 21:00 콩물 픽업'" \
  "gear=D" \
  "카드 칩=도착 · 내리기 전.*카드 접음.*다음 일정 칩: 21:00 콩물 픽업" 50 \
  "GearChanged\\(gear=DRIVE\\);;다음 일정 칩: 17:00 KIA 직관;;ChagokFakeNavi.*도착: 광주-기아 챔피언스필드;;이벤트 DestinationArrived.*카드 칩=도착 · 내리기 전 \\| voice=유니폼·응원봉·티켓 챙기세요!;;각주=‘KIA 직관’ 일정 메모: 유니폼·응원봉·티켓;;이벤트 DestinationArrived.*말함: 유니폼·응원봉·티켓 챙기세요!;;저장: gwangju-kia 예정→도착;;카드 접음.*다음 일정 칩: 21:00 콩물 픽업" \
  "\\(듣기\\)|sub=|소요 시간 요청|결과 한 줄:"

step "정차(P, 13:3x): 같은 카드는 다시 뜨지 않음" \
  "하차 카드는 한 번 보였고 KIA 직관은 이미 도착으로 기록돼 위치 판정에 다시 걸리지 않으니 말도 카드도 없다" \
  "카드·말 없이 패널 '광주-기아 챔피언스필드 도착'만 보임(칩 없음)" \
  "gear=P" \
  "" 0 \
  "GearChanged\\(gear=PARK\\);;다음 일정 칩 숨김" \
  "$SILENT|결과 한 줄:"

# 재탑승 20:30(경기가 끝난 뒤). 'KIA vs 두산'(18:30~20:50)은 기본 캘린더 선택(mock-kia 구독 캘린더 = 꺼짐)에 들지 않아 이 하루에는 나오지 않는다.
# trip=600(10분)이면 콩물 출발 시각 20:40(21:00-10분-여유 10분)까지 10분이라 출발 제안이다.
step "재탑승(20:30): 다음 일정 콩물 픽업 한 줄" \
  "경기(KIA 직관)는 도착으로 끝났고 점심도 끝났다. 충전을 했으므로 주행 가능 거리를 다시 넉넉하게 주입한다(range=$RANGE_PLENTY, 에너지 제안 표시도 풀림. 그래서 이번엔 평소 한 줄이다). 남은 대상은 21:00 콩물 픽업이다. 같은 날 세 번째 탑승이라 한 줄 + 출발할까요?(출발 시각 20:40까지 10분이라 출발 제안, 위치 정보 없음)" \
  "'9시 콩물 픽업까지 30분이에요.' + '출발할까요?' 카드(종일 인사·오늘 일정 타일 없음), [응, 출발][잠깐만]. KIA 직관·육전집 점심은 다시 나오지 않음" \
  "AT=20:30&range=$RANGE_PLENTY&trip=600&enter=true" \
  "카드 칩=" 25 \
  "소요 시간 요청: 단골 콩물집;;에너지: 필요 [0-9]+km, 가능 ${RANGE_PLENTY}km → 넉넉함;;카드 칩=정차 중 · 출발 전 \\| voice=9시 콩물 픽업까지 .*이에요\\.;;sub=.*출발할까요\\?;;말함: 9시 콩물 픽업까지 .*이에요\\..*출발할까요\\? \\(듣기\\)" \
  "광주 직관 날이에요|육전집 점심|KIA 직관"

step "수락: 단골 콩물집 길안내(20:30)" \
  "'응' → 길안내 요청(콩물 픽업 장소) + 결과 한 줄" \
  "카드가 접히고 결과 한 줄, 패널 '목적지 · 단골 콩물집'" \
  "$YES" \
  "결과 한 줄: 길안내를 시작할게요" 10 \
  "길안내 요청: 단골 콩물집;;결과 한 줄: 길안내를 시작할게요" \
  ""

# 콩물 픽업은 메모가 없어 하차 카드가 '콩물 픽업, 도착으로 기록했어요.'(버튼 없음)다. 도착하면 다음 일정은 22:20 친구 약속(장소 없음)이다.
step "주행(20:30): 도착하면 하차 카드, 칩은 장소 없는 친구 약속으로" \
  "내비 도착 → 콩물 픽업 도착 기록 + 하차 카드(메모가 없어 '콩물 픽업, 도착으로 기록했어요.', 버튼 없음, 한 번 말하고 듣지 않음). 5초 뒤 닫히면 칩은 남은 마지막 일정인 22:20 친구 약속이다(칩은 장소가 없어도 다음 일정을 그대로 보인다)" \
  "주행 중 칩 '다음 21:00 콩물 픽업' → 도착하는 순간 '도착 · 내리기 전' 카드와 '콩물 픽업, 도착으로 기록했어요.'(버튼 없음) → 5초 뒤 접히고 패널 '단골 콩물집 도착', 칩 '다음 22:20 친구 약속'" \
  "gear=D" \
  "카드 칩=도착 · 내리기 전.*카드 접음.*다음 일정 칩: 22:20 친구 약속" 50 \
  "GearChanged\\(gear=DRIVE\\);;다음 일정 칩: 21:00 콩물 픽업;;ChagokFakeNavi.*도착: 단골 콩물집;;이벤트 DestinationArrived.*카드 칩=도착 · 내리기 전 \\| voice=콩물 픽업, 도착으로 기록했어요\\.;;이벤트 DestinationArrived.*말함: 콩물 픽업, 도착으로 기록했어요\\.;;저장: gwangju-kongmul 예정→도착;;카드 접음.*다음 일정 칩: 22:20 친구 약속" \
  "\\(듣기\\)|sub=|소요 시간 요청|결과 한 줄:|voice=콩물 픽업, 도착으로 기록했어요\\..*버튼="

step "정차(P, 20:3x): 같은 카드는 다시 뜨지 않음" \
  "하차 카드는 한 번 보였고 위치 판정도 지금은 시간 창 밖(콩물 픽업 21:00 시작 60분 전~22:00 종료 안이지만 이미 도착 기록됨)이라 말도 카드도 없다" \
  "카드·말 없이 패널 '단골 콩물집 도착'만 보임(칩 없음)" \
  "gear=P" \
  "" 0 \
  "GearChanged\\(gear=PARK\\);;다음 일정 칩 숨김" \
  "$SILENT|결과 한 줄:"

if [ "$HOME_SET" = "1" ]; then
  # 21:10: 남은 일정은 22:20 친구 약속(장소 없음)뿐인데 시작 60분 전(21:20)이 아직 아니라 대상이 아니다. 대상이 없어 '어디로 갈까요?'를 묻는다(후보: 집).
  step "재탑승(21:10): 갈 곳을 묻는 카드" \
    "정책서 5장: 오늘 일정은 도착으로 끝났고 남은 친구 약속은 장소가 비어 시작 60분 전(21:20)부터만 대상이라 아직 건너뛴다 → 일정 없음 → '어디로 갈까요?'(후보 집)" \
    "'어디로 갈까요?' 카드, [집으로][그냥 갈게]. 친구 약속(장소 없음)은 묻지 않음" \
    "AT=21:10&enter=true" \
    "카드 칩=" 25 \
    "카드 칩=정차 중 · 출발 전 \\| voice=어디로 갈까요\\?.*버튼=집으로/그냥 갈게;;말함: 어디로 갈까요\\? \\(듣기\\)" \
    "친구 약속|콩물|KIA|육전집"

  step "집을 골라 길안내(21:10)" \
    "'집'이라고 답하면(후보 고르기) '집'(home=$FAR_HOME 주입, 서버 자주 가는 곳의 이름 '예시 아파트 101동'은 화면·말·로그에 나오지 않는다)으로 길안내 요청 + 결과 한 줄. 집은 일정이 아니라 도착해도 일정 도착으로 기록되지 않는다" \
    "카드가 접히고 결과 한 줄, 패널 '목적지 · 집'" \
    "heard=%EC%A7%91" \
    "결과 한 줄" 10 \
    "카드 접음;;길안내 요청: 집[[:space:]];;결과 한 줄: 길안내를 시작할게요" \
    "예시 아파트"

  step "주행(21:10): 집에 도착해도 카드는 없음" \
    "가짜 내비가 집에 닿아 내비 도착 알림이 들어와도 집은 일정이 아니라 도착 기록도 하차 카드도 없다(집 하차는 P단에서 위치로 판정한다). 주행 중 칩은 남은 일정 22:20 친구 약속이다" \
    "카드·말 없이 칩 '다음 22:20 친구 약속', 지도에서 차가 달려 패널이 '집 도착'" \
    "gear=D" \
    "DestinationArrived" 20 \
    "GearChanged\\(gear=DRIVE\\);;다음 일정 칩: 22:20 친구 약속;;ChagokFakeNavi.*도착: 집;;이벤트 DestinationArrived" \
    "카드 칩=|말함:|저장|예시 아파트"

  step "정차(P, 21:1x): 집 하차 카드 '콩물 챙기세요!'" \
    "집 반경 300m 안(가짜 경로 끝 = 집 좌표 home=$FAR_HOME)에서 달린 뒤 P단 + 직전에 집 밖 위치를 받았으므로(오늘 달린 경로) 집 하차 카드. 콩물 픽업(21:00)을 도착으로 마쳤으니 '콩물 챙기세요!'(+ 채비 타일 + [챙겼어요]), 한 번 말하고 듣지 않는다. '오늘도 수고했어요.'는 물건이 없을 때의 인사다" \
    "'도착 · 내리기 전' 칩, '콩물 챙기세요!', 채비 타일, [챙겼어요], 지도 덮개 72%, 5초 뒤 접힘" \
    "gear=P" \
    "카드 칩=도착 · 내리기 전.*카드 접음" 15 \
    "GearChanged\\(gear=PARK\\).*카드 칩=도착 · 내리기 전 \\| voice=콩물 챙기세요!;;버튼=챙겼어요;;말함: 콩물 챙기세요!.*카드 접음" \
    "수고했어요|\\(듣기\\)|소요 시간 요청"
else
  echo
  echo "── 14~17) 집 하차 단계는 건너뜁니다(이미 떠 있는 서버라 집을 등록하지 않았습니다. DEMO_HOME=1이면 등록했다가 해제합니다)"
fi

# ================= 추가 점검 (DEMO_EXTRA=1) =================
# 이야기에 넣을 수 없는 개별 점검이다. 각 점검이 상태를 초기화(now=)해 09:20부터 다시 시작한다.
if [ "${DEMO_EXTRA:-}" = "1" ]; then
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "  여기부터는 이어지는 하루가 아니라, 상태를 초기화하는 개별 점검입니다."
  echo "  (단계마다 데모 시계가 09:20으로 돌아가고 첫 탑승 브리핑이 다시 뜰 수 있습니다)"
  echo "  (이야기 설정의 에너지·먼 집 주입은 풀고 서버의 집을 씁니다: fuel·range·home=real)"
  echo "════════════════════════════════════════════════════════════════"

  # 위치 기반 도착 판단. 신호 loc으로 위치를 넣고, 달린 뒤(gear=D) P단에 넣는 순간 판정한다. 가짜 내비는 끄고 실제 내비 모드다. 장소는 픽스처의 육전집(35.1595,126.8526, 13:00 점심).
  # 첫 위치 주입을 달리기 전(D 앞)에 한다: 주입이 켜지면 어댑터의 실제 위치(에뮬레이터 GPS)는 세션에 들어가지 않는다. 주입 전에는 에뮬레이터 GPS가 집 근처 등에
  # 있으면 그 위치가 이번 주행의 믿을 만한 위치로 먼저 쓰여 P단 판정이 달라질 수 있다(에뮬레이터 GPS 상태와 무관하게 돌게 한다).
  step "추가: 위치로 도착(내비 도착 알림 없이 육전집 300m 안에서 P단)" \
    "정책서 3·4장: 달린 뒤 P단에 넣은 곳이 대상 일정 장소 300m 안이면 도착으로 기록하고 그 시점에 바로 하차 카드를 띄운다(docs/exit-card.md). 내비 도착 알림은 없다(길안내를 하지 않았다). 육전집 점심은 챙길 것이 없어 도착 기록 한 줄이다" \
    "가짜 지도가 사라지고 '도착 · 내리기 전' 칩, '육전집 점심, 도착으로 기록했어요.'(버튼 없음). 5초 뒤 접힘(초기화 직후라 첫 탑승 브리핑 카드가 먼저 떠 있을 수 있음)" \
    "home=real&fuel=real&range=real&now=$FIRST_AT&advance=170&navi=real&listen=off&trip=none&exitcard=real&gear=P loc=$LUNCH_LOC gear=D loc=$LUNCH_LOC&gear=P" \
    "카드 칩=도착 · 내리기 전.*카드 접음" 15 \
    "저장: [^ ,]+ 예정→도착;;카드 칩=도착 · 내리기 전 \\| voice=육전집 점심, 도착으로 기록했어요\\.;;말함: 육전집 점심, 도착으로 기록했어요\\..*카드 접음" \
    "DestinationArrived|voice=육전집 점심, 도착으로 기록했어요\\..*(버튼=|각주=)"

  # 집 하차(docs/home-exit.md): 집 반경(300m) 밖 위치를 한 번 이상 받은 뒤 집에 P단을 넣었을 때만 한다. 집은 서버 자주 가는 곳 mock-home-apt(35.1743,126.9121)다.
  AWAY_LOC='35.1378,126.7912'   # 광주송정역 근처(집·일정 장소 어디도 아님)
  HOME_LOC='35.1743,126.9121'

  if [ "$HOME_SET" = "1" ]; then
    step "추가: 집 하차 인사(물건 없음)" \
      "정책서 4·6·9장: 집 밖 위치를 받은 뒤 집 반경 300m 안에서 달린 뒤 P단 → 집 하차 카드. 09:20에는 챙길 물건(콩물 픽업 21:00)이 없어 '오늘도 수고했어요.'(버튼 없음, 한 번 말하고 듣지 않음)" \
      "'도착 · 내리기 전' 칩과 '오늘도 수고했어요.'. 버튼 없이 5초 뒤 접힘(지도 덮개 72%는 가짜 내비를 켠 때만). 초기화 직후라 첫 탑승 브리핑이 먼저 뜰 수 있어 그 카드의 버튼·듣기는 판정에서 가리지 않고, 인사 카드 줄 끝에 버튼·듣기가 붙지 않는지만 본다" \
      "now=$FIRST_AT&navi=real&listen=off&trip=none&exitcard=real&gear=P gear=D loc=$AWAY_LOC loc=$HOME_LOC gear=P" \
      "카드 칩=도착 · 내리기 전.*카드 접음" 15 \
      "카드 칩=도착 · 내리기 전 \\| voice=오늘도 수고했어요\\.[[:space:]];;말함: 오늘도 수고했어요\\.[[:space:]];;카드 접음" \
      "DestinationArrived"

    step "추가: 같은 날 다시 들러도 말 없음" \
      "같은 날 집에 다시 들르면 이미 인사했고 새 물건도 없어 카드가 없다(인사·물건은 하루 한 번)" \
      "아무 카드도 뜨지 않음" \
      "gear=D loc=$AWAY_LOC loc=$HOME_LOC gear=P" \
      "" 0 \
      "GearChanged\\(gear=PARK\\)" \
      "$SILENT"
  fi
fi

step "끝: 기본값(가짜 내비 켬)으로 되돌림" \
  "debug 기본값(가짜 내비 켬)으로, 주입값은 실제 값으로(이어지는 다른 확인에 영향이 없게). 스크립트가 끝나면서 trip·route·listen·drive·loc·exitcard·range·fuel·home도 같은 값으로 한 번 더 되돌린다" \
  "'시연용 가짜 지도' 표시가 남아 있음" \
  "navi=fake&trip=real&route=real&listen=real&drive=4.5&loc=real&exitcard=real&range=real&fuel=real&home=real" \
  "" 0 \
  "" \
  ""

print_summary
[ "$FAIL_COUNT" -eq 0 ]
