package com.chagok.car

import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.flow.Event
import com.chagok.car.runtime.SessionHost
import java.time.Instant

/**
 * E2E용 가짜 차량 신호를 세션에 넣는다. 값은 이름으로 찾는다.
 *
 * - `now`: ISO8601 시각. 데모 시계와 일정 기준 시각을 그 시각으로 맞추고 상태를 비운다(가장 먼저 처리)
 * - `ignition`: LOCK·OFF·ACC·ON·START
 * - `gear`: P·R·N·D
 * - `restricted`: true·false (주행 제한 알림)
 * - `enter`: true면 앱 진입(탑승 규칙 적용), `board`: true면 규칙 없이 탑승
 */
object DebugSignals {
    fun apply(host: SessionHost, value: (String) -> String?) {
        value("now")?.let { host.resetDemo(Instant.parse(it)) }
        value("ignition")?.let { host.post(Event.IgnitionChanged(Ignition.valueOf(it.uppercase()))) }
        value("gear")?.let { host.post(Event.GearChanged(gearOf(it))) }
        value("restricted")?.let { host.post(Event.RestrictionChanged(it.toBoolean())) }
        if (value("enter").toBoolean()) host.post(Event.AppEntered)
        if (value("board").toBoolean()) host.post(Event.Boarded)
    }

    private fun gearOf(name: String) = when (name.uppercase()) {
        "P" -> Gear.PARK
        "R" -> Gear.REVERSE
        "N" -> Gear.NEUTRAL
        "D" -> Gear.DRIVE
        else -> error("알 수 없는 기어: $name")
    }
}
