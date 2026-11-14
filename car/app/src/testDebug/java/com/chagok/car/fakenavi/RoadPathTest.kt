package com.chagok.car.fakenavi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class RoadPathTest {
    /** (0,0) → (100,0) → (100,-100) → (200,-100). 화면 좌표라 y가 줄면 위로 간다. */
    private val path = RoadPath(floatArrayOf(0f, 0f, 100f, 0f, 100f, -100f, 200f, -100f))

    private fun near(expected: Float, actual: Float, eps: Float = 0.01f) = assertTrue("$expected vs $actual", abs(expected - actual) <= eps)

    @Test fun `길이는 선분 길이의 합이다`() {
        near(300f, path.length)
        assertEquals(3, path.segmentCount)
    }

    @Test fun `진행 비율로 위치를 구하고 범위를 넘으면 양 끝으로 맞춘다`() {
        val mid = path.poseAt(0.5f)
        near(100f, mid.x); near(-50f, mid.y)
        val start = path.poseAt(-1f)
        near(0f, start.x); near(0f, start.y)
        val end = path.poseAt(2f)
        near(200f, end.x); near(-100f, end.y)
        near(50f, path.poseAt(1f / 6).x)
    }

    @Test fun `방향은 그 자리 선분 방향이다 위가 0도 시계 방향`() {
        near(90f, path.poseAt(0.1f).angleDeg)   // 오른쪽
        near(0f, path.poseAt(0.5f).angleDeg)    // 위
        near(90f, path.poseAt(0.9f).angleDeg)
        near(180f, RoadPath(floatArrayOf(0f, 0f, 0f, 100f)).poseAt(0.5f).angleDeg)  // 아래
        near(270f, RoadPath(floatArrayOf(100f, 0f, 0f, 0f)).poseAt(0.5f).angleDeg)  // 왼쪽
    }

    @Test fun `남은 경로는 현재 위치로 시작해 끝점으로 끝난다`() {
        val buf = FloatArray(path.aheadCapacity)
        val n = path.ahead(0.5f, buf)
        near(100f, buf[0]); near(-50f, buf[1])
        near(100f, buf[2]); near(-100f, buf[3])
        near(200f, buf[n - 2]); near(-100f, buf[n - 1])
        assertEquals(3, n / 2)
        // 출발점에서는 현재 위치(출발점) + 이후 점 셋
        assertEquals(2 * 4, path.ahead(0f, buf))
    }

    @Test fun `지나온 점은 남은 경로에 없다`() {
        val buf = FloatArray(path.aheadCapacity)
        val n = path.ahead(0.8f, buf)
        var i = 0
        while (i < n) { assertTrue("x=${buf[i]}", buf[i] >= 100f - 0.01f); i += 2 }
    }

    @Test fun `점이 없거나 하나여도 깨지지 않는다`() {
        val empty = RoadPath(FloatArray(0))
        assertEquals(0, empty.segmentCount)
        assertEquals(0, empty.ahead(0.5f, FloatArray(empty.aheadCapacity)))
        val p0 = empty.poseAt(0.5f)
        assertEquals(0f, p0.x, 0f)
        val one = RoadPath(floatArrayOf(5f, 6f))
        near(5f, one.poseAt(0.7f).x); near(6f, one.poseAt(0.7f).y)
        assertEquals(2, one.ahead(0f, FloatArray(one.aheadCapacity)))
    }

    @Test fun `길이 0인 선분은 방향을 직전 선분에서 이어받는다`() {
        // 오른쪽으로 가다(90도) 같은 점이 겹치고 다시 오른쪽
        val p = RoadPath(floatArrayOf(0f, 0f, 100f, 0f, 100f, 0f, 200f, 0f))
        near(90f, p.poseAt(0.5f).angleDeg)
        near(90f, p.poseAt(0.9f).angleDeg)
        // 맨 앞이 겹친 점이면 처음으로 방향이 있는 선분의 방향
        val lead = RoadPath(floatArrayOf(0f, 0f, 0f, 0f, 0f, 100f))
        near(180f, lead.poseAt(0f).angleDeg)
    }

    @Test fun `모든 점이 같으면 방향 0도와 길이 0이다`() {
        val same = RoadPath(floatArrayOf(5f, 6f, 5f, 6f))
        near(0f, same.length)
        assertEquals(0f, same.poseAt(0.5f).angleDeg, 0f)
        near(5f, same.poseAt(0.5f).x)
    }
}
