package com.chagok.car

import android.os.Handler
import android.os.Looper
import com.chagok.car.domain.EnergyKind
import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.domain.LatLng
import com.chagok.car.fakenavi.FakeNaviSession
import com.chagok.car.flow.Event
import com.chagok.car.runtime.SessionHost
import java.time.Duration
import java.time.Instant

/**
 * E2E용 가짜 차량 신호·내비 결과·들은 말을 세션에 넣는다. 값은 이름으로 찾는다.
 *
 * - `paired`: true면 휴대폰과 연결된 것으로 두고(말하지 않음), false면 연결을 풀어(서버도) 연결 카드를 띄운다. 가장 먼저 처리한다.
 *   연결 상태는 차에 저장돼 남는다. 연결 카드가 없는 기존 흐름의 E2E는 시작할 때 `paired=true`를 넣는다
 * - `now`: ISO8601 시각. 데모 시계와 일정 기준 시각을 그 시각으로 맞추고 상태(가짜 경로 포함)를 비운다(연결 다음에 처리). `exitcard`도 `real`로 되돌린다. 이 시각은 [데모 초기화] 버튼이 시계를 되돌릴 시작 시각으로 기억한다([DebugDemoReset])
 * - `trip`: 소요 시간 조회 결과를 초 단위로(`2400`). `none`이면 "모름", `real`이면 실제 내비([DebugInjection])
 * - `route`: 길안내 요청 결과 `ok`·`fail`. `real`이면 실제 내비([DebugInjection])
 * - `exitcard`: 하차 카드가 떠 있는 시간을 초 단위로(`30`, E2E가 문구를 확인하게). `real`이면 정책 기준값(5초)
 * - `navi`: `fake`(debug 기본)면 가짜 길안내(직접 그린 지도), `real`이면 실제 내비·실제 위치. 바꾸면 가짜 경로를 지운다
 * - `drive`: 가짜 경로 전체를 지나가는 실제 시간(초, 소수 가능, 기본 4.5)
 * - `progress`: 0~1. 가짜 경로의 진행률을 그 값으로 바로 옮긴다(정차 중에도 동작, 경로가 없으면 무시)
 * - `advance`: 분 단위(1~10080, 7일). 범위를 벗어나면 그 신호 전체를 거부한다(아무것도 적용하지 않음). 데모 시계를 그만큼 앞으로 보낸다(상태는 지우지 않음, 디버그 버튼 [시간 +10분]과 같다).
 *   다른 신호처럼 메인 큐에 순서대로 넣는다. `now`와 같이 오면 `now`(시계 맞춤) 뒤에 적용되어 `now`+`advance`분이 되고,
 *   같은 주소의 `ignition`·`gear`·`enter`·`board` 이벤트보다 먼저 처리된다(재탑승 시각을 정한 뒤 탑승을 넣는 순서).
 *   `gear=P`와 같은 주소에 쓰면 P단 시각도 앞당겨지므로 P단을 넣은 뒤 따로 보낸다. 위치 도착은 측위한 지 5분 이내만 쓰므로 `loc`은 `advance`를 보낸 뒤에 넣는다
 * - `listen`: `off`면 말이 끝나도 실제 STT를 열지 않는다. `real`이면 연다
 * - `ignition`: LOCK·OFF·ACC·ON·START
 * - `gear`: P·R·N·D
 * - `restricted`: true·false (주행 제한 알림)
 * - `enter`: true면 앱 진입(탑승 규칙 적용), `board`: true면 규칙 없이 탑승
 * - `loc`: 현재 위치 `위도,경도`(내비가 답한 것처럼, 방금 측위한 값). 기어보다 뒤에 넣어 `gear=P&loc=…`가 P단 도착 판단의 답이 되게 한다.
 *   주입한 동안에는 위치 어댑터가 읽은 실제 위치·가짜 경로 위치·실제 내비의 위치 답을 모두 세션에 넣지 않고 이 값만 쓴다. `real`이면 주입을 풀어 가짜 경로·실제 위치로 돌아간다.
 *   가짜 내비가 켜져 있으면 주입하지 않아도 어댑터의 실제 위치(에뮬레이터 GPS)는 세션에 넣지 않는다
 * - `arrived`: true면 내비 목적지 도착 알림(차곡이 길안내를 시작한 일정이 도착이 된다). 가짜 내비는 목적지에 닿으면 이 알림을 스스로 넣는다
 * - `fuel`: `ev`·`gas`·`diesel`·`hybrid`. 차가 읽은 연료 종류 대신 이 값을 에너지 체크에 쓴다. `real`이면 차가 읽은 값([EnergyOverride])
 * - `range`: 주행 가능 거리(km, 소수 가능, 0 이상). 차가 읽은 값 대신 쓴다. `real`이면 차가 읽은 값. 연료 종류와 주행 가능 거리를 둘 다 알아야 에너지 체크를 한다
 *   (`range=150&fuel=ev`). 에너지 신호는 `board`·`enter`·`ignition`·`gear`보다 먼저 세션에 들어가 같은 주소의 탑승 판단이 이 값을 본다
 * - `battery`: 배터리·연료 잔량(0~100, 소수 가능). 차가 읽은 값 대신 카드의 배터리 타일 "45% · 갈 수 있는 거리 N km"에 쓴다(에너지 체크 판단에는 쓰지 않는다).
 *   `real`이면 차가 읽은 값(못 읽으면 % 없이 거리만 보인다)
 * - `home`: 집 좌표 `위도,경도`. 서버 자주 가는 곳의 집 대신 쓴다(에너지 체크의 '집까지' 거리를 멀리 두는 시연용). `real`이면 서버 값
 * - `heard`: 들은 말(STT 결과). 빈 값이면 아무것도 못 들은 것(가장 마지막에 처리). 세션이 처리한 뒤 디버그 줄([DebugRow])에 "들은 말 처리: <말>"을 보인다
 */
object DebugSignals {
    fun apply(host: SessionHost, value: (String) -> String?) {
        // 범위 검사로 거부하는 신호는 아무것도 적용하기 전에 먼저 읽는다(신호 전체 거부).
        val advanceBy = value("advance")?.let { Duration.ofMinutes(advanceOf(it)) }
        value("paired")?.let { host.setPaired(it.toBoolean()) }
        value("now")?.let {
            FakeNaviSession.shared.clear()
            val startAt = Instant.parse(it)
            // [데모 초기화] 버튼이 이 시각으로 되돌린다.
            DebugInjection.demoStartAt = startAt
            host.resetDemo(startAt)
            // 데모 초기화는 하차 카드 시간도 되돌린다(flow가 중간에 실패해도 늘어난 시간이 남지 않게). 같은 신호의 exitcard는 아래에서 다시 정한다.
            DebugInjection.exitCardSeconds = null
        }
        advanceBy?.let { by ->
            Handler(Looper.getMainLooper()).post {
                host.advanceClock(by)
                // 정차 중에도 가짜 내비 패널의 도착 예정 시각이 바뀐 시계로 다시 그려지게 한다(주기 타이머는 없다).
                FakeNaviSession.shared.onChanged?.invoke()
            }
        }
        value("trip")?.let { DebugInjection.tripSeconds = tripOf(it) }
        value("route")?.let { DebugInjection.routeOk = routeOf(it) }
        value("exitcard")?.let { DebugInjection.exitCardSeconds = exitCardOf(it) }
        value("navi")?.let { FakeNaviSession.shared.setEnabled(naviOf(it)) }
        value("drive")?.let { DebugInjection.driveMillis = driveOf(it) }
        value("progress")?.let { FakeNaviSession.shared.setProgress(progressOf(it)) }
        value("listen")?.let { DebugInjection.realListening = listenOf(it) }
        value("home")?.let { DebugInjection.homeOverride = locOf(it) }
        val fuel = value("fuel")
        val range = value("range")
        val battery = value("battery")
        fuel?.let { DebugInjection.fuel = fuelOf(it) }
        range?.let { DebugInjection.rangeKm = rangeOf(it) }
        battery?.let { DebugInjection.batteryPercent = batteryOf(it) }
        // 에너지 신호는 같은 주소의 기어·탑승 이벤트보다 먼저 세션에 넣는다(메인 큐 순서).
        if (fuel != null || range != null || battery != null) host.post(EnergyOverride.merged())
        value("ignition")?.let { host.post(Event.IgnitionChanged(Ignition.valueOf(it.uppercase()))) }
        value("gear")?.let { host.post(Event.GearChanged(gearOf(it))) }
        value("restricted")?.let { host.post(Event.RestrictionChanged(it.toBoolean())) }
        value("loc")?.let {
            val position = locOf(it)
            DebugInjection.injectedLocation = position
            if (position != null) host.post(Event.LocationChanged(position))
        }
        if (value("arrived").toBoolean()) host.post(Event.DestinationArrived)
        if (value("enter").toBoolean()) host.post(Event.AppEntered)
        if (value("board").toBoolean()) host.post(Event.Boarded)
        value("heard")?.let {
            host.post(Event.Heard(it))
            // 세션 이벤트는 같은 메인 큐에 먼저 들어갔으므로 이 알림은 처리된 뒤에 실행된다.
            Handler(Looper.getMainLooper()).post { DebugInjection.heardProcessed?.invoke(it) }
        }
    }

    /** `loc=위도,경도`. `real`이면 null(주입 해제). */
    private fun locOf(text: String): LatLng? {
        if (text.equals("real", ignoreCase = true)) return null
        val (lat, lng) = text.split(',').map { it.trim().toDouble() }.also { require(it.size == 2) { "loc은 위도,경도여야 합니다: $text" } }
        return LatLng(lat, lng)
    }

    /** `fuel=ev|gas|diesel|hybrid`. `real`이면 null(주입 해제). */
    internal fun fuelOf(text: String): EnergyKind? = when (text.lowercase()) {
        "real" -> null
        "ev" -> EnergyKind.EV
        "gas" -> EnergyKind.GASOLINE
        "diesel" -> EnergyKind.DIESEL
        "hybrid" -> EnergyKind.HYBRID
        else -> error("알 수 없는 fuel: $text")
    }

    /** `range=<km>`. 0 이상의 숫자만 받는다. `real`이면 null(주입 해제). */
    internal fun rangeOf(text: String): Double? = when (text.lowercase()) {
        "real" -> null
        else -> text.toDouble().also { require(it.isFinite() && it >= 0.0) { "range는 0 이상의 km여야 합니다: $text" } }
    }

    /** `battery=<0~100>`. 0~100의 숫자만 받는다. `real`이면 null(주입 해제). */
    internal fun batteryOf(text: String): Double? = when (text.lowercase()) {
        "real" -> null
        else -> text.toDouble().also { require(it.isFinite() && it in 0.0..100.0) { "battery는 0~100이어야 합니다: $text" } }
    }

    private fun gearOf(name: String) = when (name.uppercase()) {
        "P" -> Gear.PARK
        "R" -> Gear.REVERSE
        "N" -> Gear.NEUTRAL
        "D" -> Gear.DRIVE
        else -> error("알 수 없는 기어: $name")
    }

    private fun tripOf(text: String): Long? = when (text.lowercase()) {
        "real" -> null
        "none" -> DebugInjection.NO_TRIP
        else -> text.toLong().also { require(it > 0) { "trip은 양수 초여야 합니다: $text" } }
    }

    internal fun exitCardOf(text: String): Long? = when (text.lowercase()) {
        "real" -> null
        else -> text.toLong().also { require(it > 0) { "exitcard는 양수 초여야 합니다: $text" } }
    }

    /** advance 상한(분). 7일. 이보다 크면 시계가 며칠씩 건너뛰어 일정 판단이 어긋나므로 신호를 거부한다. */
    internal const val MAX_ADVANCE_MINUTES = 10_080L

    internal fun advanceOf(text: String): Long =
        text.toLong().also { require(it in 1..MAX_ADVANCE_MINUTES) { "advance는 1~$MAX_ADVANCE_MINUTES 분이어야 합니다: $text" } }

    private fun routeOf(text: String): Boolean? = when (text.lowercase()) {
        "real" -> null
        "ok" -> true
        "fail" -> false
        else -> error("알 수 없는 route: $text")
    }

    private fun naviOf(text: String) = when (text.lowercase()) {
        "real" -> false
        "fake" -> true
        else -> error("알 수 없는 navi: $text")
    }

    /** `drive=<초>`. 소수도 받는다(예: 4.5). 밀리초로 바꿔 돌려준다. */
    private fun driveOf(text: String): Long {
        val seconds = text.toDouble()
        require(seconds.isFinite() && seconds > 0) { "drive는 양수 초여야 합니다: $text" }
        return (seconds * 1000).toLong().coerceAtLeast(1L)
    }

    private fun progressOf(text: String): Double =
        text.toDouble().also { require(it in 0.0..1.0) { "progress는 0~1이어야 합니다: $text" } }

    private fun listenOf(text: String) = when (text.lowercase()) {
        "real" -> true
        "off" -> false
        else -> error("알 수 없는 listen: $text")
    }
}
