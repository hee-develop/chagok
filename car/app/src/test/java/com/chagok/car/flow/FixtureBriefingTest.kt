package com.chagok.car.flow

import com.chagok.car.FixtureFile
import com.chagok.car.FixtureResponses
import com.chagok.car.domain.AskReason
import com.chagok.car.domain.BoardingDecider
import com.chagok.car.domain.BoardingDecision
import com.chagok.car.domain.BoardingKind
import com.chagok.car.domain.DayPlan
import com.chagok.car.domain.Question
import com.chagok.car.ui.TileRow
import com.chagok.car.ui.TileView
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** 프로토타입 '광주 직관 하루'를 09:20에 탔을 때의 첫 탑승 카드가 픽스처로 재현되는지 본다. */
class FixtureBriefingTest {
    private val seoul = ZoneId.of("Asia/Seoul")
    private val now = Instant.parse("2026-11-06T00:20:00Z")

    @Test fun `픽스처로 만든 첫 탑승 카드는 프로토타입 장면과 같다`() {
        val fixture = FixtureFile.read("schedules/gwangju-day.json")
        val plan = DayPlan(ScheduleParser.parse(FixtureResponses.response(fixture, now)))
        val decision = BoardingDecider.decide(now, BoardingKind.FIRST, plan, planIsFallback = false, travelTime = null)
        val card = Phrases.card(decision as BoardingDecision.Card, now, seoul)

        assertEquals(Question.Depart(plan.target()!!), decision.question)
        assertEquals("광주 직관 날이에요!\n1시 육전집 점심까지 3시간 40분이에요.", card.voice)
        // 육전집 점심은 챙길 것이 없다(유니폼·응원봉·티켓은 KIA 직관의 것이고, 다른 일정의 메모는 첫 탑승에서 읽지 않는다)
        assertEquals("출발할까요?", card.sub)
        assertEquals(
            listOf(TileView.Schedules(listOf(TileRow("13:00", "육전집 점심", true), TileRow("17:00", "KIA 직관", false), TileRow("21:00", "콩물 픽업", false)))),
            card.tiles,
        )
    }

    @Test fun `오늘 일정이 모두 끝난 뒤에 타면 다른 날 일정이 있어도 대상이 없다`() {
        val fixture = FixtureFile.read("schedules/gwangju-day.json")
        val schedules = ScheduleParser.parse(FixtureResponses.response(fixture, now))
        assertEquals(listOf("광주 직관", "육전집 점심", "KIA 직관", "콩물 픽업", "친구 약속"), schedules.map { it.title })

        val lateNight = Instant.parse("2026-11-06T14:50:00Z") // 23:50 KST
        val decision = BoardingDecider.decide(lateNight, BoardingKind.AGAIN, DayPlan(schedules), planIsFallback = false, travelTime = null)

        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE), (decision as BoardingDecision.Card).question)
    }
}
