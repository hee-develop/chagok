package com.chagok.car.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 배터리·연료 잔량(%) 계산. 속성(Wh·ml)을 읽지 못하거나 용량이 0이면 모름이라 카드 타일은 % 없이 거리만 보인다. */
class EnergyAdapterTest {
    @Test fun `잔량을 용량으로 나눠 퍼센트로 반올림한다`() {
        assertEquals(45, EnergyAdapter.percentOf(36_000.0, 80_000.0))
        assertEquals(46, EnergyAdapter.percentOf(36_800.0, 80_000.0)) // 46.0
        assertEquals(0, EnergyAdapter.percentOf(0.0, 80_000.0))
        assertEquals(100, EnergyAdapter.percentOf(80_000.0, 80_000.0))
        // 용량보다 많이 읽혀도 100을 넘기지 않는다
        assertEquals(100, EnergyAdapter.percentOf(90_000.0, 80_000.0))
    }

    @Test fun `읽지 못했거나 용량이 0이면 모름이다`() {
        assertNull(EnergyAdapter.percentOf(null, 80_000.0))
        assertNull(EnergyAdapter.percentOf(36_000.0, null))
        assertNull(EnergyAdapter.percentOf(36_000.0, 0.0))
    }

    @Test fun `속성값은 음수와 숫자가 아닌 값을 모름으로 본다`() {
        assertEquals(36_000.0, EnergyAdapter.amountOf(36_000f)!!, 0.0)
        assertNull(EnergyAdapter.amountOf(-1f))
        assertNull(EnergyAdapter.amountOf(Float.NaN))
        assertNull(EnergyAdapter.amountOf("36000"))
        assertNull(EnergyAdapter.amountOf(null))
    }
}
