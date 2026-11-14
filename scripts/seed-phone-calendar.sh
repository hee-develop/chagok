#!/usr/bin/env bash
# 폰 E2E(device-calendar flow)용: Android 에뮬레이터의 Calendar Provider에 로컬 캘린더와 일정을 심거나 지운다.
# 사용법: scripts/seed-phone-calendar.sh <adb 시리얼> seed|clean
#   예) scripts/seed-phone-calendar.sh emulator-5556 seed
# - 시리얼은 반드시 직접 넘긴다(adb는 항상 -s로 기기를 지정한다). emulator-5554(Pleos 차량 에뮬레이터)는 거부한다.
# - 계정은 LOCAL 타입의 chagok-e2e@local 하나뿐이라 clean이 이 계정의 캘린더(와 그 일정)만 지운다. 다른 캘린더는 건드리지 않는다.
# - adb shell 인자는 한글이 깨질 수 있어 캘린더 이름·제목·장소를 모두 ASCII로 둔다. flow와 assert-device-calendar.js가 같은 글자를 쓴다.
# 심는 것(서울 기준): 캘린더 'ChagokE2E'(소유자 권한, 기본 선택)에
#   오늘 13:00-14:00 'E2E Today Meeting' (장소 'E2E Place', 메모 'E2E notes'),
#   내일 09:00-10:00 'E2E Tomorrow Visit',
#   3일 뒤 09:00-10:00 'E2E Far Away' (오늘·내일이 아니라 서버로 가면 안 된다).
set -euo pipefail

SERIAL="${1:-}"
ACTION="${2:-}"
if [ -z "$SERIAL" ] || { [ "$ACTION" != seed ] && [ "$ACTION" != clean ]; }; then
  echo "사용법: $0 <adb 시리얼> seed|clean" >&2
  exit 2
fi
if [ "$SERIAL" = emulator-5554 ]; then
  echo "emulator-5554는 Pleos 차량 에뮬레이터입니다. 폰 에뮬레이터 시리얼을 넘겨 주세요." >&2
  exit 2
fi

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$SDK/platform-tools/adb}"
ACCOUNT="chagok-e2e@local"
SYNC="caller_is_syncadapter=true&account_name=$ACCOUNT&account_type=LOCAL"
CAL_URI="content://com.android.calendar/calendars"
EVENT_URI="content://com.android.calendar/events"

# 기기 셸에서 실행한다. 인자는 기기 쪽 sh가 다시 해석하므로 큰따옴표로 감싼 한 문자열로 넘긴다.
dev() { "$ADB" -s "$SERIAL" shell "$1"; }

calendar_id() {
  dev "content query --uri $CAL_URI --projection _id --where \"account_name='$ACCOUNT'\"" |
    tr -d '\r' | sed -n 's/.*_id=\([0-9][0-9]*\).*/\1/p' | head -1
}

clean() {
  dev "content delete --uri \"$CAL_URI?$SYNC\" --where \"account_name='$ACCOUNT'\"" >/dev/null || true
  echo "심어 둔 캘린더를 지웠습니다 ($ACCOUNT)"
}

seed() {
  [ "$("$ADB" -s "$SERIAL" get-state 2>/dev/null)" = device ] || { echo "$SERIAL 기기를 찾을 수 없습니다" >&2; exit 1; }
  clean # 이전 실행이 남긴 것이 있으면 먼저 지운다
  local color=$((0xFF3367D6 - 4294967296)) # ARGB 정수(부호 있는 32비트)
  dev "content insert --uri \"$CAL_URI?$SYNC\" \
    --bind account_name:s:$ACCOUNT --bind account_type:s:LOCAL --bind name:s:chagok-e2e \
    --bind calendar_displayName:s:ChagokE2E --bind calendar_color:i:$color \
    --bind calendar_access_level:i:700 --bind visible:i:1 --bind sync_events:i:1 \
    --bind ownerAccount:s:$ACCOUNT --bind calendar_timezone:s:Asia/Seoul"
  local id
  id="$(calendar_id)"
  [ -n "$id" ] || { echo "캘린더 id를 읽지 못했습니다" >&2; exit 1; }

  # 서울 기준 오늘 0시의 UTC 밀리초 = (지금 + 9h)를 하루 단위로 내림 - 9h
  local today_ms
  today_ms="$(node -e 'const D=864e5,K=9*36e5;console.log(Math.floor((Date.now()+K)/D)*D-K)')"
  local h=3600000 d=86400000
  insert_event() { # <제목> <시작 ms> <끝 ms> [장소 메모]
    local extra=""
    [ -z "${4:-}" ] || extra="--bind eventLocation:s:\"$4\" --bind description:s:\"${5:-}\""
    dev "content insert --uri \"$EVENT_URI?$SYNC\" \
      --bind calendar_id:i:$id --bind title:s:\"$1\" --bind dtstart:l:$2 --bind dtend:l:$3 \
      --bind eventTimezone:s:Asia/Seoul --bind allDay:i:0 $extra"
  }
  insert_event "E2E Today Meeting" $((today_ms + 13 * h)) $((today_ms + 14 * h)) "E2E Place" "E2E notes"
  insert_event "E2E Tomorrow Visit" $((today_ms + d + 9 * h)) $((today_ms + d + 10 * h))
  insert_event "E2E Far Away" $((today_ms + 3 * d + 9 * h)) $((today_ms + 3 * d + 10 * h))
  echo "캘린더 ChagokE2E(id=$id)와 일정 3개를 심었습니다"
}

"$ACTION"
