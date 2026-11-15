package com.chagok.car.fakenavi

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** 에너지 제안을 수락한 가짜 길안내: 패널에 "경유 · {이름} → {목적지}"로 보인다. */
class FakeNaviViaTest {
    private val destination = Place("광주 육전집", LatLng(35.1595, 126.8526))
    private val via = Place("예시 충전소", LatLng(35.17, 126.89))
    private val departedAt = Instant.parse("2026-11-06T00:20:00Z")

    @Test fun `경유지가 없으면 목적지 한 줄이다`() {
        assertEquals("목적지 · 광주 육전집", FakeNaviPhrases.destination("광주 육전집"))
    }

    @Test fun `경유지가 있으면 경유지와 목적지를 한 줄에 보인다`() {
        assertEquals("경유 · 예시 충전소 → 광주 육전집", FakeNaviPhrases.destination("광주 육전집", "예시 충전소"))
        val trip = FakeTrip(FakeRoute.to(destination), 4_500L, departedAt, via = via)
        assertEquals("경유 · 예시 충전소 → 광주 육전집", FakeNaviPhrases.panel(trip, ZoneId.of("Asia/Seoul")).destination)
        // 도착하면 목적지 도착 한 줄이다(경유지는 더 보이지 않는다)
        trip.seek(1.0)
        assertEquals(null, FakeNaviPhrases.panel(trip, ZoneId.of("Asia/Seoul")).destination)
    }
}
