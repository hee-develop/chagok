package com.chagok.car.runtime

import com.chagok.car.domain.ServiceZone
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/**
 * 실제 시계에 오프셋을 더하는 시계. 디버그 버튼 [시간 +10분]이 오프셋을 올린다.
 * 시각([instant])만 [base]를 따르고 시간대는 기기 설정이 아니라 [zone]([ServiceZone.SEOUL])이다. [base]의 시간대는 쓰지 않는다.
 */
class DemoClock(
    private val base: Clock = Clock.systemUTC(),
    private val zone: ZoneId = ServiceZone.SEOUL,
) : Clock() {
    @Volatile
    var offset: Duration = Duration.ZERO

    override fun getZone(): ZoneId = zone

    override fun withZone(zone: ZoneId): Clock = DemoClock(base, zone).also { it.offset = offset }

    override fun instant(): Instant = base.instant() + offset
}
