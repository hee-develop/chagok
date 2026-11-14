package com.chagok.car.fakenavi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MapRoadsTest {
    @Test fun `도로는 다섯 줄이고 시안의 굵기 순서다`() {
        assertEquals(listOf(22f, 16f, 14f, 12f, 10f), MapRoads.ALL.map { it.width })
    }

    @Test fun `큰 도로 셋 작은 도로 둘이고 둥근 끝은 첫 도로뿐이다`() {
        assertEquals(listOf(true, true, true, false, false), MapRoads.ALL.map { it.major })
        assertEquals(listOf(true, false, false, false, false), MapRoads.ALL.map { it.round })
    }

    @Test fun `도로는 화면을 가로지른다`() {
        // 시안 1600×640 좌표에서 양 끝이 화면 밖이거나 가장자리에 있다(화면을 가로지르는 길)
        for (road in MapRoads.ALL) {
            val c = road.coords
            val ends = listOf(c[0] to c[1], c[c.size - 2] to c[c.size - 1])
            assertTrue(
                ends.toString(),
                ends.all { (x, y) -> x <= 0f || x >= MapRoads.DESIGN_W || y <= 0f || y >= MapRoads.DESIGN_H },
            )
        }
    }

    @Test fun `도로 좌표는 모두 시안 화면 둘레 안에 있다`() {
        for (road in MapRoads.ALL) {
            var i = 0
            while (i < road.coords.size) {
                assertTrue("${road.coords[i]}", road.coords[i] in -100f..MapRoads.DESIGN_W + 100f)
                assertTrue("${road.coords[i + 1]}", road.coords[i + 1] in -100f..MapRoads.DESIGN_H + 100f)
                i += 2
            }
        }
    }
}
