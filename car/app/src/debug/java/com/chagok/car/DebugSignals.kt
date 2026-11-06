package com.chagok.car

import android.os.Handler
import android.os.Looper
import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.flow.Event
import com.chagok.car.runtime.SessionHost
import java.time.Instant

/**
 * E2E용 가짜 차량 신호·내비 결과·들은 말을 세션에 넣는다. 값은 이름으로 찾는다.
 *
 * - `now`: ISO8601 시각. 데모 시계와 일정 기준 시각을 그 시각으로 맞추고 상태를 비운다(가장 먼저 처리)
 * - `trip`: 소요 시간 조회 결과를 초 단위로(`2400`). `none`이면 "모름", `real`이면 실제 내비([DebugInjection])
 * - `route`: 길안내 요청 결과 `ok`·`fail`. `real`이면 실제 내비([DebugInjection])
 * - `listen`: `off`면 말이 끝나도 실제 STT를 열지 않는다. `real`이면 연다
 * - `ignition`: LOCK·OFF·ACC·ON·START
 * - `gear`: P·R·N·D
 * - `restricted`: true·false (주행 제한 알림)
 * - `enter`: true면 앱 진입(탑승 규칙 적용), `board`: true면 규칙 없이 탑승
 * - `heard`: 들은 말(STT 결과). 빈 값이면 아무것도 못 들은 것(가장 마지막에 처리). 세션이 처리한 뒤 디버그 줄([DebugRow])에 "들은 말 처리: <말>"을 보인다
 */
object DebugSignals {
    fun apply(host: SessionHost, value: (String) -> String?) {
        value("now")?.let { host.resetDemo(Instant.parse(it)) }
        value("trip")?.let { DebugInjection.tripSeconds = tripOf(it) }
        value("route")?.let { DebugInjection.routeOk = routeOf(it) }
        value("listen")?.let { DebugInjection.realListening = listenOf(it) }
        value("ignition")?.let { host.post(Event.IgnitionChanged(Ignition.valueOf(it.uppercase()))) }
        value("gear")?.let { host.post(Event.GearChanged(gearOf(it))) }
        value("restricted")?.let { host.post(Event.RestrictionChanged(it.toBoolean())) }
        if (value("enter").toBoolean()) host.post(Event.AppEntered)
        if (value("board").toBoolean()) host.post(Event.Boarded)
        value("heard")?.let {
            host.post(Event.Heard(it))
            // 세션 이벤트는 같은 메인 큐에 먼저 들어갔으므로 이 알림은 처리된 뒤에 실행된다.
            Handler(Looper.getMainLooper()).post { DebugInjection.heardProcessed?.invoke(it) }
        }
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

    private fun routeOf(text: String): Boolean? = when (text.lowercase()) {
        "real" -> null
        "ok" -> true
        "fail" -> false
        else -> error("알 수 없는 route: $text")
    }

    private fun listenOf(text: String) = when (text.lowercase()) {
        "real" -> true
        "off" -> false
        else -> error("알 수 없는 listen: $text")
    }
}
