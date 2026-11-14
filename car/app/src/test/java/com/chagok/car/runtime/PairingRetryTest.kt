package com.chagok.car.runtime

import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Test

class PairingRetryTest {
    @Test
    fun 서버에_닿지_않으면_5초부터_두_배씩_늘려_60초에서_멈춘다() {
        val delays = (1..7).map { PairingController.retryDelay(it).seconds }
        assertEquals(listOf(5L, 10L, 20L, 40L, 60L, 60L, 60L), delays)
        assertEquals(Duration.ofSeconds(60), PairingController.retryDelay(100))
    }
}
