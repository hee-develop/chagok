#!/usr/bin/env bash
# PT 시연(12/3) 도우미. 순서와 장면은 docs/pt-demo.md.
#
#   bash scripts/pt-demo.sh server   PT 일정(fixtures/schedules/pt-day.json)으로 서버를 앞에서 띄운다(watch 없음, Ctrl+C로 종료).
#                                    서버 저장(장소 보정·채비·가족 요청·차 연결)은 메모리라, 리허설을 처음부터 하려면 껐다 다시 띄운다.
#   bash scripts/pt-demo.sh reset    차를 12/3 08:50, 휴대폰 연결 전(연결 카드)으로 되돌린다. 서버가 떠 있어야 연결이 풀리고 새 번호가 나온다.
#   bash scripts/pt-demo.sh check    시연 직전 점검표를 자동으로 돌린다(서버·PT 일정·차/폰 에뮬레이터·시간대·네트워크·Metro).
#   bash scripts/pt-demo.sh fallback 서버에 닿지 않을 때: 연결은 그대로 두고 차를 12/3 08:50 탑승으로 되돌린다.
#                                    차는 같은 날 마지막으로 받은 일정 사본(리허설 때 받은 것)으로 브리핑한다.
#
# 환경 변수: PORT(서버, 기본 8787), CAR_SERIAL(기본 emulator-5554), PHONE_SERIAL(기본 emulator-5556), METRO_PORT(기본 8081),
#   PT_REAL=1 이면 reset이 실제 내비 소요 시간·길안내·음성 인식을 쓴다(기본은 주입: 소요 시간 모름, 길안내 요청 성공, 듣기 끔).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"
CAR_SERIAL="${CAR_SERIAL:-emulator-5554}"
PHONE_SERIAL="${PHONE_SERIAL:-emulator-5556}"
METRO_PORT="${METRO_PORT:-8081}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PT_FIXTURE="fixtures/schedules/pt-day.json"
# PT 일정의 고정 기준 시각(2026-12-03 08:50 서울)을 UTC로. 차 데모 시계도 이 시각에 맞춘다.
PT_ANCHOR_UTC="2026-12-02T23:50:00Z"
PT_ANCHOR_ISO="2026-12-02T23:50:00.000Z"

signal() { # signal <쿼리>: 차 debug 앱에 신호를 넣는다(adb shell만 부를 수 있다)
  "$ADB" -s "$CAR_SERIAL" shell am start -a android.intent.action.VIEW -d "\"chagok-debug://signal?$1\"" >/dev/null
}

case "${1:-}" in
  server)
    if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "포트 ${PORT}에서 이미 서버가 돌고 있습니다. 그 서버를 끄고 다시 하세요(lsof -i tcp:$PORT -sTCP:LISTEN)." >&2
      exit 1
    fi
    echo "PT 일정으로 서버를 띄웁니다: http://127.0.0.1:$PORT ($PT_FIXTURE, 기준 12/3 08:50)"
    cd "$ROOT/server" && PORT="$PORT" FIXTURE_PATH="$PT_FIXTURE" FIXTURE_SEATS=1 exec ./node_modules/.bin/tsx src/index.ts
    ;;
  reset)
    if [ "${PT_REAL:-0}" = 1 ]; then mode="trip=real&route=real&listen=real"; else mode="trip=none&route=ok&listen=off"; fi
    # 연결 확인은 앱이 앞에 있을 때만 돈다(PairingController). 앱을 먼저 띄운 뒤 신호를 넣는다.
    "$ADB" -s "$CAR_SERIAL" shell am start -W -n com.chagok.car/.MainActivity >/dev/null
    signal "paired=false&now=$PT_ANCHOR_UTC&$mode&gear=P&enter=true"
    echo "차를 12/3 08:50 · 휴대폰 연결 전으로 되돌렸습니다($mode). 차 화면에 연결 카드(QR · 번호)가 보여야 합니다."
    ;;
  fallback)
    if [ "${PT_REAL:-0}" = 1 ]; then mode="trip=real&route=real&listen=real"; else mode="trip=none&route=ok&listen=off"; fi
    "$ADB" -s "$CAR_SERIAL" shell am start -W -n com.chagok.car/.MainActivity >/dev/null
    signal "now=$PT_ANCHOR_UTC&$mode&gear=P&enter=true"
    echo "차를 12/3 08:50 탑승으로 되돌렸습니다(연결 유지). 서버에 닿지 않으면 사본으로 브리핑하고 '서버에 연결하지 못해…' 한 줄이 붙습니다."
    ;;
  check)
    fail=0
    ok() { echo "  ✓ $1"; }
    bad() { echo "  ✗ $1"; fail=1; }
    echo "== 서버 (127.0.0.1:$PORT)"
    if curl -fs -m 3 "http://127.0.0.1:$PORT/health" >/dev/null; then ok "서버가 답한다"; else bad "서버가 답하지 않는다: bash scripts/pt-demo.sh server"; fi
    anchor="$(curl -fs -m 3 "http://127.0.0.1:$PORT/schedules/today" | python3 -c 'import json,sys; print(json.load(sys.stdin)["anchor"])' 2>/dev/null)"
    if [ "$anchor" = "$PT_ANCHOR_ISO" ]; then ok "PT 일정(12/3 08:50 기준)을 읽었다"; else bad "PT 일정이 아니다(anchor=$anchor). PT 일정으로 서버를 다시 띄운다"; fi
    received="$(curl -fs -m 3 "http://127.0.0.1:$PORT/events" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("receivedAt"))' 2>/dev/null)"
    if [ "$received" = "None" ]; then ok "폰 기기 캘린더 일정이 섞이지 않았다"; else bad "폰이 기기 캘린더 일정을 보냈다(receivedAt=$received). 폰을 목 캘린더로 띄우고 서버를 다시 띄운다"; fi

    echo "== 차 에뮬레이터 ($CAR_SERIAL)"
    if "$ADB" -s "$CAR_SERIAL" get-state >/dev/null 2>&1; then
      ok "붙어 있다"
      tz="$("$ADB" -s "$CAR_SERIAL" shell getprop persist.sys.timezone | tr -d '\r')"
      if [ "$tz" = "Asia/Seoul" ]; then ok "시간대 서울"; else bad "시간대가 $tz 다. 에뮬레이터를 -timezone Asia/Seoul로 다시 켠다"; fi
      if "$ADB" -s "$CAR_SERIAL" shell pm path com.chagok.car >/dev/null 2>&1; then ok "차곡 앱이 깔려 있다"; else bad "차곡 앱이 없다: cd car && ANDROID_SERIAL=$CAR_SERIAL ./gradlew :app:installDebug"; fi
      reach="$("$ADB" -s "$CAR_SERIAL" shell "(echo -e 'GET /health HTTP/1.0\r\n\r\n'; sleep 1) | toybox nc -w 2 10.0.2.2 $PORT" 2>/dev/null | head -1 | tr -d '\r')"
      case "$reach" in *200*) ok "차에서 서버(10.0.2.2:$PORT)에 닿는다";; *) bad "차에서 서버에 닿지 않는다. 차 네트워크가 끊겼으면 adb -s $CAR_SERIAL reboot";; esac
    else
      bad "붙어 있지 않다"
    fi

    echo "== 폰 에뮬레이터 ($PHONE_SERIAL)"
    if "$ADB" -s "$PHONE_SERIAL" get-state >/dev/null 2>&1; then
      ok "붙어 있다"
      reverse="$("$ADB" -s "$PHONE_SERIAL" reverse --list 2>/dev/null)"
      case "$reverse" in *"tcp:$PORT"*) ok "서버 포트 $PORT 연결(adb reverse)";; *) bad "adb -s $PHONE_SERIAL reverse tcp:$PORT tcp:$PORT";; esac
      case "$reverse" in *"tcp:$METRO_PORT"*) ok "Metro 포트 $METRO_PORT 연결(adb reverse)";; *) bad "adb -s $PHONE_SERIAL reverse tcp:$METRO_PORT tcp:$METRO_PORT";; esac
    else
      bad "붙어 있지 않다"
    fi
    if curl -fs -m 3 "http://127.0.0.1:$METRO_PORT/status" | grep -q running; then ok "Metro가 돈다(:$METRO_PORT)"; else bad "Metro가 없다. docs/pt-demo.md의 Metro 명령으로 띄운다"; fi

    echo
    if [ "$fail" = 0 ]; then echo "점검 통과"; else echo "점검 실패 항목을 고친 뒤 다시 돌린다"; fi
    exit "$fail"
    ;;
  *)
    sed -n 2,12p "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
