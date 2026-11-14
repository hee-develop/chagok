package com.chagok.car.fakenavi

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.hypot

class MapWorldTest {
    /** 도로 점열의 x·y 범위 */
    private fun extent(road: MapRoad): FloatArray {
        val pts = RoadRoutes.sample(road)
        var minX = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE; var minY = Float.MAX_VALUE; var maxY = -Float.MAX_VALUE
        for (i in pts.indices step 2) {
            minX = minOf(minX, pts[i]); maxX = maxOf(maxX, pts[i])
            minY = minOf(minY, pts[i + 1]); maxY = maxOf(maxY, pts[i + 1])
        }
        return floatArrayOf(minX, maxX, minY, maxY)
    }

    @Test fun `기존 다섯 줄은 그대로이고 연장과 바깥 도로가 더해진다`() {
        assertEquals(5, MapRoads.ALL.size)
        assertEquals(10, MapRoads.EXTENSIONS.size)
        assertEquals(12, MapRoads.OUTER.size)
        assertEquals(27, MapRoads.WORLD.size)
        assertEquals(MapRoads.ALL, MapRoads.WORLD.take(5))
    }

    @Test fun `연장은 기존 도로의 끝에서 이어진다`() {
        for ((i, road) in MapRoads.ALL.withIndex()) {
            val c = road.coords
            val head = MapRoads.EXTENSIONS[2 * i].coords
            val tail = MapRoads.EXTENSIONS[2 * i + 1].coords
            assertEquals(c[0], head[head.size - 2], 1e-3f)
            assertEquals(c[1], head[head.size - 1], 1e-3f)
            assertEquals(c[c.size - 2], tail[0], 1e-3f)
            assertEquals(c[c.size - 1], tail[1], 1e-3f)
        }
    }

    @Test fun `바깥 가로길과 세로길은 세계 범위 끝에서 끝까지 이어진다`() {
        val ext = MapRoads.OUTER.map(::extent)
        val horizontals = ext.take(6)
        val verticals = ext.drop(6)
        for (e in horizontals) {
            assertTrue(e[0].toString(), e[0] <= MapRoads.WORLD_MIN_X)
            assertTrue(e[1].toString(), e[1] >= MapRoads.WORLD_MAX_X)
        }
        for (e in verticals) {
            assertTrue(e[2].toString(), e[2] <= MapRoads.WORLD_MIN_Y)
            assertTrue(e[3].toString(), e[3] >= MapRoads.WORLD_MAX_Y)
        }
    }

    @Test fun `시안 화면 바깥은 이웃 도로 간격이 300이라 넓게 비지 않는다`() {
        // 가로길은 y, 세로길은 x로 정렬한 이웃 간격. 시안 화면 안(시안 도로만 있는 구간)은 시안 그대로라 대상이 아니다.
        val ys = MapRoads.OUTER.take(6).map { it.coords[1] }.sorted()
        val xs = MapRoads.OUTER.drop(6).map { it.coords[0] }.sorted()
        for (list in listOf(ys, xs)) {
            for (k in 1 until list.size) if (list[k] - list[k - 1] < 600f) assertEquals("${list[k - 1]}→${list[k]}", 300f, list[k] - list[k - 1], 120f)
        }
        // 시안 화면 둘레의 첫 도로: 위·왼쪽은 -100, 아래는 740(시안 높이 640 + 100), 오른쪽은 1700(시안 폭 1600 + 100)
        // (시작점은 도로마다 ±60 흔들린다)
        listOf(-700f, -400f, -100f, 740f, 1040f, 1340f).forEachIndexed { i, y -> assertEquals(y, ys[i], 60f) }
        listOf(-700f, -400f, -100f, 1700f, 2000f, 2300f).forEachIndexed { i, x -> assertEquals(x, xs[i], 60f) }
    }

    @Test fun `모든 변형 경로의 어느 지점에서도 보이는 원이 도로 세계 안이다`() {
        for (variant in RoadRoutes.VARIANTS.indices) {
            val xy = RoadRoutes.build(variant)
            for (i in xy.indices step 2) {
                // 경로는 시안 화면에서 선분 한두 개 넘게 벗어나지 않는다
                assertTrue("${xy[i]}", xy[i] in -MapRoads.ROUTE_SLACK..MapRoads.DESIGN_W + MapRoads.ROUTE_SLACK)
                assertTrue("${xy[i + 1]}", xy[i + 1] in -MapRoads.ROUTE_SLACK..MapRoads.DESIGN_H + MapRoads.ROUTE_SLACK)
                // 반지름 COVER_RADIUS인 원(어떤 회전에서도 화면은 그 안)이 세계 범위 안
                assertTrue(xy[i] - MapRoads.COVER_RADIUS >= MapRoads.WORLD_MIN_X)
                assertTrue(xy[i] + MapRoads.COVER_RADIUS <= MapRoads.WORLD_MAX_X)
                assertTrue(xy[i + 1] - MapRoads.COVER_RADIUS >= MapRoads.WORLD_MIN_Y)
                assertTrue(xy[i + 1] + MapRoads.COVER_RADIUS <= MapRoads.WORLD_MAX_Y)
            }
        }
    }

    @Test fun `경로 길이가 화면 한 장보다 길어 지도가 움직인다`() {
        // 두 칸 창에서 화면 한 변의 세계 길이는 디자인 폭 약 1600 ÷ ZOOM
        val screenWorld = 1600f / MapCamera.ZOOM
        for (variant in RoadRoutes.VARIANTS.indices) {
            val len = RoadPath(RoadRoutes.build(variant)).length
            assertTrue("변형 $variant 길이 $len", len / screenWorld >= 1.2f)
        }
    }

    @Test fun `경로 위 모든 지점에서 경로 방향과 각도 목표가 이어진다`() {
        // 카메라 목표 각도(그 자리 선분 방향)는 0~360 안이다
        for (variant in RoadRoutes.VARIANTS.indices) {
            val path = RoadPath(RoadRoutes.build(variant))
            for (k in 0..100) assertTrue(path.poseAt(k / 100f).angleDeg in 0f..360f)
        }
    }

    @Test fun `경로가 시작되면 첫 구간 방향이 위가 된다`() {
        // 첫 구간 방향 각도가 카메라 각도라면 첫 구간 앞의 점은 화면 중앙 바로 위다
        val path = RoadPath(RoadRoutes.build(0))
        val start = path.poseAt(0f)
        val ahead = path.poseAt(0.02f)
        val cam = MapCamera().apply {
            setScreen(800f, 600f, 2f)
            follow(start.x, start.y, start.angleDeg)
        }
        val out = FloatArray(2)
        cam.toScreen(ahead.x, ahead.y, out)
        assertTrue("x=${out[0]}", abs(out[0] - 400f) < 20f)
        assertTrue("y=${out[1]}", out[1] < 300f)
        assertTrue(hypot(out[0] - 400f, out[1] - 300f) > 0f)
    }

    @Test fun `목적지 핀 몸통은 차 마커와 겹쳐도 위로 드러난다`() {
        assertTrue("여유 ${DestinationPin.CLEARANCE}", DestinationPin.CLEARANCE > 0f)
        assertTrue(DestinationPin.DOT_RADIUS < DestinationPin.HEAD_RADIUS)
        // 핀 끝(목적지 점)에서 몸통 원 중심은 위쪽(화면 y 음수 방향)에 있다
        assertTrue(DestinationPin.HEAD_CENTER > DestinationPin.HEAD_RADIUS)
    }

    @Test fun `경로 끝이 목적지 핀 위치다`() {
        val place = Place("광주 육전집", LatLng(35.1595, 126.8526))
        assertTrue(FakeRoute.to(place).lengthMeters > 0.0)
        val path = RoadPath(RoadRoutes.build(1))
        val end = path.poseAt(1f)
        val cam = MapCamera().apply {
            setScreen(800f, 600f, 2f)
            follow(end.x, end.y, end.angleDeg)
        }
        val out = FloatArray(2)
        cam.toScreen(end.x, end.y, out)
        assertEquals(400f, out[0], 1e-3f)
        assertEquals(300f, out[1], 1e-3f)
    }
}
