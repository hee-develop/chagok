package com.chagok.car.fakenavi

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

class FakeTripTest {
    private val route = FakeRoute.to(Place("광주 육전집", LatLng(35.1595, 126.8526)))
    private val DEPARTED = Instant.parse("2026-11-06T00:20:00Z")

    @Test fun `주행 중이 아니면 움직이지 않는다`() {
        val t = FakeTrip(route, 10_000, DEPARTED)
        assertFalse(t.advance(5000, driving = false))
        assertEquals(0.0, t.traveledMeters, 0.0)
    }

    @Test fun `전체 경로를 drive초 동안 지난다`() {
        val t = FakeTrip(route, 10_000, DEPARTED)
        t.advance(5000, true)
        assertEquals(route.lengthMeters / 2, t.traveledMeters, 0.01)
        assertEquals(0.5, t.remainingRatio, 1e-9)
        assertFalse(t.arrived)
    }

    @Test fun `멈췄다가 다시 주행하면 이어서 간다`() {
        val t = FakeTrip(route, 10_000, DEPARTED)
        t.advance(3000, true)
        val before = t.traveledMeters
        t.advance(4000, false)
        assertEquals(before, t.traveledMeters, 0.0)
        t.advance(2000, true)
        assertEquals(route.lengthMeters * 0.5, t.traveledMeters, 0.01)
    }

    @Test fun `끝에 닿으면 도착이고 도착 순간에만 true를 돌려준다`() {
        val t = FakeTrip(route, 10_000, DEPARTED)
        assertFalse(t.advance(9000, true))
        assertTrue(t.advance(2000, true))
        assertTrue(t.arrived)
        assertEquals(route.lengthMeters, t.traveledMeters, 0.0)
        assertFalse(t.advance(1000, true))
        assertEquals(0.0, t.remainingMeters, 0.0)
        assertEquals(route.destination.position.lat, t.position.position.lat, 1e-9)
    }

    @Test fun `남은 시간은 소요 시간 곱하기 남은 비율이다`() {
        val t = FakeTrip(route, 10_000, DEPARTED)
        t.advance(2500, true)
        assertEquals(route.duration.toMillis() * 0.75, t.remainingDuration.toMillis().toDouble(), 2.0)
        assertEquals(route.lengthMeters * 0.75, t.remainingMeters, 0.01)
    }

    @Test fun `길이가 0인 경로도 도착 알림이 정확히 한 번 간다`() {
        val t = FakeTrip(FakeRoute.to(Place("여기", FakeRoute.ORIGIN.position)), 10_000, DEPARTED)
        assertTrue(t.arrived)
        assertTrue(t.consumeArrival())
        assertFalse(t.consumeArrival())
        assertFalse(t.advance(1000, true))
    }

    @Test fun `진행률로 건너뛰면 그 자리로 가고 도착은 한 번만 알린다`() {
        val t = FakeTrip(route, 10_000, DEPARTED)
        assertFalse(t.seek(0.5))
        assertEquals(route.lengthMeters / 2, t.traveledMeters, 0.01)
        assertTrue(t.seek(1.0))
        assertFalse(t.seek(1.0))
        assertFalse(t.seek(0.2))
        assertTrue(t.seek(1.0))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `drive가 0 이하면 거부한다`() {
        FakeTrip(route, 0, DEPARTED)
    }

    @Test fun `도착 예정은 출발 시각 더하기 전체 소요 시간이고 달려도 바뀌지 않는다`() {
        val t = FakeTrip(route, 10_000, DEPARTED)
        assertEquals(DEPARTED + route.duration, t.arrivalAt)
        t.advance(5_000, true)
        assertEquals(DEPARTED + route.duration, t.arrivalAt)
        t.seek(0.9)
        assertEquals(DEPARTED + route.duration, t.arrivalAt)
        // 남은 시간은 줄어든다
        assertTrue(t.remainingDuration < route.duration)
    }

    @Test fun `trip 주입 소요 시간을 주면 도착 예정은 그 값으로 정해진다`() {
        val t = FakeTrip(route, 4_500, DEPARTED, Duration.ofSeconds(12_000))
        assertEquals(DEPARTED + Duration.ofSeconds(12_000), t.arrivalAt)
        t.seek(0.5)
        assertEquals(DEPARTED + Duration.ofSeconds(12_000), t.arrivalAt)
        assertEquals(Duration.ofSeconds(6_000), t.remainingDuration)
    }
}
