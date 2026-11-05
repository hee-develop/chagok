package com.chagok.car.flow

import com.chagok.car.FixtureFile
import com.chagok.car.FixtureResponses
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
        assertEquals("육전집 점심 메모에 ‘유니폼·응원봉·티켓’이 있어요. 챙기셨어요?", card.sub)
        assertEquals(
            listOf(
                TileView.Schedules(listOf(TileRow("13:00", "육전집 점심", true), TileRow("17:00", "KIA 직관", false), TileRow("21:00", "콩물 픽업", false))),
                TileView.Care(listOf("유니폼", "응원봉", "티켓")),
            ),
            card.tiles,
        )
    }
}
