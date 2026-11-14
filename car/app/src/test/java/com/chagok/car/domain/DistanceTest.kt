package com.chagok.car.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DistanceTest {
    private val stadium = LatLng(35.1681, 126.8888) // 광주-기아 챔피언스필드

    @Test fun `같은 점은 0m`() {
        assertEquals(0.0, stadium.distanceTo(stadium), 0.001)
    }

    @Test fun `위도 0_001도는 약 111m이고 방향과 무관하다`() {
        val north = LatLng(stadium.lat + 0.001, stadium.lng)
        assertEquals(111.2, stadium.distanceTo(north), 0.5)
        assertEquals(stadium.distanceTo(north), north.distanceTo(stadium), 0.001)
    }

    @Test fun `도착 판정 300m 경계`() {
        assertTrue(stadium.distanceTo(LatLng(stadium.lat + 0.0026, stadium.lng)) <= Rules.ARRIVAL_RADIUS_METERS) // 약 289m
        assertTrue(stadium.distanceTo(LatLng(stadium.lat + 0.0028, stadium.lng)) > Rules.ARRIVAL_RADIUS_METERS) // 약 311m
    }

    @Test fun `광주 육전집과 챔피언스필드는 약 3_5km`() {
        assertEquals(3_500.0, LatLng(35.1595, 126.8526).distanceTo(stadium), 150.0)
    }
}
