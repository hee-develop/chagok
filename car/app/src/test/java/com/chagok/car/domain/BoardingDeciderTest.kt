package com.chagok.car.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration

class BoardingDeciderTest {
    private val meeting = schedule("m", "10:00", "11:00", memo = "계약서 2부")
    private val lunch = schedule("l", "12:30", "13:30")
    private val plan = DayPlan(listOf(meeting, lunch))
    private val thirtyMin = Duration.ofMinutes(30)

    private fun decide(
        now: String,
        kind: BoardingKind = BoardingKind.FIRST,
        plan: DayPlan? = this.plan,
        fallback: Boolean = false,
        travel: Duration? = thirtyMin,
        favorites: List<Favorite> = emptyList(),
    ) = BoardingDecider.decide(at(now), kind, plan, fallback, travel, favorites)

    private fun card(decision: BoardingDecision) = decision as BoardingDecision.Card

    @Test fun `잠깐 정차면 말하지 않음`() {
        assertEquals(BoardingDecision.StaySilent, decide("09:00", kind = BoardingKind.QUICK_STOP))
    }

    @Test fun `출발 시각 근처면 출발 제안`() {
        // 출발해야 할 시각 = 10:00 - 30분 - 여유 10분 = 09:20
        assertEquals(Question.Depart(meeting, at("09:30")), card(decide("09:00")).question)
    }

    @Test fun `출발 시각보다 60분 넘게 이르면 목적지를 물음`() {
        assertEquals(Question.AskDestination(AskReason.PLENTY_OF_TIME, meeting, at("09:20")), card(decide("08:19")).question)
        assertEquals(Question.Depart(meeting, at("08:50")), card(decide("08:20")).question)
    }

    @Test fun `도착 예정이 시작보다 5분 넘게 늦으면 늦게 탐`() {
        assertEquals(Question.Depart(meeting, at("10:05")), card(decide("09:35")).question)
        assertEquals(Question.DepartLate(meeting, Duration.ofMinutes(6), at("10:06")), card(decide("09:36")).question)
    }

    @Test fun `오늘 남은 일정이 없으면 목적지를 물음`() {
        val done = plan.markArrived("m").markArrived("l")
        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE), card(decide("15:00", plan = done)).question)
        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE), card(decide("09:00", plan = null)).question)
    }

    @Test fun `끝난 일정은 건너뛰고 다음 일정을 고름`() {
        assertEquals(Question.Depart(lunch, at("12:00")), card(decide("11:30")).question)
    }

    @Test fun `장소를 못 정한 일정이면 목적지를 물음`() {
        val noPlace = schedule("x", "10:00", "11:00", place = null)
        assertEquals(
            Question.AskDestination(AskReason.PLACE_UNKNOWN, noPlace),
            card(decide("09:00", plan = DayPlan(listOf(noPlace)))).question,
        )
    }

    @Test fun `소요 시간을 모르면 출발만 제안`() {
        assertEquals(Question.Depart(meeting), card(decide("06:00", travel = null)).question)
    }

    @Test fun `소요 시간을 몰라도 시작이 5분 넘게 지났으면 늦게 탐`() {
        // 경계: 시작(10:00)에서 정확히 5분은 늦지 않고, 6분부터 늦음(lateBy = now - start)
        assertEquals(Question.Depart(meeting), card(decide("10:05", travel = null)).question)
        assertEquals(Question.DepartLate(meeting, Duration.ofMinutes(6)), card(decide("10:06", travel = null)).question)
    }

    @Test fun `소요 시간을 모르면 이르게 타도 여유 판단은 하지 않음`() {
        assertEquals(Question.Depart(meeting), card(decide("07:00", travel = null)).question)
    }

    @Test fun `첫 탑승은 전체 브리핑과 챙길 것`() {
        val briefing = card(decide("09:00")).briefing
        assertEquals(Briefing.Level.FULL, briefing.level)
        assertEquals(2, briefing.remainingToday)
        assertEquals(MemoNote.ReadAloud("계약서 2부"), briefing.memo)
    }

    @Test fun `재탑승은 대상 일정 한 줄만`() {
        val briefing = card(decide("09:00", kind = BoardingKind.AGAIN)).briefing
        assertEquals(Briefing.Level.ONE_LINE, briefing.level)
        assertEquals(meeting, briefing.target)
        assertEquals(MemoNote.None, briefing.memo)
    }

    @Test fun `사본으로 판단하면 한 줄을 붙임`() {
        assertTrue(card(decide("09:00", fallback = true)).briefing.fromFallback)
        assertFalse(card(decide("09:00", plan = null, fallback = true)).briefing.fromFallback)
    }

    @Test fun `메모는 한 줄 30자 이하만 읽음`() {
        assertEquals(MemoNote.None, MemoNote.of("  "))
        assertEquals(MemoNote.ReadAloud("가".repeat(30)), MemoNote.of("가".repeat(30)))
        assertEquals(MemoNote.HasMemo, MemoNote.of("가".repeat(31)))
        assertEquals(MemoNote.HasMemo, MemoNote.of("도장\n서류"))
    }

    @Test fun `종일 일정은 대상 일정에서 빠지고 첫 탑승 인사에만 쓴다`() {
        val allDay = Schedule("d", "광주 직관", at("00:00"), at("23:59"), allDay = true)
        val withAllDay = DayPlan(listOf(allDay, meeting, lunch))
        val first = card(decide("09:00", plan = withAllDay)).briefing
        assertEquals(meeting, first.target)
        assertEquals(listOf(meeting, lunch), first.upcoming)
        assertEquals("광주 직관", first.allDayTitle)
        // 재탑승에는 종일 일정 인사가 없다
        assertEquals(null, card(decide("09:00", kind = BoardingKind.AGAIN, plan = withAllDay)).briefing.allDayTitle)
        // 종일 일정만 있으면 갈 곳이 없는 것과 같다
        val onlyAllDay = DayPlan(listOf(allDay))
        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE), card(decide("09:00", plan = onlyAllDay)).question)
        // 종일 일정은 늦음·건너뜀 판단 대상이 아니다
        assertEquals(emptyMap<String, ScheduleStatus>(), withAllDay.skipOverdue(at("23:59") + Duration.ofHours(1)).statuses.filterKeys { it == "d" })
    }

    private val home = Favorite(FavoriteKind.HOME, Place("예시 아파트", LatLng(35.17, 126.91)))
    private val work = Favorite(FavoriteKind.WORK, Place("예시타워", OFFICE.position))
    private val station = Favorite(FavoriteKind.OTHER, Place("광주송정역", LatLng(35.13, 126.79)), "광주 광산구 상무대로 201")
    private val library = Favorite(FavoriteKind.OTHER, Place("광주 시립도서관", LatLng(35.13, 126.90)))
    private val all = listOf(home, work, station, library)

    @Test fun `일정이 없으면 자주 가는 곳을 앞에서부터 3개까지 후보로 붙임`() {
        val q = card(decide("09:00", plan = null, favorites = all)).question as Question.AskDestination
        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE, favorites = listOf(home, work, station)), q)
        assertEquals(listOf(home.place, work.place, station.place), q.candidates)
    }

    @Test fun `여유가 많으면 일정 장소가 1번이고 같은 곳을 뺀 자주 가는 곳 2개가 뒤에 붙음`() {
        // work는 일정 장소(OFFICE)와 좌표가 같아 뺀다.
        val q = card(decide("08:19", favorites = all)).question as Question.AskDestination
        assertEquals(Question.AskDestination(AskReason.PLENTY_OF_TIME, meeting, at("09:20"), listOf(home, station)), q)
        assertEquals(listOf(OFFICE, home.place, station.place), q.candidates)
    }

    @Test fun `장소를 모르는 일정과 출발 제안에는 자주 가는 곳을 붙이지 않음`() {
        val noPlace = schedule("n", "10:00", "11:00", place = null)
        val unknown = card(decide("09:00", plan = DayPlan(listOf(noPlace)), favorites = all)).question as Question.AskDestination
        assertEquals(emptyList<Favorite>(), unknown.favorites)
        assertEquals(emptyList<Place>(), unknown.candidates)
        assertEquals(Question.Depart(meeting, at("09:30")), card(decide("09:00", favorites = all)).question)
    }
}
