package com.chagok.car.flow

import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.PendingReask
import com.chagok.car.domain.Place
import com.chagok.car.domain.ReaskKind
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.ui.CandidateRow
import com.chagok.car.ui.TileView
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 일정 겹침(정책서 5장·6장·7장 '후보 고르기'). 이동 시간상 둘 다 갈 수 없으면 먼저인 일정을 주 버튼, 다음 일정을 보조 버튼으로 묻고,
 * 고른 일정으로 같은 카드에서 출발 제안·길안내를 이어 간다. 계약은 docs/target-selection.md.
 */
class DriveSessionOverlapTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = MutableClock(start)
    private lateinit var schedules: List<Schedule>
    private lateinit var session: DriveSession

    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val cityHall = Place("서울시청", LatLng(37.5663, 126.9779))

    private fun schedule(id: String, title: String, startMin: Long, lengthMin: Long, place: Place?) = Schedule(
        id = id, title = title,
        start = start + Duration.ofMinutes(startMin), end = start + Duration.ofMinutes(startMin + lengthMin),
        place = place,
    )

    /** 점심(강남역 40~100분)과 모임(서울시청, 90분 시작): 이동 시간 약 19분을 더하면 119분이라 90분 시작 모임에 못 간다. */
    @Before
    fun setUp() {
        schedules = listOf(schedule("a", "점심 약속", 40, 60, gangnam), schedule("b", "친구 모임", 90, 60, cityHall))
        newSession()
    }

    private fun newSession() {
        session = DriveSession(clock, { ScheduleSnapshot(schedules) })
        session.handle(Event.GearChanged(Gear.PARK))
    }

    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()
    private inline fun <reified T : Effect> List<Effect>.has() = any { it is T }
    private fun List<Effect>.card() = filterIsInstance<Effect.ShowCard>().last().card

    private fun boardToOverlap(): List<Effect> = session.handle(Event.Boarded)

    // ---- 질문 ----

    @Test
    fun 둘_다_갈_수_없으면_먼저인_일정을_주_버튼_다음_일정을_보조_버튼으로_묻는다() {
        val out = boardToOverlap()
        val card = out.card()
        assertEquals("‘점심 약속’과 ‘친구 모임’이 겹쳐요.", card.voice)
        assertEquals("어디로 갈까요?", card.sub)
        assertEquals("점심 약속으로", card.primary)
        assertEquals("친구 모임으로", card.secondary)
        assertEquals(
            listOf<TileView>(TileView.Candidates("겹치는 일정", listOf(CandidateRow("점심 약속", "00:40 강남역"), CandidateRow("친구 모임", "01:30 서울시청")))),
            card.tiles,
        )
        assertEquals(listOf("“첫 번째”, “두 번째”라고 말해도 돼요", "출발하면 자동으로 접혀요"), card.hints)
        // 어느 일정으로 갈지 정하기 전에는 소요 시간을 묻지 않고, 말한 뒤 듣는다.
        assertTrue(out.none { it is Effect.RequestTravelTime })
        assertEquals(Effect.Speak("‘점심 약속’과 ‘친구 모임’이 겹쳐요. 어디로 갈까요?", thenListen = true), out.one<Effect.Speak>())
        assertEquals(Rules.CARD_TIMEOUT, out.one<Effect.ScheduleCardTimeout>().delay)
        assertEquals(ScheduleStatus.PLANNED, out.filterIsInstance<Effect.Save>().last().snapshot.statuses["a"] ?: ScheduleStatus.PLANNED)
    }

    @Test
    fun 겹치지_않으면_평소대로_출발_제안이다() {
        schedules = listOf(schedule("a", "점심 약속", 40, 60, gangnam), schedule("b", "친구 모임", 130, 60, cityHall))
        newSession()
        assertEquals(gangnam, boardToOverlap().one<Effect.RequestTravelTime>().place)
    }

    // ---- 고르기 ----

    private fun chooseAndDepart(choose: () -> List<Effect>, expectedPlace: Place): Pair<List<Effect>, Effect.RequestTravelTime> {
        boardToOverlap()
        val chosen = choose()
        return chosen to chosen.one<Effect.RequestTravelTime>().also { assertEquals(expectedPlace, it.place) }
    }

    @Test
    fun 주_버튼과_응과_첫_번째와_이름은_먼저인_일정을_고른다() {
        listOf<() -> List<Effect>>(
            { session.handle(Event.PrimaryPressed) },
            { session.handle(Event.Heard("응")) },
            { session.handle(Event.Heard("첫 번째")) },
            { session.handle(Event.Heard("점심 약속")) },
            { session.handle(Event.CandidatePressed(0)) },
        ).forEach { choose ->
            newSession()
            chooseAndDepart(choose, gangnam)
        }
    }

    @Test
    fun 보조_버튼과_두_번째와_이름은_다음_일정을_고른다() {
        listOf<() -> List<Effect>>(
            { session.handle(Event.SecondaryPressed) },
            { session.handle(Event.Heard("두 번째")) },
            { session.handle(Event.Heard("친구 모임으로 갈래")) },
            { session.handle(Event.CandidatePressed(1)) },
        ).forEach { choose ->
            newSession()
            chooseAndDepart(choose, cityHall)
        }
    }

    @Test
    fun 고르면_같은_카드를_둔_채_소요_시간을_묻고_그동안_입력은_무시한다() {
        boardToOverlap()
        val chosen = session.handle(Event.SecondaryPressed)
        assertTrue(chosen.none { it is Effect.CollapseCard })
        assertTrue(chosen.has<Effect.StopVoice>())
        // 소요 시간을 기다리는 동안의 누름·말은 무시한다.
        assertEquals(emptyList<Effect>(), session.handle(Event.PrimaryPressed))
        assertEquals(emptyList<Effect>(), session.handle(Event.SecondaryPressed))
        assertEquals(emptyList<Effect>(), session.handle(Event.Heard("첫 번째")))
        assertEquals(emptyList<Effect>(), session.handle(Event.CandidatePressed(0)))
    }

    @Test
    fun 고른_일정으로_출발_제안을_하고_수락하면_그_장소로_길안내한다() {
        boardToOverlap()
        val request = session.handle(Event.SecondaryPressed).one<Effect.RequestTravelTime>()
        // 첫 탑승이라 인사와 오늘 일정 타일이 있는 출발 제안이다. 대상은 고른 친구 모임.
        val shown = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(20)))
        val card = shown.card()
        assertTrue(card.voice, card.voice.contains("1시 30분 친구 모임까지 1시간 30분이에요."))
        assertEquals("응, 출발", card.primary)
        assertEquals("잠깐만", card.secondary)
        assertEquals(Rules.CARD_TIMEOUT, shown.one<Effect.ScheduleCardTimeout>().delay)

        val route = session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        assertEquals(cityHall, route.place)
        // 도착 알림은 고른 일정을 도착으로 기록하고, 고르지 않은 일정(점심 약속)은 그대로 둔다.
        session.handle(Event.GearChanged(Gear.DRIVE))
        val arrived = session.handle(Event.DestinationArrived).filterIsInstance<Effect.Save>().last().snapshot.statuses
        assertEquals(ScheduleStatus.ARRIVED, arrived["b"])
        assertNull(arrived["a"])
    }

    @Test
    fun 먼저인_일정을_고르고_늦으면_늦게_탐으로_이어진다() {
        clock.now = start + Duration.ofMinutes(50)
        newSession()
        boardToOverlap()
        val request = session.handle(Event.PrimaryPressed).one<Effect.RequestTravelTime>()
        val card = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(20))).card()
        assertTrue(card.voice, card.voice.contains("점심 약속이"))
        assertEquals("출발할까요?", card.sub)
    }

    @Test
    fun 소요_시간을_모르면_모르는_대로_출발_제안이다() {
        boardToOverlap()
        val request = session.handle(Event.PrimaryPressed).one<Effect.RequestTravelTime>()
        assertEquals("응, 출발", session.handle(Event.TravelTimeResult(request.requestId, null)).card().primary)
    }

    @Test
    fun 고른_뒤_주행이_시작되면_카드를_접고_늦게_온_소요_시간은_버린다() {
        boardToOverlap()
        val request = session.handle(Event.PrimaryPressed).one<Effect.RequestTravelTime>()
        assertTrue(session.handle(Event.GearChanged(Gear.DRIVE)).has<Effect.CollapseCard>())
        assertTrue(session.handle(Event.TravelTimeResult(request.requestId, null)).none { it is Effect.ShowCard })
    }

    @Test
    fun 고른_뒤_다시_타면_고르지_않은_일정이_그대로라_겹침을_다시_묻는다() {
        boardToOverlap()
        val request = session.handle(Event.SecondaryPressed).one<Effect.RequestTravelTime>()
        session.handle(Event.TravelTimeResult(request.requestId, null))
        session.handle(Event.PrimaryPressed)
        // 길안내 수락 뒤 주행 없이 같은 자리에서 시동을 껐다 켠다(마지막 P단이 없어 잠깐 정차가 아니다).
        clock.now += Duration.ofMinutes(2)
        val again = session.handle(Event.Boarded)
        assertEquals("‘점심 약속’과 ‘친구 모임’이 겹쳐요.", again.card().voice)
    }

    // ---- 그 밖의 대답 ----

    @Test
    fun 거절은_접고_다시_묻지_않는다() {
        boardToOverlap()
        val out = session.handle(Event.Heard("아니"))
        assertTrue(out.has<Effect.CollapseCard>())
        assertTrue(out.none { it is Effect.RequestTravelTime || it is Effect.StartRoute })
        assertNull(out.filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.reask)
    }

    @Test
    fun 후보에_없는_이름은_한_번_다시_묻는다() {
        boardToOverlap()
        val out = session.handle(Event.Heard("서울역"))
        // 겹침 카드는 '응·아니'가 아니라 어느 일정인지를 묻는다.
        assertEquals(Phrases.ASK_AGAIN_PICK, out.one<Effect.Speak>().text)
        assertEquals("다시 말해 줄래요? '첫 번째'나 '두 번째'로요.", Phrases.ASK_AGAIN_PICK)
    }

    @Test
    fun 화면에_줄여_보인_긴_제목은_앞부분만_말해도_고를_수_있다() {
        val longTitle = "아주아주긴제목의 점심약속입니다 확인"
        schedules = listOf(schedule("a", longTitle, 40, 60, gangnam), schedule("b", "친구 모임", 90, 60, cityHall))
        newSession()
        val card = boardToOverlap().card()
        // 큰 문구에는 12자로 줄여 보인다. 보인 만큼만 말해도 먼저인 일정을 고른다.
        assertTrue(card.voice, card.voice.contains("…"))
        val shown = Phrases.shortTitle(longTitle).trimEnd('…')
        assertEquals(gangnam, session.handle(Event.Heard(shown)).one<Effect.RequestTravelTime>().place)
        // 줄이지 않은 전체 이름도 고른다.
        newSession()
        boardToOverlap()
        assertEquals(gangnam, session.handle(Event.Heard(longTitle)).one<Effect.RequestTravelTime>().place)
    }

    @Test
    fun 두_일정_이름이_같이_들리면_알아듣지_못한_것이다() {
        boardToOverlap()
        val out = session.handle(Event.Heard("점심 약속이랑 친구 모임"))
        assertEquals(Phrases.ASK_AGAIN_PICK, out.one<Effect.Speak>().text)
    }

    @Test
    fun 대안은_겹침에서는_다른_곳이_없다고_한다() {
        boardToOverlap()
        assertEquals("다른 곳은 찾지 못했어요.", session.handle(Event.Heard("다른 데")).one<Effect.Speak>().text)
    }

    @Test
    fun 무응답으로_접히면_다시_물을_질문이고_다음_정차에_겹침을_다시_묻는다() {
        val timer = boardToOverlap().one<Effect.ScheduleCardTimeout>()
        val folded = session.handle(Event.CardTimedOut(timer.timerId))
        assertEquals(PendingReask(ReaskKind.OVERLAP, "a"), folded.filterIsInstance<Effect.Save>().last().snapshot.reask)

        session.handle(Event.GearChanged(Gear.DRIVE))
        clock.now += Duration.ofMinutes(5)
        val parked = session.handle(Event.GearChanged(Gear.PARK))
        // 위치로 도착을 판단하는 동안(점심 약속이 시간 창 안)은 기다린다. 내비가 답하지 않으면 타임아웃 뒤 묻는다.
        val timeout = parked.filterIsInstance<Effect.ScheduleLocationTimeout>().single()
        val asked = session.handle(Event.LocationTimedOut(timeout.timerId))
        assertEquals("‘점심 약속’과 ‘친구 모임’이 겹쳐요.", asked.card().voice)
    }

    @Test
    fun 보류한_뒤에도_고를_수_있다() {
        boardToOverlap()
        val hold = session.handle(Event.Heard("잠깐만")).one<Effect.ScheduleCardTimeout>()
        assertEquals(Rules.CARD_TIMEOUT, hold.delay)
        assertEquals(cityHall, session.handle(Event.SecondaryPressed).one<Effect.RequestTravelTime>().place)
    }

    // ---- 겹침 판정 ----

    @Test
    fun 같은_곳의_겹치는_일정은_옮겨_갈_일이_없어_묻지_않는다() {
        schedules = listOf(schedule("a", "경기", 40, 120, gangnam), schedule("b", "응원 모임", 90, 60, gangnam))
        newSession()
        assertEquals(gangnam, boardToOverlap().one<Effect.RequestTravelTime>().place)
    }

    @Test
    fun 다음_일정의_장소를_모르면_겹침을_묻지_않는다() {
        schedules = listOf(schedule("a", "점심 약속", 40, 60, gangnam), schedule("b", "친구 모임", 90, 60, null))
        newSession()
        assertEquals(gangnam, boardToOverlap().one<Effect.RequestTravelTime>().place)
    }
}
