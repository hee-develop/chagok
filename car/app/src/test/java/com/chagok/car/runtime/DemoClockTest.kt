package com.chagok.car.runtime

import com.chagok.car.domain.ServiceZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.TimeZone

/** 차의 '오늘'·시각 표기는 기기 시간대가 아니라 늘 서울이다(Pleos 에뮬레이터는 UTC로 떠 있을 수 있다). */
class DemoClockTest {
    private val defaultZone = TimeZone.getDefault()

    @After fun restore() = TimeZone.setDefault(defaultZone)

    @Test fun `기기 시간대가 UTC여도 시계의 시간대는 서울이다`() {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
        assertEquals(ZoneId.of("Asia/Seoul"), DemoClock().zone)
        assertEquals(ServiceZone.SEOUL, DemoClock().zone)
        // 기반 시계가 UTC나 기기 시간대여도 시각만 따르고 시간대는 서울이다.
        assertEquals(ServiceZone.SEOUL, DemoClock(Clock.systemDefaultZone()).zone)
        assertEquals(ServiceZone.SEOUL, DemoClock(Clock.fixed(Instant.EPOCH, ZoneOffset.UTC)).zone)
    }

    @Test fun `UTC 23시 50분은 서울의 다음 날 08시 50분이다`() {
        val clock = DemoClock(Clock.fixed(Instant.parse("2026-12-02T23:50:00Z"), ZoneOffset.UTC))
        val seoul = clock.instant().atZone(clock.zone)
        assertEquals("2026-12-03", seoul.toLocalDate().toString())
        assertEquals("08:50", seoul.toLocalTime().toString())
        // 시간 +10분(오프셋)으로 UTC 날짜가 넘어가도 서울 날짜는 그대로다.
        clock.offset += Duration.ofMinutes(10)
        assertEquals("2026-12-03", clock.instant().atZone(clock.zone).toLocalDate().toString())
    }

    @Test fun `withZone은 오프셋을 유지하고 지정한 시간대를 쓴다`() {
        val clock = DemoClock(Clock.fixed(Instant.parse("2026-12-02T23:50:00Z"), ZoneOffset.UTC))
        clock.offset = Duration.ofMinutes(25)
        val utc = clock.withZone(ZoneOffset.UTC)
        assertEquals(ZoneOffset.UTC, utc.zone)
        assertEquals(clock.instant(), utc.instant())
    }
}
