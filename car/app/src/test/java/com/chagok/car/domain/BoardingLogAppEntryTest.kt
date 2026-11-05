package com.chagok.car.domain

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardingLogAppEntryTest {
    private val now = at("09:00")

    @Test fun `그날 탑승 기록이 없으면 앱 진입을 탑승으로 인정`() {
        assertTrue(BoardingLog().acceptsAppEntry(now, SEOUL))
        assertTrue(BoardingLog(lastBoardedOn = TODAY.minusDays(1)).acceptsAppEntry(now, SEOUL))
    }

    @Test fun `탑승한 뒤 주행 없이 다시 들어오면 인정하지 않음`() {
        assertFalse(BoardingLog().boarded(now, SEOUL).acceptsAppEntry(now, SEOUL))
    }

    @Test fun `탑승한 뒤 주행하고 P단에 넣었으면 인정`() {
        val log = BoardingLog().boarded(now, SEOUL).parked(at("09:30"))
        assertTrue(log.acceptsAppEntry(at("10:00"), SEOUL))
        // 다시 탑승하면 플래그가 지워진다.
        assertFalse(log.boarded(at("10:00"), SEOUL).acceptsAppEntry(at("10:05"), SEOUL))
    }
}
