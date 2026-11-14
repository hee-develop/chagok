package com.chagok.car.fakenavi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

class MapCameraTest {
    private fun camera(w: Float = 800f, h: Float = 600f, scale: Float = 2f) = MapCamera().apply { setScreen(w, h, scale) }

    private fun screen(c: MapCamera, x: Float, y: Float) = FloatArray(2).also { c.toScreen(x, y, it) }

    @Test fun `차의 세계 위치는 늘 화면 중앙이다`() {
        val c = camera()
        for (heading in listOf(0f, 37f, 90f, 181f, 359f)) {
            c.follow(812f, 345f, heading)
            val p = screen(c, 812f, 345f)
            assertEquals(400f, p[0], 1e-3f)
            assertEquals(300f, p[1], 1e-3f)
        }
    }

    @Test fun `진행 방향 앞의 점은 화면 위에 온다`() {
        val c = camera()
        // 동쪽(90도)으로 가는 차: 동쪽 10 앞은 중앙에서 위로 scale*10
        c.follow(100f, 100f, 90f)
        val east = screen(c, 110f, 100f)
        assertEquals(400f, east[0], 1e-3f)
        assertEquals(300f - 20f, east[1], 1e-3f)
        // 북쪽(0도)으로 가는 차: 세계의 위(y 작은 쪽)가 화면 위
        c.follow(100f, 100f, 0f)
        val north = screen(c, 100f, 90f)
        assertEquals(400f, north[0], 1e-3f)
        assertEquals(280f, north[1], 1e-3f)
        // 남쪽(180도)으로 가는 차: 세계의 아래가 화면 위
        c.follow(100f, 100f, 180f)
        val south = screen(c, 100f, 110f)
        assertEquals(400f, south[0], 1e-3f)
        assertEquals(280f, south[1], 1e-3f)
    }

    @Test fun `진행 방향의 오른쪽 점은 화면 오른쪽에 온다`() {
        val c = camera()
        // 동쪽으로 가는 차의 오른쪽은 남쪽(세계 y 증가)
        c.follow(100f, 100f, 90f)
        val right = screen(c, 100f, 110f)
        assertEquals(420f, right[0], 1e-3f)
        assertEquals(300f, right[1], 1e-3f)
    }

    @Test fun `회전해도 중심에서의 거리는 배율만큼이다`() {
        val c = camera(scale = 1.5f)
        for (heading in listOf(0f, 33f, 120f, 270f)) {
            c.follow(0f, 0f, heading)
            val p = screen(c, 30f, -40f)
            assertEquals(50f * 1.5f, hypot(p[0] - 400f, p[1] - 300f), 1e-2f)
        }
    }

    @Test fun `화면 모서리까지 거리가 보이는 반지름이다`() {
        val c = camera(w = 1682f, h = 1210f, scale = 2f)
        assertEquals(hypot(1682f, 1210f) / 4f, c.visibleRadius(), 1e-3f)
    }

    @Test fun `배율은 기본 확대이고 아주 큰 창에서만 커진다`() {
        // 두 칸 창(1682×1210)과 한 칸 창(848×1210)에서 디자인 px 1이 약 1.05배일 때
        assertEquals(2.1f, MapCamera.scaleFor(1682f, 1210f, 1.05f), 1e-4f)
        assertEquals(2.1f, MapCamera.scaleFor(848f, 1210f, 1.05f), 1e-4f)
        // 모서리가 COVER_RADIUS를 넘게 보이는 창은 그만큼 확대한다
        val big = MapCamera.scaleFor(6000f, 4000f, 1f)
        assertTrue(big > 2f)
        assertEquals(MapRoads.COVER_RADIUS, hypot(6000f, 4000f) / 2f / big, 1e-3f)
    }

    @Test fun `어떤 화면에서도 보이는 반지름이 덮는 반지름을 넘지 않는다`() {
        for ((w, h, density) in listOf(Triple(1682f, 1210f, 1.05f), Triple(848f, 1210f, 1.05f), Triple(3000f, 2000f, 1f), Triple(400f, 300f, 0.5f))) {
            val c = MapCamera().apply { setScreen(w, h, MapCamera.scaleFor(w, h, density)) }
            assertTrue("$w×$h", c.visibleRadius() <= MapRoads.COVER_RADIUS + 1e-3f)
        }
    }
}
