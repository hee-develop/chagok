package com.chagok.car.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MotionTest {
    @Test fun `기어 P와 N은 정차`() {
        assertEquals(Motion.STOPPED, Motion.of(Gear.PARK, false))
        assertEquals(Motion.STOPPED, Motion.of(Gear.NEUTRAL, false))
    }

    @Test fun `기어 D와 R은 주행`() {
        assertEquals(Motion.DRIVING, Motion.of(Gear.DRIVE, false))
        assertEquals(Motion.DRIVING, Motion.of(Gear.REVERSE, false))
    }

    @Test fun `기어와 주행 제한 알림이 다르면 주행`() {
        assertEquals(Motion.DRIVING, Motion.of(Gear.PARK, true))
    }

    @Test fun `기어를 모르면 판단 불가`() {
        assertEquals(Motion.UNKNOWN, Motion.of(Gear.UNKNOWN, false))
    }
}

class BoardingLogTest {
    @Test fun `P단 뒤 10분 안이면 잠깐 정차`() {
        val log = BoardingLog(lastBoardedOn = TODAY, lastParkedAt = at("09:00"))
        assertEquals(BoardingKind.QUICK_STOP, log.classify(at("09:09"), SEOUL))
    }

    @Test fun `P단 뒤 딱 10분이면 잠깐 정차가 아님`() {
        val log = BoardingLog(lastBoardedOn = TODAY, lastParkedAt = at("09:00"))
        assertEquals(BoardingKind.AGAIN, log.classify(at("09:10"), SEOUL))
    }

    @Test fun `그날 처음이면 첫 탑승`() {
        val log = BoardingLog(lastBoardedOn = TODAY.minusDays(1), lastParkedAt = at("18:00", TODAY.minusDays(1)))
        assertEquals(BoardingKind.FIRST, log.classify(at("08:00"), SEOUL))
        assertEquals(BoardingKind.FIRST, BoardingLog().classify(at("08:00"), SEOUL))
    }

    @Test fun `탑승을 기록하면 같은 날은 재탑승`() {
        val log = BoardingLog().boarded(at("08:00"), SEOUL).parked(at("09:00"))
        assertEquals(BoardingKind.AGAIN, log.classify(at("12:00"), SEOUL))
    }
}

class DayPlanTest {
    private val plan = DayPlan(listOf(schedule("b", "14:00", "15:00"), schedule("a", "10:00", "11:00")))

    @Test fun `대상 일정은 남은 것 중 시작이 가장 이른 것`() {
        assertEquals("a", plan.target()?.id)
        assertEquals("b", plan.markArrived("a").target()?.id)
    }

    @Test fun `끝나는 시각이 지났는데 도착 전이면 건너뜀`() {
        val skipped = plan.skipOverdue(at("11:00"))
        assertEquals(ScheduleStatus.SKIPPED, skipped.statusOf("a"))
        assertEquals("b", skipped.target()?.id)
    }

    @Test fun `도착과 건너뜀은 되돌아가지 않음`() {
        val arrived = plan.markArrived("a")
        assertEquals(ScheduleStatus.ARRIVED, arrived.skipOverdue(at("12:00")).statusOf("a"))
        assertEquals(ScheduleStatus.ARRIVED, arrived.markLate("a").statusOf("a"))
        val skipped = plan.skipOverdue(at("11:30"))
        assertEquals(ScheduleStatus.SKIPPED, skipped.markArrived("a").statusOf("a"))
    }

    @Test fun `늦음에서 도착으로는 갈 수 있음`() {
        assertEquals(ScheduleStatus.ARRIVED, plan.markLate("a").markArrived("a").statusOf("a"))
    }

    @Test fun `모두 끝나면 대상 없음`() {
        assertNull(plan.markArrived("a").markArrived("b").target())
    }
}
