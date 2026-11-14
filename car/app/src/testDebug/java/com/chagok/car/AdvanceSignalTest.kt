package com.chagok.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** debug 신호 `advance=<분>`의 값 해석(1~7일). debug 소스 세트에만 있어 testDebug에서만 돈다. */
class AdvanceSignalTest {
    @Test fun `1분부터 7일까지의 분 단위를 받는다`() {
        assertEquals(1L, DebugSignals.advanceOf("1"))
        assertEquals(390L, DebugSignals.advanceOf("390"))
        assertEquals(DebugSignals.MAX_ADVANCE_MINUTES, DebugSignals.advanceOf("10080"))
    }

    @Test fun `0·음수·7일 초과·숫자가 아닌 값은 거부한다`() {
        assertThrows(IllegalArgumentException::class.java) { DebugSignals.advanceOf("0") }
        assertThrows(IllegalArgumentException::class.java) { DebugSignals.advanceOf("-5") }
        assertThrows(IllegalArgumentException::class.java) { DebugSignals.advanceOf("10081") }
        assertThrows(NumberFormatException::class.java) { DebugSignals.advanceOf("abc") }
    }
}
