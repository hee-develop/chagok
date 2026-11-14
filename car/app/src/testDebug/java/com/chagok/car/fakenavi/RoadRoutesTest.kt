package com.chagok.car.fakenavi

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

class RoadRoutesTest {
    private val roads = MapRoads.ALL.map { RoadRoutes.sample(it) }

    /** 점 (x, y)에서 가장 가까운 도로 선분까지의 거리(시안 px) */
    private fun distToRoads(x: Float, y: Float): Float {
        var best = Float.MAX_VALUE
        for (r in roads) {
            for (j in 0 until r.size / 2 - 1) {
                val ax = r[2 * j]; val ay = r[2 * j + 1]
                val bx = r[2 * j + 2]; val by = r[2 * j + 3]
                val dx = bx - ax; val dy = by - ay
                val len2 = dx * dx + dy * dy
                val t = if (len2 == 0f) 0f else (((x - ax) * dx + (y - ay) * dy) / len2).coerceIn(0f, 1f)
                best = min(best, hypot(x - (ax + dx * t), y - (ay + dy * t)))
            }
        }
        return best
    }

    @Test fun `경로는 변형마다 정해져 있고 같은 번호면 같다`() {
        for (v in RoadRoutes.VARIANTS.indices) assertArrayEquals(RoadRoutes.build(v), RoadRoutes.build(v), 0f)
        // 범위를 넘는 번호는 나머지로 쓴다
        assertArrayEquals(RoadRoutes.build(1), RoadRoutes.build(1 + RoadRoutes.VARIANTS.size), 0f)
        assertArrayEquals(RoadRoutes.build(2), RoadRoutes.build(-1), 0f)
    }

    @Test fun `경로의 모든 점이 도로 곡선 위에 있다`() {
        for (v in RoadRoutes.VARIANTS.indices) {
            val pts = RoadRoutes.build(v)
            var i = 0
            while (i < pts.size) {
                assertTrue("변형 $v 점 ${i / 2}: ${distToRoads(pts[i], pts[i + 1])}", distToRoads(pts[i], pts[i + 1]) < 0.5f)
                i += 2
            }
        }
    }

    @Test fun `경로는 시안 화면 안에 있고 충분히 길다`() {
        for (v in RoadRoutes.VARIANTS.indices) {
            val pts = RoadRoutes.build(v)
            var length = 0f
            var i = 0
            while (i < pts.size) {
                assertTrue("x=${pts[i]}", pts[i] in 0f..MapRoads.DESIGN_W)
                assertTrue("y=${pts[i + 1]}", pts[i + 1] in 0f..MapRoads.DESIGN_H)
                if (i >= 2) length += hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
                i += 2
            }
            assertTrue("변형 $v 길이 $length", length > 500f)
        }
    }

    @Test fun `경로는 도로를 갈아타며 방향이 바뀐다`() {
        // 갈아탄 곳에서는 접선이 꺾인다: 한 변형도 일자(처음과 끝을 잇는 직선)에 가깝지 않다
        for (v in RoadRoutes.VARIANTS.indices) {
            val pts = RoadRoutes.build(v)
            val n = pts.size / 2
            val sx = pts[0]; val sy = pts[1]
            val ex = pts[2 * n - 2]; val ey = pts[2 * n - 1]
            var maxOff = 0f
            val len = hypot(ex - sx, ey - sy)
            for (k in 0 until n) {
                val off = kotlin.math.abs((ex - sx) * (sy - pts[2 * k + 1]) - (sx - pts[2 * k]) * (ey - sy)) / len
                maxOff = max(maxOff, off)
            }
            assertTrue("변형 $v: $maxOff", maxOff > 30f)
        }
    }

    @Test fun `경로는 지나는 도로가 둘 이상이다`() {
        // 점열의 시작 근처와 끝 근처가 서로 다른 도로 위에 있다(갈아탔다)
        for (v in RoadRoutes.VARIANTS.indices) {
            val pts = RoadRoutes.build(v)
            fun nearestRoad(x: Float, y: Float): Int = roads.indices.minByOrNull { r ->
                val ro = roads[r]
                (0 until ro.size / 2).minOf { hypot(x - ro[2 * it], y - ro[2 * it + 1]) }
            }!!
            val first = nearestRoad(pts[0], pts[1])
            val last = nearestRoad(pts[pts.size - 2], pts[pts.size - 1])
            assertTrue("변형 $v: $first $last", first != last)
        }
    }

    @Test fun `도로 점열은 첫 점이 도로 시작점이고 끝점이 도로 끝점이다`() {
        for ((i, road) in MapRoads.ALL.withIndex()) {
            val s = roads[i]
            assertEquals(road.coords[0], s[0], 1e-4f)
            assertEquals(road.coords[road.coords.size - 2], s[s.size - 2], 1e-3f)
            assertEquals(2 * (1 + RoadRoutes.SAMPLES * road.segmentCount), s.size)
        }
    }
}
