package com.chagok.car.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 에너지 체크의 순수 계산: 필요 거리(정책서 9장), 90% 경계, 연료 종류 판별. */
class EnergyTest {
    // 적도 위 경도 1도 = 지구 반지름 6,371km 공 위 약 111.195km. 거리 계산을 손으로 맞추기 쉽게 한 줄(적도) 위에 점을 둔다.
    private fun p(lng: Double) = LatLng(0.0, lng)
    private val km1deg = 6371.0 * Math.PI / 180.0

    @Test fun `필요 거리는 지금 위치에서 일정 장소들을 차례로 지나 집까지 직선거리 합에 1_3을 곱한다`() {
        // 0도(지금) → 1도(일정 A) → 3도(일정 B) → 6도(집): 직선 6도
        val need = EnergyNeed.of(here = p(0.0), stops = listOf(p(1.0), p(3.0)), home = p(6.0))!!
        assertEquals(6 * km1deg * 1.3, need.km, 0.01)
        assertEquals(EnergyGoal.HOME, need.goal)
        assertEquals(867, need.spokenKm)
    }

    @Test fun `일정 순서가 직선으로 되돌아가면 되돌아가는 거리도 센다`() {
        // 0 → 4도 → 1도 → 집 0도: 4 + 3 + 1 = 8도
        val need = EnergyNeed.of(here = p(0.0), stops = listOf(p(4.0), p(1.0)), home = p(0.0))!!
        assertEquals(8 * km1deg * 1.3, need.km, 0.01)
    }

    @Test fun `지금 위치를 모르면 첫 구간은 빼고 센다`() {
        val need = EnergyNeed.of(here = null, stops = listOf(p(1.0), p(3.0)), home = p(6.0))!!
        assertEquals(5 * km1deg * 1.3, need.km, 0.01)
    }

    @Test fun `집이 없으면 마지막 일정까지만 세고 끝은 오늘 일정이다`() {
        val need = EnergyNeed.of(here = p(0.0), stops = listOf(p(1.0), p(3.0)), home = null)!!
        assertEquals(3 * km1deg * 1.3, need.km, 0.01)
        assertEquals(EnergyGoal.LAST_SCHEDULE, need.goal)
    }

    @Test fun `일정이 없어도 지금 위치에서 집까지는 센다`() {
        val need = EnergyNeed.of(here = p(0.0), stops = emptyList(), home = p(2.0))!!
        assertEquals(2 * km1deg * 1.3, need.km, 0.01)
    }

    @Test fun `셀 구간이 없으면 판단하지 않는다`() {
        assertNull(EnergyNeed.of(here = null, stops = listOf(p(1.0)), home = null))
        assertNull(EnergyNeed.of(here = p(0.0), stops = emptyList(), home = null))
        assertNull(EnergyNeed.of(here = null, stops = emptyList(), home = null))
    }

    @Test fun `필요 거리가 주행 가능 거리의 90퍼센트를 넘어야 모자라다`() {
        assertFalse(EnergyNeed(89.9, EnergyGoal.HOME).isShort(100.0))
        assertFalse("정확히 90%는 모자라지 않다", EnergyNeed(90.0, EnergyGoal.HOME).isShort(100.0))
        assertTrue(EnergyNeed(90.1, EnergyGoal.HOME).isShort(100.0))
        assertTrue(EnergyNeed(1.0, EnergyGoal.HOME).isShort(0.0))
    }

    @Test fun `연료 종류를 INFO_FUEL_TYPE 목록으로 가른다`() {
        assertEquals(EnergyKind.EV, EnergyKind.fromFuelTypes(listOf(10)))
        assertEquals(EnergyKind.GASOLINE, EnergyKind.fromFuelTypes(listOf(1)))
        assertEquals(EnergyKind.GASOLINE, EnergyKind.fromFuelTypes(listOf(7)))
        assertEquals(EnergyKind.DIESEL, EnergyKind.fromFuelTypes(listOf(3)))
        assertEquals(EnergyKind.DIESEL, EnergyKind.fromFuelTypes(listOf(4)))
        assertEquals("전기와 휘발유가 함께면 하이브리드", EnergyKind.HYBRID, EnergyKind.fromFuelTypes(listOf(1, 10)))
        assertNull("수소는 충전소·주유소 후보가 없다", EnergyKind.fromFuelTypes(listOf(11)))
        assertNull(EnergyKind.fromFuelTypes(listOf(0)))
        assertNull(EnergyKind.fromFuelTypes(emptyList()))
        assertNotNull(EnergyKind.fromFuelTypes(listOf(0, 10)))
    }

    @Test fun `서버 fuel 이름과 전기 여부`() {
        assertEquals("ev", EnergyKind.EV.server)
        assertEquals("hybrid", EnergyKind.HYBRID.server)
        assertTrue(EnergyKind.EV.electric)
        assertFalse(EnergyKind.HYBRID.electric)
    }
}
