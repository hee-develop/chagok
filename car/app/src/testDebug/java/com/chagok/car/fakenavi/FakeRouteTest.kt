package com.chagok.car.fakenavi

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeRouteTest {
    private val yukjeon = Place("광주 육전집", LatLng(35.1595, 126.8526))
    private val stadium = Place("광주-기아 챔피언스필드", LatLng(35.1681, 126.8888))
    private val kongmul = Place("단골 콩물집", LatLng(35.146, 126.922))

    @Test fun `위도 1도는 약 111km다`() {
        assertEquals(111_195.0, Geo.haversineMeters(LatLng(35.0, 127.0), LatLng(36.0, 127.0)), 200.0)
    }

    @Test fun `같은 입력이면 같은 경로다`() {
        assertEquals(FakeRoute.to(yukjeon).points, FakeRoute.to(yukjeon).points)
    }

    @Test fun `출발점에서 시작해 목적지에서 끝난다`() {
        for (p in listOf(yukjeon, stadium, kongmul)) {
            val r = FakeRoute.to(p)
            assertEquals(FakeRoute.ORIGIN.position, r.points.first())
            assertEquals(p.position, r.points.last())
        }
    }

    @Test fun `꺾이는 곳은 3에서 5번이다`() {
        for (p in listOf(yukjeon, stadium, kongmul)) {
            assertTrue("${p.name} ${FakeRoute.to(p).bendCount}", FakeRoute.to(p).bendCount in 3..5)
        }
    }

    @Test fun `길이는 직선거리 이상이고 계단 경로라 두 배는 넘지 않는다`() {
        for (p in listOf(yukjeon, stadium, kongmul)) {
            val straight = Geo.haversineMeters(FakeRoute.ORIGIN.position, p.position)
            val len = FakeRoute.to(p).lengthMeters
            assertTrue("$len vs $straight", len >= straight - 1.0 && len <= straight * 2.0)
        }
    }

    @Test fun `소요 시간은 길이를 시속으로 나눈 값이다`() {
        val r = FakeRoute.to(yukjeon)
        val expected = r.lengthMeters / (FakeRoute.SPEED_KMH / 3.6)
        assertEquals(expected, r.duration.toMillis() / 1000.0, 1.0)
    }

    @Test fun `출발점과 같은 목적지도 깨지지 않는다`() {
        val r = FakeRoute.to(Place("여기", FakeRoute.ORIGIN.position))
        assertEquals(0.0, r.lengthMeters, 0.001)
        assertEquals(FakeRoute.ORIGIN.position, r.pointAt(10.0).position)
    }

    @Test fun `진행 거리에서 위치를 구하고 범위를 벗어나면 양 끝으로 맞춘다`() {
        val r = FakeRoute.to(yukjeon)
        assertEquals(r.points.first(), r.pointAt(-5.0).position)
        val end = r.pointAt(r.lengthMeters + 100).position
        assertEquals(yukjeon.position.lat, end.lat, 1e-9)
        assertEquals(yukjeon.position.lng, end.lng, 1e-9)
        // 중간 지점은 출발점으로부터의 직선거리가 길이보다 길지 않다
        val mid = r.pointAt(r.lengthMeters / 2).position
        assertTrue(Geo.haversineMeters(r.points.first(), mid) <= r.lengthMeters / 2 + 1.0)
    }

    @Test fun `방향은 구간의 방위이고 계단 경로는 90도씩 꺾인다`() {
        val r = FakeRoute.to(stadium)
        val bearings = listOf(0.0, 0.25, 0.5, 0.75, 0.99).map { r.pointAt(r.lengthMeters * it).bearing }
        // 동서남북 중 하나(구간이 가로·세로뿐)
        for (b in bearings) assertTrue("$b", listOf(0.0, 90.0, 180.0, 270.0).any { kotlin.math.abs(Geo.turnAngle(it, b)) < 1.0 })
    }

    @Test fun `방위 차이의 부호는 시계 방향이 우회전이다`() {
        assertEquals(90.0, Geo.turnAngle(0.0, 90.0), 1e-9)
        assertEquals(-90.0, Geo.turnAngle(0.0, 270.0), 1e-9)
        assertEquals(90.0, Geo.turnAngle(350.0, 80.0), 1e-9)
    }
}
