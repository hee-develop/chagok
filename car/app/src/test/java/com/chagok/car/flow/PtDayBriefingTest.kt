package com.chagok.car.flow

import com.chagok.car.FixtureFile
import com.chagok.car.FixtureResponses
import com.chagok.car.domain.AskReason
import com.chagok.car.domain.BoardingDecider
import com.chagok.car.domain.BoardingDecision
import com.chagok.car.domain.BoardingKind
import com.chagok.car.domain.DayPlan
import com.chagok.car.domain.Question
import com.chagok.car.ui.CardContent
import com.chagok.car.ui.TileRow
import com.chagok.car.ui.TileView
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** PT 시연 일정(fixtures/schedules/pt-day.json)을 12/3 08:50에 탔을 때의 첫 탑승 카드. 계약은 docs/pt-demo.md */
class PtDayBriefingTest {
    private val seoul = ZoneId.of("Asia/Seoul")
    private val now = Instant.parse("2026-12-02T23:50:00Z")

    /** 서버 응답(at은 PT 날짜가 아니어도 픽스처의 고정 기준 시각을 따른다)을 [edit]로 고친 뒤 첫 탑승을 판단한다. */
    private fun board(at: Instant = now, travelTime: Duration? = null, edit: (JSONObject) -> Unit = {}): Pair<BoardingDecision.Card, CardContent> {
        val response = JSONObject(FixtureResponses.response(FixtureFile.read("schedules/pt-day.json"), Instant.parse("2026-11-14T00:00:00Z")))
        edit(response)
        val plan = DayPlan(ScheduleParser.parse(response.toString()))
        val decision = BoardingDecider.decide(at, BoardingKind.FIRST, plan, planIsFallback = false, travelTime = travelTime) as BoardingDecision.Card
        return decision to Phrases.card(decision, at, seoul)
    }

    /** 폰 3단계에서 육전집 장소를 고르고 KIA 직관에 채비를 적은 상태(서버가 /schedules/today에 실어 준다). */
    private fun filledOnPhone(response: JSONObject) {
        val schedules = response.getJSONArray("schedules")
        for (i in 0 until schedules.length()) {
            val s = schedules.getJSONObject(i)
            when (s.getString("id")) {
                "pt-lunch" -> s.put("locationText", "광주 육전집").put("place", JSONObject().put("name", "광주 육전집").put("lat", 35.1595).put("lng", 126.8526))
                "pt-kia" -> s.put("care", "유니폼 · 응원봉")
            }
        }
    }

    @Test fun `장소를 비운 육전집 점심은 시작 60분 전부터만 대상이라 08시 50분에는 건너뛰고 KIA 직관이 대상이다`() {
        val (decision, card) = board()
        // 화상회의는 폰이 걸러 보내지 않고, 장소 칸이 빈 점심(13:00)은 12:00 전에는 대상이 아니다(정책서 5장: 장소 칸이 빈 일정은 시작 60분 전부터만).
        assertEquals(listOf("pt-lunch", "pt-kia", "pt-kongmul"), decision.briefing.upcoming.map { it.id })
        assertEquals("pt-kia", decision.briefing.target?.id)
        assertTrue(decision.question is Question.Depart)
        assertTrue(card.voice, card.voice.contains("5시 KIA 직관까지 8시간 10분이에요."))
        // 오늘 일정 타일에는 점심도 있고 '다음 일정' 표시는 대상(KIA 직관)에 붙는다.
        assertEquals(
            TileView.Schedules(listOf(TileRow("13:00", "육전집 점심", false), TileRow("17:00", "KIA 직관", true), TileRow("21:00", "콩물 픽업", false))),
            card.tiles.first(),
        )
    }

    @Test fun `08시 50분 대상은 KIA 직관이고 소요 시간을 모르면 출발 제안 알면 출발까지 60분 넘게 남아 어디로 갈까요를 묻는다`() {
        // 소요 시간을 모르면(내비가 못 답함) 여유 판단 없이 늦음만 보므로 출발 제안이다(위 테스트).
        // 소요 시간을 알면 출발 시각(17:00 - 소요 - 10분)까지 60분 넘게 남았는지 본다: 3시간이면 13:50 출발이라 08:50엔 60분 넘게 이르다.
        val (early, earlyCard) = board(travelTime = Duration.ofHours(3))
        assertEquals("pt-kia", early.briefing.target?.id)
        val ask = early.question as Question.AskDestination
        assertEquals(AskReason.PLENTY_OF_TIME, ask.reason)
        assertEquals("pt-kia", ask.suggested?.id)
        assertTrue(earlyCard.voice, earlyCard.voice.contains("어디로 갈까요?"))
        // 8시간 걸리면 출발 시각이 08:50이라 지금 출발 제안이다.
        val (late, _) = board(travelTime = Duration.ofHours(8))
        assertTrue(late.question is Question.Depart)
    }

    @Test fun `장소를 비운 육전집 점심은 시작 60분 안이면 대상이라 어디로 갈지 묻는다`() {
        val (decision, card) = board(at = Instant.parse("2026-12-03T03:10:00Z")) // 12:10 서울, 점심 13:00의 50분 전
        assertEquals(AskReason.PLACE_UNKNOWN, (decision.question as Question.AskDestination).reason)
        assertEquals("'육전집 점심' 어디로 가면 될까요?", card.voice)
    }

    @Test fun `폰에서 장소와 채비를 넣으면 08시 50분 첫 탑승 브리핑이 시연 대본대로 나온다`() {
        val (decision, card) = board(edit = ::filledOnPhone)
        assertTrue(decision.question is Question.Depart)
        assertEquals("광주 직관 날이에요!\n1시 육전집 점심까지 4시간 10분이에요.", card.voice)
        assertTrue(card.sub!!, card.sub!!.contains("유니폼 · 응원봉") && card.sub!!.endsWith("출발할까요?"))
        assertEquals(
            TileView.Schedules(listOf(TileRow("13:00", "육전집 점심", true), TileRow("17:00", "KIA 직관", false), TileRow("21:00", "콩물 픽업", false))),
            card.tiles.first(),
        )
        assertEquals("응, 출발", card.primary)
    }
}
