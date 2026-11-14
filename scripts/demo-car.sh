#!/usr/bin/env bash
# 차량 앱 시나리오 데모(터미널): 가짜 길안내로 출발 제안 → 길안내 → 주행 → 도착 → 하차 카드 → 재탑승 한 줄 → 위치로 도착 판단을 단계마다 신호로 넣고,
# debug 빌드가 남기는 ChagokFlow 로그를 읽어 정책서 기준 기대 동작과 맞는지 ✓/✗로 알려 준다(docs/fake-navi.md).
# 사용: pnpm demo:car   (에뮬레이터가 떠 있어야 한다. 화면은 직접 보면서 Enter로 넘긴다)
# 환경 변수:
#   ANDROID_SERIAL  대상 기기(기본 emulator-5554). adb는 항상 -s로 지정한다.
#   DEMO_INSTALL=1  시작 전에 debug 앱을 설치한다.
#   DEMO_AUTO=1     Enter를 기다리지 않고 바로 진행한다.
#   PORT            서버 포트(기본 8787). 이미 떠 있으면 그대로 쓰고, 없으면 tsx src/index.ts로 띄웠다가 끝날 때 내린다.
# 시작할 때 앱을 force-stop한 뒤 MainActivity를 다시 띄운다(DemoClock이 시작할 때 시간대를 잡고, 가짜 내비는 MainActivity가 앞에 있어야 움직인다).
# 끝날 때(Ctrl-C 포함) 주입값(trip·route·listen·navi·drive·loc·exitcard)을 실제 값으로 되돌린다. 휴대폰 연결 상태는 되돌리지 않는다:
# 시작할 때 paired=true로 '연결됨'으로 두므로(연결 카드가 단계 판정을 가리지 않게), PT 시연 전에는 `pnpm demo:pt reset`으로 다시 연결 전으로 돌린다.
# 시계는 09:20(기준 시각)에서 시작해 재탑승 단계에서 13:30으로 보낸다. 서버·앱 데이터는 바꾸지 않는다.
# 같은 에뮬레이터를 다른 세션이 쓰는 중일 수 있어 Maestro가 돌고 있으면 멈춘다. 이 스크립트는 e2e-car.sh와 달리 flow를 돌리지 않는다.
# 로그 문구는 car/app/src/debug/.../FlowLog.kt가 정한다. 바꾸면 아래 기대 패턴도 함께 고친다.
set -uo pipefail
# 백그라운드로 띄운 서버가 자기 프로세스 그룹을 갖도록 job control을 켠다(그룹 전체를 한 번에 종료하려고 쓴다)
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
ADB=(adb -s "$SERIAL")
RUN_DIR="${DEMO_OUT:-$ROOT/e2e/output/car-demo}/$(date +%Y%m%d-%H%M%S)"
FLOW_LOG="$RUN_DIR/flow.log"
SETTLE="${DEMO_SETTLE:-4}"   # 신호를 넣은 뒤 로그를 모으는 기본 시간(초)

if pgrep -f maestro.cli.AppKt >/dev/null 2>&1; then
  echo "다른 Maestro 실행 중입니다. 같은 에뮬레이터를 쓰므로 끝난 뒤 다시 실행하세요." >&2
  exit 1
fi
if ! "${ADB[@]}" get-state >/dev/null 2>&1; then
  echo "기기 $SERIAL 에 연결할 수 없습니다. ANDROID_SERIAL을 확인하세요." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"

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
  "${ADB[@]}" shell "am start -a android.intent.action.VIEW -d 'chagok-debug://signal?trip=real&route=real&listen=real&navi=real&drive=4.5&loc=real&exitcard=real'" </dev/null >/dev/null 2>&1 || true
  sleep 1
}

cleanup() {
  reset_injection
  [ -n "$LOGCAT_PID" ] && kill "$LOGCAT_PID" 2>/dev/null
  restore_timezone
  stop_server
}
trap cleanup EXIT
trap 'exit 130' INT TERM

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
  (cd "$ROOT/server" && PORT="$PORT" exec ./node_modules/.bin/tsx src/index.ts >"$RUN_DIR/server.log" 2>&1) &
  SERVER_PGID=$!
  for _ in $(seq 1 30); do
    curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null || { echo "서버가 뜨지 않았습니다. $RUN_DIR/server.log 를 확인하세요." >&2; exit 1; }
fi

# 시작 이후 줄만 보려고 현재 위치(줄 수)를 단계마다 적어 둔다. 오래된 줄이 한 줄 섞여도 시작 위치 뒤만 읽어 영향이 없다.
"${ADB[@]}" logcat -v brief -T 1 -s ChagokFlow:I ChagokFakeNavi:I </dev/null >"$FLOW_LOG" 2>&1 &
LOGCAT_PID=$!
sleep 1

# 시간대를 바꾼 뒤 앱을 새로 띄운다. 떠 있던 프로세스는 옛 시간대를 쓰고, MainActivity가 앞에 없으면 가짜 내비가 움직이지 않는다.
echo "== 앱 다시 시작 (시간대 반영)"
"${ADB[@]}" shell am force-stop com.chagok.car </dev/null >/dev/null 2>&1
"${ADB[@]}" shell am start -n com.chagok.car/.MainActivity </dev/null >/dev/null 2>&1 || { echo "앱을 시작하지 못했습니다. debug 앱이 설치돼 있는지 확인하세요(DEMO_INSTALL=1)." >&2; exit 1; }
APP_STARTED=1
sleep 5

# ---- 단계 실행 ----
PASS_COUNT=0
FAIL_COUNT=0
SUMMARY=()
STEP_NO=0
PREV_START=0

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
  echo
  echo "━━ $STEP_NO) $title"
  echo "   기대: $expect"
  echo "   화면: $see"
  if [ "${DEMO_AUTO:-}" != "1" ]; then
    read -r -p "   Enter를 누르면 진행합니다 " _ || true
  fi
  local start
  start=$(wc -l <"$FLOW_LOG" | tr -d ' ')
  local from=$start
  [ "$from_prev" = "1" ] && from=$PREV_START
  PREV_START=$start
  local s
  for s in $signals; do
    case "$s" in
      __ADVANCE__)
        # 데모 시계 09:20(RESET_EPOCH)부터 250분 = 13:30. 그 뒤 실제로 지난 시간은 빼서 맞춘다.
        # advance는 1분 미만이면 신호 전체가 거부되므로(1~10080) 1 밑으로는 내리지 않는다.
        local elapsed=$(( ($(date +%s) - RESET_EPOCH + 30) / 60 )) minutes
        minutes=$((250 - elapsed))
        [ "$minutes" -lt 1 ] && minutes=1
        s="advance=$minutes&trip=9000&enter=true"
        ;;
    esac
    send_signal "$s"
    sleep 1
  done
  if [ -n "$wait_re" ]; then
    local waited=0
    while [ "$waited" -lt "$max_wait" ]; do
      log_lines_since "$from" | tr '\n' '\t' | grep -Eq "$wait_re" && break
      sleep 1
      waited=$((waited + 1))
    done
    sleep 1
  else
    sleep "$SETTLE"
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
}

SILENT='말함:|카드 칩='
FIRST_AT=2026-11-06T00:20:00Z   # 데모 시계 09:20 KST

echo "== 차곡 차량 앱 시나리오 데모 (기기 $SERIAL, 서버 :$PORT)"
echo "   로그: $FLOW_LOG"

step "초기화" \
  "휴대폰 연결됨(paired=true), 데모 시계 09:20, 가짜 내비 켬, 상태 초기화(정책서 3장: 일정 상태 예정). 신호를 넣는 화면이 잠깐 떴다 사라져 '앱 진입'으로 잡히므로, 초기화로 그날 첫 진입이 되어 브리핑이 바로 뜰 수 있다(탑승 규칙상 정상)" \
  "지도(시연용 가짜 지도)가 보이고, 첫 탑승 브리핑 카드가 뜰 수 있음" \
  "paired=true&now=$FIRST_AT&navi=fake&drive=3&trip=12000&route=ok&listen=off&gear=P" \
  "이벤트 Reset" 10 \
  "이벤트 Reset;;GearChanged\\(gear=PARK\\)" \
  ""

RESET_EPOCH=$(date +%s)
step "첫 탑승: 전체 브리핑" \
  "정책서 5장 첫 탑승: 종일 일정 인사 + 대상 일정까지 남은 시간 + 출발할까요?" \
  "오늘 일정·채비 타일이 있는 카드, '1시 육전집 점심까지 3시간 40분이에요', [응, 출발][잠깐만]" \
  "now=$FIRST_AT&enter=true" \
  "카드 칩=" 25 \
  "카드 칩=정차 중 · 출발 전 \\| voice=.*1시 육전집 점심까지 3시간.40분이에요;;sub=.*출발할까요;;말함: .*1시 육전집 점심까지 3시간.40분이에요.*출발할까요" \
  ""
RESET_EPOCH=$(date +%s)   # 이 시각이 데모 시계 09:20이다(Enter 대기 시간은 아래 advance에서 뺀다)

step "수락: 길안내 시작" \
  "정책서 7장: '응' → 길안내 요청 + 결과 한 줄 '길안내를 시작할게요.'" \
  "카드가 접히고 결과 한 줄, 지도에 곡선 경로와 왼쪽 아래 길안내 패널(목적지 · 광주 육전집, 큰 도착 시각, 도착 · N km 남음)" \
  "heard=%EC%9D%91" \
  "결과 한 줄: 길안내를 시작할게요" 10 \
  "길안내 요청: 광주 육전집;;결과 한 줄: 길안내를 시작할게요" \
  ""

step "주행: 카드·말 없음, 도착까지 기다림" \
  "정책서 6장: 주행 중에는 먼저 말하지 않고(카드 접기) 다음 일정 칩만 남긴다. 가짜 내비가 목적지에 닿으면 내비 도착 알림이 세션에 들어가고 칩은 다음 일정으로 바뀐다" \
  "카드·말 없이 왼쪽 위에 칩 '다음 13:00 육전집 점심'(누를 수 없음), 지도에서 차가 곡선 경로를 따라 움직이고 남은 거리가 줄어듦(약 3초). 도착하면 패널이 '광주 육전집 도착', 칩이 '다음 17:00 KIA 직관'" \
  "gear=D" \
  "저장: .*예정→도착" 45 \
  "GearChanged\\(gear=DRIVE\\);;다음 일정 칩: 13:00 육전집 점심;;ChagokFakeNavi.*도착: 광주 육전집;;이벤트 DestinationArrived;;다음 일정 칩: 17:00 KIA 직관" \
  "$SILENT"

step "도착: 육전집 점심이 '도착'으로 기록됨" \
  "정책서 6장: 도착 → 일정을 도착으로 기록. 화면·대사 없음(하차 카드는 정차해야 뜬다)" \
  "카드·말 없이 패널만 '광주 육전집 도착', 왼쪽 위 칩은 '다음 17:00 KIA 직관'" \
  "" \
  "" 0 \
  "저장: [^ ,]+ 예정→도착" \
  "$SILENT|결과 한 줄:" 1

# 하차 카드(일정 장소): 도착이 기록된 뒤 달린 다음 P단에 넣으면 한 번 말하고 5초(Rules.EXIT_CARD) 뒤 닫힌다. 육전집 점심 메모는 '유니폼·응원봉·티켓'이라 챙길 것 카드다.
# 닫힌 뒤에 재탑승 단계가 오도록 "카드 접음"까지 기다린다(카드가 떠 있는 채 탑승 신호가 오면 잠깐 정차 규칙을 따른다).
# 위치는 가짜 내비 경로 끝(= 육전집)이라 다음 일정(KIA) 장소에서는 멀어 또 도착으로 보지 않는다.
step "정차(P): 하차 카드" \
  "도착이 기록된 뒤 P단 → 일정 장소 하차 카드(docs/exit-card.md). 메모가 짧아 챙길 것을 한 번 말하고(듣지 않음) 5초 뒤 자동으로 닫힌다. 질문 없음. 주행 중 칩은 같은 이벤트에서 바로 숨는다" \
  "'도착 · 내리기 전' 칩, 큰 문구 '유니폼·응원봉·티켓 챙기세요!', 채비 타일, 메모 한 줄, [챙겼어요], '5초 뒤 자동으로 닫혀요' + 줄어드는 막대, 지도 덮개 72%(패널은 카드가 떠 있는 동안 숨음). 5초 뒤 카드가 접히고 패널('광주 육전집 도착')이 다시 보임" \
  "gear=P" \
  "카드 칩=도착 · 내리기 전.*카드 접음" 12 \
  "GearChanged\\(gear=PARK\\);;다음 일정 칩 숨김;;카드 칩=도착 · 내리기 전 \\| voice=유니폼·응원봉·티켓 챙기세요!;;각주=‘육전집 점심’ 일정 메모: 유니폼·응원봉·티켓;;버튼=챙겼어요;;말함: 유니폼·응원봉·티켓 챙기세요!.*카드 접음" \
  "\\(듣기\\)|sub=|소요 시간 요청|결과 한 줄:"

# 재탑승 시각은 13:30(09:20부터 250분)이다. 점심(13:00~14:00)이 끝나기 전이라, 도착이 기록됐을 때만 KIA 직관 한 줄이 뜨고
# 기록되지 않았으면 점심 늦게 탐 카드가 뜬다(14:00 뒤면 건너뜀 처리로 구분이 안 된다). 사람이 Enter로 지체한 실제 시간은 advance에서 뺀다.
# 정책서 5장(출발 시각 = 시작 - 소요 - 여유 10분, 60분 넘게 이르면 '어디로 갈까요?'): trip=9000(150분)이면 KIA 출발 시각 14:20이라
# 지금(13:30)까지 50분 → 출발 제안. 점심이 대상이었다면 지금 출발해 16:00 도착이라 5분 넘게 늦음 → 늦게 탐.
step "재탑승: 다음 일정 한 줄" \
  "정책서 5·6장: 같은 날 두 번째 탑승(P 뒤 10분 넘음) → 대상 일정 한 줄 + 출발할까요? 13:30 기준 KIA 출발 시각(14:20)까지 50분이라 출발 제안(점심은 도착 기록이 없으면 늦게 탐)" \
  "'5시 KIA 직관까지 …이에요.' + '출발할까요?' 카드(오늘 일정 타일·종일 인사 없음), [응, 출발][잠깐만]" \
  "__ADVANCE__" \
  "카드 칩=" 25 \
  "소요 시간 요청: .*챔피언스필드;;카드 칩=정차 중 · 출발 전 \\| voice=5시 KIA 직관까지 .*이에요\\.;;sub=.*출발할까요\\?;;말함: 5시 KIA 직관까지 .*이에요\\..*출발할까요\\? \\(듣기\\)" \
  "광주 직관 날이에요|육전집 점심까지|점심이 1시인데"

# ---- 위치 기반 도착 판단. 신호 loc으로 위치를 넣고, 달린 뒤(gear=D) P단에 넣는 순간 판정한다. 가짜 내비는 끄고 실제 내비 모드다. ----
# 장소는 픽스처의 육전집(35.1595,126.8526, 13:00 점심).
LUNCH_LOC='35.1595,126.8526'

step "위치로 도착: 내비 도착 알림 없이 육전집 300m 안에서 P단" \
  "정책서 3·4장: 달린 뒤 P단에 넣은 곳이 대상 일정 장소 300m 안이면 도착으로 기록하고 그 시점에 바로 하차 카드를 띄운다(docs/exit-card.md). 내비 도착 알림은 없다(길안내를 하지 않았다)" \
  "가짜 지도가 사라지고 '도착 · 내리기 전' 칩, '유니폼·응원봉·티켓 챙기세요!', 채비 타일, [챙겼어요]. 5초 뒤 접힘(초기화 직후라 첫 탑승 브리핑 카드가 먼저 떠 있을 수 있음)" \
  "now=$FIRST_AT&advance=170&navi=real&listen=off&trip=none&exitcard=real&gear=P gear=D loc=$LUNCH_LOC&gear=P" \
  "카드 칩=도착 · 내리기 전.*카드 접음" 15 \
  "저장: [^ ,]+ 예정→도착;;카드 칩=도착 · 내리기 전 \\| voice=유니폼·응원봉·티켓 챙기세요!;;버튼=챙겼어요;;말함: 유니폼·응원봉·티켓 챙기세요!.*카드 접음" \
  "DestinationArrived"

step "끝: 실제 내비로 되돌림" \
  "가짜 내비를 끄고 실제 내비 모드로, 주입값도 실제 값으로(이어지는 다른 확인에 영향이 없게)" \
  "'시연용 가짜 지도' 표시가 사라짐" \
  "navi=real&trip=real&route=real&listen=real&drive=4.5&loc=real&exitcard=real" \
  "" 0 \
  "" \
  ""

echo
echo "━━ 요약"
printf '%s\n' "${SUMMARY[@]}"
echo "통과 $PASS_COUNT, 실패 $FAIL_COUNT"
[ "$FAIL_COUNT" -eq 0 ]
