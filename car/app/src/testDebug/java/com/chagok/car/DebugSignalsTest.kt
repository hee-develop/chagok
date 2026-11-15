package com.chagok.car

import com.chagok.car.domain.EnergyKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** 신호 값 검증: 범위를 벗어난 advance는 예외로 거부한다(SignalInjectActivity가 잡아 경고만 남기고 이어서 적용하지 않는다). */
class DebugSignalsTest {
    @Test fun `advance는 1분에서 7일까지 받는다`() {
        assertEquals(1L, DebugSignals.advanceOf("1"))
        assertEquals(250L, DebugSignals.advanceOf("250"))
        assertEquals(10_080L, DebugSignals.advanceOf("10080"))
    }

    @Test fun `advance는 범위를 벗어나거나 숫자가 아니면 거부한다`() {
        for (bad in listOf("0", "-5", "10081", "99999999", "abc", "1.5", "")) {
            assertThrows("advance=$bad", IllegalArgumentException::class.java) { DebugSignals.advanceOf(bad) }
        }
    }

    @Test fun `fuel은 ev gas diesel hybrid이고 real이면 주입을 푼다`() {
        assertEquals(EnergyKind.EV, DebugSignals.fuelOf("ev"))
        assertEquals(EnergyKind.GASOLINE, DebugSignals.fuelOf("GAS"))
        assertEquals(EnergyKind.DIESEL, DebugSignals.fuelOf("diesel"))
        assertEquals(EnergyKind.HYBRID, DebugSignals.fuelOf("hybrid"))
        assertNull(DebugSignals.fuelOf("real"))
        assertThrows(IllegalStateException::class.java) { DebugSignals.fuelOf("lpg") }
    }

    @Test fun `range는 0 이상의 km만 받고 real이면 주입을 푼다`() {
        assertEquals(150.0, DebugSignals.rangeOf("150")!!, 0.0)
        assertEquals(0.0, DebugSignals.rangeOf("0")!!, 0.0)
        assertEquals(12.5, DebugSignals.rangeOf("12.5")!!, 0.0)
        assertNull(DebugSignals.rangeOf("real"))
        for (bad in listOf("-1", "abc", "", "NaN", "Infinity")) {
            assertThrows("range=$bad", IllegalArgumentException::class.java) { DebugSignals.rangeOf(bad) }
        }
    }

    @Test fun `battery는 0에서 100 사이만 받고 real이면 주입을 푼다`() {
        assertEquals(45.0, DebugSignals.batteryOf("45")!!, 0.0)
        assertEquals(0.0, DebugSignals.batteryOf("0")!!, 0.0)
        assertEquals(100.0, DebugSignals.batteryOf("100")!!, 0.0)
        assertEquals(12.5, DebugSignals.batteryOf("12.5")!!, 0.0)
        assertNull(DebugSignals.batteryOf("real"))
        for (bad in listOf("-1", "101", "abc", "", "NaN", "Infinity")) {
            assertThrows("battery=$bad", IllegalArgumentException::class.java) { DebugSignals.batteryOf(bad) }
        }
    }
}
