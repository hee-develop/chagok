package com.chagok.car

import org.junit.Assert.assertEquals
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
}
