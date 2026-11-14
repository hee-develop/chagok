package com.chagok.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** debug 신호 `exitcard=<초>|real`의 값 해석. debug 소스 세트에만 있어 testDebug에서만 돈다. */
class ExitCardSignalTest {
    @Test fun `양수 초는 그 값이고 real은 null이다`() {
        assertEquals(30L, DebugSignals.exitCardOf("30"))
        assertEquals(1L, DebugSignals.exitCardOf("1"))
        assertNull(DebugSignals.exitCardOf("real"))
        assertNull(DebugSignals.exitCardOf("REAL"))
    }

    @Test fun `0·음수·숫자가 아닌 값은 거부한다`() {
        assertThrows(IllegalArgumentException::class.java) { DebugSignals.exitCardOf("0") }
        assertThrows(IllegalArgumentException::class.java) { DebugSignals.exitCardOf("-5") }
        assertThrows(NumberFormatException::class.java) { DebugSignals.exitCardOf("abc") }
        assertThrows(NumberFormatException::class.java) { DebugSignals.exitCardOf("1.5") }
    }
}
