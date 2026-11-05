package com.chagok.car.runtime

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** 실제 시계에 오프셋을 더하는 시계. 디버그 버튼 [시간 +10분]이 오프셋을 올린다. */
class DemoClock(private val base: Clock = Clock.systemDefaultZone()) : Clock() {
    @Volatile
    var offset: Duration = Duration.ZERO

    override fun getZone(): ZoneId = base.zone

    override fun withZone(zone: ZoneId): Clock = DemoClock(base.withZone(zone)).also { it.offset = offset }

    override fun instant(): Instant = base.instant() + offset
}
