package com.chagok.car.fakenavi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HeadingFollowerTest {
    @Test fun `최단 회전량은 0도 경계를 넘어 계산한다`() {
        assertEquals(20f, Angles.shortestDelta(350f, 10f), 1e-4f)
        assertEquals(-20f, Angles.shortestDelta(10f, 350f), 1e-4f)
        assertEquals(90f, Angles.shortestDelta(0f, 90f), 1e-4f)
        assertEquals(180f, Angles.shortestDelta(0f, 180f), 1e-4f)
        assertEquals(0f, Angles.shortestDelta(45f, 405f), 1e-4f)
    }

    @Test fun `각도는 0에서 360 사이로 맞춘다`() {
        assertEquals(350f, Angles.normalize(-10f), 1e-4f)
        assertEquals(10f, Angles.normalize(370f), 1e-4f)
        assertEquals(20f, Angles.distance(350f, 10f), 1e-4f)
    }

    @Test fun `처음 부르면 목표로 바로 맞춘다`() {
        val f = HeadingFollower()
        assertEquals(123f, f.update(123f, 1_000L), 1e-4f)
    }

    @Test fun `꺾이는 곳에서 목표가 90도 바뀌어도 한 번에 튀지 않고 최단 방향으로 다가간다`() {
        val f = HeadingFollower(200f)
        f.snap(350f, 0L)
        // 목표가 350 → 80 (시계 방향 90도). 33ms 뒤에는 조금만 돌았다.
        val a = f.update(80f, 33L)
        val turned = Angles.shortestDelta(350f, a)
        assertTrue("$a", turned > 0f && turned < 30f)
        // 반대편(시계 반대 270도)으로 돌지 않는다
        assertTrue(Angles.shortestDelta(350f, a) > 0f)
    }

    @Test fun `틱 간격과 상관없이 같은 시간이면 같은 각도다`() {
        val coarse = HeadingFollower(200f).apply { snap(0f, 0L) }
        val fine = HeadingFollower(200f).apply { snap(0f, 0L) }
        val a = coarse.update(90f, 300L)
        var b = 0f
        for (t in 1..300 step 1) b = fine.update(90f, t.toLong())
        assertEquals(a, b, 0.2f)
    }

    @Test fun `시간 상수만큼 지나면 3분의 2쯤 따라간다`() {
        val f = HeadingFollower(200f).apply { snap(0f, 0L) }
        assertEquals(90f * (1f - Math.exp(-1.0).toFloat()), f.update(90f, 200L), 1e-2f)
    }

    @Test fun `시간이 흐르지 않으면 움직이지 않는다`() {
        val f = HeadingFollower(200f).apply { snap(10f, 500L) }
        assertEquals(10f, f.update(100f, 500L), 1e-4f)
    }

    @Test fun `정차 중에도 목표에 닿으면 멈춘다`() {
        val f = HeadingFollower(200f).apply { snap(0f, 0L) }
        var t = 0L
        var frames = 0
        while (!f.isSettled(180f) && frames < 10_000) {
            t += 16
            f.update(180f, t)
            frames++
        }
        assertTrue(f.isSettled(180f))
        // 16ms 프레임으로 6초 안에는 닿는다(끝없이 돌지 않는다)
        assertTrue("프레임 $frames", t < 6_000L)
        assertEquals(180f, f.angle, 0f)
    }

    @Test fun `목표에 닿은 뒤에는 정착 상태가 유지된다`() {
        val f = HeadingFollower().apply { snap(45f, 0L) }
        assertTrue(f.isSettled(45f))
        f.update(45f, 100L)
        assertTrue(f.isSettled(45f))
        assertFalse(f.isSettled(46f))
    }
}
