package com.chagok.car.flow

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.ui.TileView
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private class MutableClock(var now: Instant) : Clock() {
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId): Clock = this
    override fun instant(): Instant = now
}

class DriveSessionTest {
    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = MutableClock(start)
    private lateinit var schedules: List<Schedule>
    private var favorites: List<Favorite> = emptyList()
    private lateinit var session: DriveSession

    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val cityHall = Place("서울시청", LatLng(37.5663, 126.9779))

    private fun schedule(id: String, title: String, startMin: Long, place: Place?, memo: String? = null) = Schedule(
        id = id,
        title = title,
        start = start + Duration.ofMinutes(startMin),
        end = start + Duration.ofMinutes(startMin + 60),
        place = place,
        memo = memo,
    )

    @Before
    fun setUp() {
        schedules = listOf(
            schedule("a", "고객 미팅", 40, gangnam, "계약서 2부"),
            schedule("b", "점심 약속", 180, cityHall),
        )
        newSession()
    }

    /** @param gear 시작할 때의 기어. 앱을 켠 순간 이미 P단이면 '방금 P단에 넣음'이 아니다. null이면 기어를 아직 모름 */
    private fun newSession(restored: Snapshot? = null, gear: Gear? = Gear.PARK) {
        session = DriveSession(clock, { ScheduleSnapshot(schedules, favorites = favorites) }, restored)
        gear?.let { session.handle(Event.GearChanged(it)) }
    }

    private val day get() = start.atZone(ZoneOffset.UTC).toLocalDate()

    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()
    private inline fun <reified T : Effect> List<Effect>.has() = any { it is T }

    /** 탑승 → 소요 시간 응답까지 진행해 카드를 띄운다. */
    private fun boardWithCard(travel: Duration? = null): List<Effect> {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        return session.handle(Event.TravelTimeResult(request.requestId, travel))
    }

    private fun park() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.GearChanged(Gear.PARK))
    }

    @Test
    fun 첫_탑승은_카드를_띄우고_말한_뒤_듣는다() {
        val boarded = session.handle(Event.Boarded)
        val request = boarded.one<Effect.RequestTravelTime>()
        assertEquals(gangnam, request.place)
        // 탑승 기록은 카드를 실제로 띄울 때 남긴다.
        assertTrue(!boarded.has<Effect.Save>())

        val out = session.handle(Event.TravelTimeResult(request.requestId, null))
        assertEquals(day, out.one<Effect.Save>().snapshot.log.lastBoardedOn)
        val card = out.one<Effect.ShowCard>().card
        assertEquals("12시 40분 고객 미팅까지 40분이에요.", card.voice)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요. 출발할까요?", card.sub)
        assertEquals("응, 출발", card.primary)
        assertEquals("잠깐만", card.secondary)
        val speak = out.one<Effect.Speak>()
        assertTrue(speak.thenListen)
        assertEquals("12시 40분 고객 미팅까지 40분이에요. 고객 미팅 메모에 ‘계약서 2부’가 있어요. 출발할까요?", speak.text)
        assertEquals(Rules.CARD_TIMEOUT, out.one<Effect.ScheduleCardTimeout>().delay)
    }

    @Test
    fun 소요_시간을_모르면_출발을_제안한다() {
        val out = boardWithCard(travel = null)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요. 출발할까요?", out.one<Effect.ShowCard>().card.sub)
    }

    @Test
    fun 잠깐_정차면_아무_반응이_없다() {
        park()
        clock.now += Duration.ofMinutes(3)
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    @Test
    fun 앱을_켤_때_이미_P단이면_잠깐_정차로_보지_않는다() {
        newSession(gear = Gear.PARK)
        assertTrue(session.handle(Event.Boarded).has<Effect.RequestTravelTime>())
    }

    @Test
    fun 주행_중_탑승은_무시한다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    @Test
    fun 주행_제한이_걸린_중_탑승도_무시한다() {
        session.handle(Event.RestrictionChanged(true))
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    @Test
    fun 카드가_떠_있을_때_탑승은_무시한다() {
        boardWithCard()
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    @Test
    fun D로_바뀌면_카드를_접고_음성을_멈춘다() {
        boardWithCard()
        val out = session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(out.has<Effect.StopVoice>())
        assertEquals(Effect.CollapseCard(instant = true), out.one<Effect.CollapseCard>())
    }

    @Test
    fun 주행_제한이_걸리면_카드를_접는다() {
        boardWithCard()
        val out = session.handle(Event.RestrictionChanged(true))
        assertTrue(out.has<Effect.StopVoice>())
        assertEquals(Effect.CollapseCard(instant = true), out.one<Effect.CollapseCard>())
    }

    @Test
    fun 탑승_판단_중_D가_되면_소요_시간_응답을_버린다() {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals(emptyList<Effect>(), session.handle(Event.TravelTimeResult(request.requestId, null)))
    }

    @Test
    fun 이전_요청의_소요_시간_응답은_무시한다() {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        assertEquals(emptyList<Effect>(), session.handle(Event.TravelTimeResult(request.requestId + 1, null)))
        assertTrue(session.handle(Event.TravelTimeResult(request.requestId, null)).has<Effect.ShowCard>())
    }

    @Test
    fun 수락하면_길안내를_요청하고_결과를_알린다() {
        boardWithCard()
        val out = session.handle(Event.Heard("응"))
        assertEquals(gangnam, out.one<Effect.StartRoute>().place)
        assertTrue(out.has<Effect.CollapseCard>())

        val done = session.handle(Event.RouteRequestResult(true))
        assertEquals(Effect.Speak("길안내를 시작할게요.", thenListen = false), done.one<Effect.Speak>())
        assertEquals("길안내를 시작할게요.", done.one<Effect.ShowResult>().text)
    }

    @Test
    fun 수락은_음성을_한_번만_멈춘다() {
        boardWithCard()
        assertEquals(1, session.handle(Event.PrimaryPressed).count { it is Effect.StopVoice })
        newSession()
        boardWithCard()
        assertEquals(1, session.handle(Event.Heard("응")).count { it is Effect.StopVoice })
        newSession()
        boardWithCard()
        assertEquals(1, session.handle(Event.SecondaryPressed).count { it is Effect.StopVoice })
    }

    @Test
    fun 주_버튼도_수락과_같다() {
        boardWithCard()
        val out = session.handle(Event.PrimaryPressed)
        assertTrue(out.has<Effect.StopVoice>())
        assertEquals(gangnam, out.one<Effect.StartRoute>().place)
        assertEquals(Effect.CollapseCard(instant = false), out.one<Effect.CollapseCard>())
    }

    @Test
    fun 길안내_요청이_실패하면_실패를_알린다() {
        boardWithCard()
        session.handle(Event.PrimaryPressed)
        val out = session.handle(Event.RouteRequestResult(false))
        assertEquals("길안내를 시작하지 못했어요.", out.one<Effect.Speak>().text)
        assertEquals("길안내를 시작하지 못했어요.", out.one<Effect.ShowResult>().text)
    }

    @Test
    fun 요청하지_않은_길안내_결과는_무시한다() {
        assertEquals(emptyList<Effect>(), session.handle(Event.RouteRequestResult(true)))
        boardWithCard()
        session.handle(Event.PrimaryPressed)
        session.handle(Event.RouteRequestResult(true))
        assertEquals(emptyList<Effect>(), session.handle(Event.RouteRequestResult(false)))
    }

    @Test
    fun 거절하면_카드를_접고_다시_묻지_않는다() {
        val timer = boardWithCard().one<Effect.ScheduleCardTimeout>()
        val out = session.handle(Event.Heard("아니"))
        assertTrue(out.has<Effect.CollapseCard>())
        assertTrue(out.none { it is Effect.StartRoute || it is Effect.Speak })
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(timer.timerId)))
    }

    @Test
    fun 알아듣지_못하면_한_번_다시_묻고_두_번째는_버튼만_남긴다() {
        boardWithCard()
        val first = session.handle(Event.Heard("글쎄"))
        assertEquals(Effect.Speak("다시 말해 줄래요? '응'이나 '아니'로요.", thenListen = true), first.one<Effect.Speak>())

        val second = session.handle(Event.Heard("음"))
        assertEquals(Effect.Speak("화면에서 눌러 주세요.", thenListen = false), second.one<Effect.Speak>())
        assertEquals("화면에서 눌러 주세요.", second.one<Effect.ShowCard>().card.notice)

        // 듣기가 닫힌 뒤의 음성은 무시한다.
        assertEquals(emptyList<Effect>(), session.handle(Event.Heard("응")))
    }

    @Test
    fun 차_안_대화는_무시한다() {
        boardWithCard()
        assertEquals(emptyList<Effect>(), session.handle(Event.Heard("오늘 점심에 뭐 먹을지 생각 중이야")))
    }

    @Test
    fun 무응답이면_듣기만_닫고_카드는_둔다() {
        boardWithCard()
        assertEquals(emptyList<Effect>(), session.handle(Event.Heard("")))
        assertTrue(session.handle(Event.PrimaryPressed).has<Effect.StartRoute>())
    }

    @Test
    fun 대안은_없다고_말한다() {
        boardWithCard()
        val out = session.handle(Event.Heard("다른 데"))
        assertEquals("다른 곳은 찾지 못했어요.", out.one<Effect.Speak>().text)
        assertEquals("다른 곳은 찾지 못했어요.", out.one<Effect.ShowCard>().card.notice)
    }

    @Test
    fun 보류하면_30초를_다시_세고_이전_타이머는_무시한다() {
        val first = boardWithCard().one<Effect.ScheduleCardTimeout>()
        val hold = session.handle(Event.Heard("잠깐만")).one<Effect.ScheduleCardTimeout>()
        assertEquals(Rules.CARD_TIMEOUT, hold.delay)

        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(first.timerId)))
        assertTrue(session.handle(Event.CardTimedOut(hold.timerId)).has<Effect.CollapseCard>())
    }

    @Test
    fun 잠깐만_버튼은_보류다_카드를_둔_채_30초를_다시_센다() {
        val first = boardWithCard().one<Effect.ScheduleCardTimeout>()
        val out = session.handle(Event.SecondaryPressed)
        assertTrue(out.none { it is Effect.CollapseCard || it is Effect.StartRoute })
        assertTrue(out.has<Effect.StopVoice>())
        val hold = out.one<Effect.ScheduleCardTimeout>()
        assertEquals(Rules.CARD_TIMEOUT, hold.delay)
        // 이전 타이머는 무시하고, 새 타이머가 되면 접는다(애니메이션 있이).
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(first.timerId)))
        assertEquals(Effect.CollapseCard(instant = false), session.handle(Event.CardTimedOut(hold.timerId)).one<Effect.CollapseCard>())
    }

    @Test
    fun 보류한_뒤_듣기는_닫히고_버튼으로_수락한다() {
        boardWithCard()
        session.handle(Event.SecondaryPressed)
        assertEquals(emptyList<Effect>(), session.handle(Event.Heard("응")))
        assertEquals(gangnam, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)
    }

    @Test
    fun 보류한_뒤에도_버튼으로_수락한다() {
        val first = boardWithCard().one<Effect.ScheduleCardTimeout>()
        val hold = session.handle(Event.Heard("잠깐만")).one<Effect.ScheduleCardTimeout>()
        assertEquals(gangnam, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)
        // 접힌 카드에는 이전·새 타이머 모두 효과가 없다.
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(first.timerId)))
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(hold.timerId)))
    }

    @Test
    fun 카드가_없을_때의_버튼과_음성은_무시한다() {
        assertEquals(emptyList<Effect>(), session.handle(Event.PrimaryPressed))
        assertEquals(emptyList<Effect>(), session.handle(Event.SecondaryPressed))
        assertEquals(emptyList<Effect>(), session.handle(Event.Heard("응")))
    }

    @Test
    fun 길안내_결과_전에_D가_되면_결과를_보이지도_말하지도_않는다() {
        boardWithCard()
        session.handle(Event.PrimaryPressed)
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals(emptyList<Effect>(), session.handle(Event.RouteRequestResult(true)))
    }

    @Test
    fun 결과_한_줄은_10초_뒤_지운다() {
        boardWithCard()
        session.handle(Event.PrimaryPressed)
        val done = session.handle(Event.RouteRequestResult(true))
        val timer = done.one<Effect.ScheduleResultTimeout>()
        assertEquals(Rules.RESULT_VISIBLE, timer.delay)
        assertEquals("", session.handle(Event.ResultTimedOut(timer.timerId)).one<Effect.ShowResult>().text)
        // 이미 지운 뒤의 타이머는 아무 일도 하지 않는다.
        assertEquals(emptyList<Effect>(), session.handle(Event.ResultTimedOut(timer.timerId)))
    }

    @Test
    fun 결과_한_줄이_떠_있을_때_주행이_시작되면_지운다() {
        boardWithCard()
        session.handle(Event.PrimaryPressed)
        val timer = session.handle(Event.RouteRequestResult(true)).one<Effect.ScheduleResultTimeout>()
        assertEquals("", session.handle(Event.GearChanged(Gear.DRIVE)).one<Effect.ShowResult>().text)
        assertEquals(emptyList<Effect>(), session.handle(Event.ResultTimedOut(timer.timerId)))
    }

    @Test
    fun 결과_한_줄이_떠_있을_때_Suspend가_되면_지운다() {
        boardWithCard()
        session.handle(Event.PrimaryPressed)
        session.handle(Event.RouteRequestResult(true))
        val out = session.handle(Event.SuspendRequested)
        assertEquals("", out.one<Effect.ShowResult>().text)
    }

    @Test
    fun 수락하면_카드_음성을_멈추고_결과를_말한다() {
        boardWithCard()
        val accepted = session.handle(Event.Heard("응"))
        val order = accepted.map { it::class }
        assertTrue(order.indexOf(Effect.StopVoice::class) < order.indexOf(Effect.StartRoute::class))
        // 결과 안내는 새 말하기이고, 수락 뒤에는 카드가 없어 끊을 카드 음성이 없다.
        assertEquals(Effect.Speak("길안내를 시작할게요.", thenListen = false), session.handle(Event.RouteRequestResult(true)).one<Effect.Speak>())
    }

    @Test
    fun 갈_곳이_없는_목적지_묻기에서_응은_알아듣지_못한_것이다() {
        schedules = emptyList()
        newSession()
        session.handle(Event.Boarded)
        val first = session.handle(Event.Heard("응"))
        assertEquals(Effect.Speak("다시 말해 줄래요? '응'이나 '아니'로요.", thenListen = true), first.one<Effect.Speak>())
        assertTrue(first.none { it is Effect.StartRoute || it is Effect.CollapseCard })
        val second = session.handle(Event.Heard("응"))
        assertEquals("화면에서 눌러 주세요.", second.one<Effect.ShowCard>().card.notice)

        schedules = listOf(schedule("d", "치과", 30, null))
        newSession()
        session.handle(Event.Boarded)
        assertEquals("다시 말해 줄래요? '응'이나 '아니'로요.", session.handle(Event.Heard("응")).one<Effect.Speak>().text)
    }

    @Test
    fun Suspend_뒤에는_길안내_결과를_알리지_않는다() {
        boardWithCard()
        session.handle(Event.PrimaryPressed)
        session.handle(Event.SuspendRequested)
        assertEquals(emptyList<Effect>(), session.handle(Event.RouteRequestResult(true)))
    }

    @Test
    fun 정차가_아니면_카드_안의_말도_하지_않는다() {
        boardWithCard()
        session.handle(Event.GearChanged(Gear.UNKNOWN))
        val out = session.handle(Event.Heard("다른 데"))
        assertEquals("다른 곳은 찾지 못했어요.", out.one<Effect.ShowCard>().card.notice)
        assertTrue(out.none { it is Effect.Speak })
    }

    @Test
    fun 초기화하면_결과_한_줄을_지운다() {
        boardWithCard()
        session.handle(Event.PrimaryPressed)
        session.handle(Event.RouteRequestResult(true))
        assertEquals("", session.handle(Event.Reset).one<Effect.ShowResult>().text)
    }

    @Test
    fun 카드는_30초_뒤_접힌다() {
        val timer = boardWithCard().one<Effect.ScheduleCardTimeout>()
        val out = session.handle(Event.CardTimedOut(timer.timerId))
        assertEquals(Effect.CollapseCard(instant = false), out.one<Effect.CollapseCard>())
        assertTrue(out.has<Effect.StopVoice>())
    }

    @Test
    fun 같은_날_두_번째_탑승은_대상_일정_한_줄로_다시_묻는다() {
        val timer = boardWithCard().one<Effect.ScheduleCardTimeout>()
        session.handle(Event.CardTimedOut(timer.timerId))
        clock.now += Duration.ofMinutes(1)
        val card = boardWithCard().one<Effect.ShowCard>().card
        // 5장 재탑승: 대상 일정 한 줄. 종일 인사·오늘 일정 타일·캘린더 메모는 첫 탑승에만 쓴다.
        assertEquals("12시 40분 고객 미팅까지 39분이에요.", card.voice)
        assertEquals("출발할까요?", card.sub)
        assertTrue(card.tiles.isEmpty())
        assertEquals("응, 출발", card.primary)
    }

    @Test
    fun 늦으면_늦는다고_말하고_일정을_늦음으로_기록한다() {
        val out = boardWithCard(travel = Duration.ofMinutes(60))
        val card = out.one<Effect.ShowCard>().card
        assertEquals("고객 미팅이 12시 40분인데 지금 출발하면 1시 도착이에요.", card.voice)
        // 출발 제안과 같은 질문·버튼·힌트
        assertEquals("출발할까요?", card.sub)
        assertEquals("응, 출발", card.primary)
        assertEquals("잠깐만", card.secondary)
        assertEquals(listOf("“응”이라고 말해도 돼요", "출발하면 자동으로 접혀요"), card.hints)
        assertEquals(ScheduleStatus.LATE, out.one<Effect.Save>().snapshot.statuses["a"])
        // 묻고 듣는다. 길안내는 수락할 때까지 요청하지 않는다.
        assertEquals(
            Effect.Speak("고객 미팅이 12시 40분인데 지금 출발하면 1시 도착이에요. 출발할까요?", thenListen = true),
            out.one<Effect.Speak>(),
        )
        assertTrue(out.none { it is Effect.StartRoute })
        assertTrue(!Phrases.spoken(card).contains("길안내를 시작할게요."))
    }

    @Test
    fun 늦게_타도_수락하면_길안내를_요청하고_결과를_알린다() {
        boardWithCard(travel = Duration.ofMinutes(60))
        val out = session.handle(Event.Heard("응"))
        assertEquals(gangnam, out.one<Effect.StartRoute>().place)
        val done = session.handle(Event.RouteRequestResult(true))
        assertEquals("길안내를 시작할게요.", done.one<Effect.ShowResult>().text)
        assertEquals("길안내를 시작할게요.", done.one<Effect.Speak>().text)
    }

    @Test
    fun 늦게_타고_수락했는데_경로_요청이_실패하면_실패를_알린다() {
        boardWithCard(travel = Duration.ofMinutes(60))
        session.handle(Event.PrimaryPressed)
        val out = session.handle(Event.RouteRequestResult(false))
        assertEquals("길안내를 시작하지 못했어요.", out.one<Effect.ShowResult>().text)
        assertEquals("길안내를 시작하지 못했어요.", out.one<Effect.Speak>().text)
    }

    @Test
    fun 늦게_탐_카드의_잠깐만도_보류다() {
        boardWithCard(travel = Duration.ofMinutes(60))
        val out = session.handle(Event.SecondaryPressed)
        assertTrue(out.none { it is Effect.CollapseCard || it is Effect.StartRoute })
        assertEquals(Rules.CARD_TIMEOUT, out.one<Effect.ScheduleCardTimeout>().delay)
    }

    @Test
    fun 늦게_타고_소요_시간을_모르면_이미_지난_시간만_말한다() {
        clock.now = start + Duration.ofMinutes(52)
        val out = boardWithCard(travel = null)
        assertEquals("고객 미팅이 12시 40분인데 이미 12분 지났어요.", out.one<Effect.ShowCard>().card.voice)
        assertTrue(out.none { it is Effect.StartRoute })
    }

    @Test
    fun 출발까지_여유가_많으면_제안_장소를_후보로_묻는다() {
        schedules = listOf(schedule("c", "저녁 모임", 300, cityHall))
        newSession()
        val card = boardWithCard(travel = Duration.ofMinutes(20)).one<Effect.ShowCard>().card
        assertEquals("어디로 갈까요? 5시 저녁 모임은 4시 30분에 출발하면 돼요.", card.voice)
        assertEquals("서울시청으로", card.primary)
        assertEquals("그냥 갈게", card.secondary)

        assertEquals(cityHall, session.handle(Event.Heard("서울시청")).one<Effect.StartRoute>().place)
    }

    @Test
    fun 후보는_응과_버튼_모두_같은_길안내가_된다() {
        schedules = listOf(schedule("c", "저녁 모임", 300, cityHall))
        newSession()
        boardWithCard(travel = Duration.ofMinutes(20))
        assertEquals(cityHall, session.handle(Event.Heard("응")).one<Effect.StartRoute>().place)

        newSession()
        boardWithCard(travel = Duration.ofMinutes(20))
        assertEquals(cityHall, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)
    }

    @Test
    fun 응과_후보_이름이_같이_들려도_그_후보로_진행한다() {
        schedules = listOf(schedule("c", "저녁 모임", 300, cityHall))
        newSession()
        boardWithCard(travel = Duration.ofMinutes(20))
        assertEquals(cityHall, session.handle(Event.Heard("응, 서울시청")).one<Effect.StartRoute>().place)
    }

    @Test
    fun 후보가_아닌_장소_이름은_알아듣지_못한_것이다() {
        schedules = listOf(schedule("c", "저녁 모임", 300, cityHall))
        newSession()
        boardWithCard(travel = Duration.ofMinutes(20))
        val out = session.handle(Event.Heard("강남역"))
        assertEquals("다시 말해 줄래요? '응'이나 '아니'로요.", out.one<Effect.Speak>().text)
        assertTrue(out.none { it is Effect.StartRoute })
    }

    @Test
    fun 일정이_없으면_어디로_갈까요를_묻고_그냥_갈게로_접는다() {
        schedules = emptyList()
        newSession()
        val out = session.handle(Event.Boarded)
        val card = out.one<Effect.ShowCard>().card
        assertEquals("어디로 갈까요?", card.voice)
        assertNull(card.primary)
        assertEquals("그냥 갈게", card.secondary)
        // "그냥 갈게"는 거절과 같다: 카드를 접고 길안내는 하지 않으며 다시 묻지 않는다.
        val timer = out.one<Effect.ScheduleCardTimeout>()
        val pressed = session.handle(Event.SecondaryPressed)
        assertTrue(pressed.has<Effect.CollapseCard>())
        assertTrue(pressed.none { it is Effect.StartRoute || it is Effect.Speak || it is Effect.ShowCard })
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(timer.timerId)))
    }

    @Test
    fun 장소를_모르면_일정_제목으로_묻는다() {
        schedules = listOf(schedule("d", "치과", 30, null))
        newSession()
        val card = session.handle(Event.Boarded).one<Effect.ShowCard>().card
        assertEquals("'치과' 어디로 가면 될까요?", card.voice)
        assertNull(card.primary)
        assertEquals("그냥 갈게", card.secondary)
    }

    @Test
    fun 날짜가_바뀌면_일정_상태를_비운다() {
        val late = boardWithCard(travel = Duration.ofMinutes(60))
        assertEquals(ScheduleStatus.LATE, late.one<Effect.Save>().snapshot.statuses["a"])
        clock.now += Duration.ofDays(1)
        schedules = listOf(schedule("a", "고객 미팅", 24 * 60 + 40, gangnam))
        val out = session.handle(Event.Resumed)
        assertTrue(out.one<Effect.Save>().snapshot.statuses.isEmpty())
    }

    @Test
    fun 저장한_상태로_복원한다() {
        val snapshot = Snapshot(BoardingLog(), mapOf("a" to ScheduleStatus.ARRIVED), day)
        newSession(snapshot)
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        assertEquals(cityHall, request.place)
    }

    @Test
    fun 초기화하면_상태와_기록을_비운다() {
        boardWithCard(travel = Duration.ofMinutes(60))
        val out = session.handle(Event.Reset)
        assertTrue(out.has<Effect.StopVoice>())
        assertTrue(out.one<Effect.Save>().snapshot.statuses.isEmpty())
        assertEquals(null, out.one<Effect.Save>().snapshot.log.lastBoardedOn)
    }

    // ---- 정차 중에만 말하기 ----

    @Test
    fun 기어를_모르면_탑승해도_카드를_띄우지_않는다() {
        newSession(gear = null)
        val out = session.handle(Event.Boarded)
        assertTrue(out.none { it is Effect.RequestTravelTime || it is Effect.ShowCard || it is Effect.Speak })
        assertTrue(session.handle(Event.AppEntered).none { it is Effect.RequestTravelTime })
        assertTrue(session.handle(Event.IgnitionChanged(Ignition.ON)).none { it is Effect.RequestTravelTime })
    }

    @Test
    fun 기어가_UNKNOWN으로_바뀌면_탑승_판단_결과를_버린다() {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        session.handle(Event.GearChanged(Gear.UNKNOWN))
        assertTrue(session.handle(Event.TravelTimeResult(request.requestId, null)).none { it is Effect.ShowCard })
    }

    @Test
    fun 카드가_없어도_주행이_시작되면_말하던_것을_멈춘다() {
        val out = session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(out.has<Effect.StopVoice>())
        // 주행이 이어지는 동안 같은 상태가 다시 들어와도 매번 멈추라고 하지 않는다.
        assertTrue(session.handle(Event.RestrictionChanged(true)).none { it is Effect.StopVoice })
    }

    // ---- 앱 진입 탑승 규칙 ----

    @Test
    fun 앱_첫_진입은_탑승이고_주행_없이_다시_들어오면_무시한다() {
        val request = session.handle(Event.AppEntered).one<Effect.RequestTravelTime>()
        val timer = session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ScheduleCardTimeout>()
        session.handle(Event.CardTimedOut(timer.timerId))
        clock.now += Duration.ofMinutes(30)
        assertEquals(emptyList<Effect>(), session.handle(Event.AppEntered))
    }

    @Test
    fun 주행하고_P단에_넣은_뒤_다시_들어오면_잠깐_정차는_침묵하고_10분이_지나면_재탑승으로_묻는다() {
        val request = session.handle(Event.AppEntered).one<Effect.RequestTravelTime>()
        val timer = session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ScheduleCardTimeout>()
        session.handle(Event.CardTimedOut(timer.timerId))

        park()
        // 10분이 안 지났으면 잠깐 정차
        clock.now += Duration.ofMinutes(3)
        assertEquals(emptyList<Effect>(), session.handle(Event.AppEntered))
        // 10분이 지나면 재탑승: 대상 일정을 다시 본다(한 줄 카드).
        clock.now += Duration.ofMinutes(10)
        assertEquals(gangnam, session.handle(Event.AppEntered).one<Effect.RequestTravelTime>().place)
    }

    @Test
    fun 다음_날_첫_진입은_다시_첫_탑승이다() {
        val request = session.handle(Event.AppEntered).one<Effect.RequestTravelTime>()
        session.handle(Event.TravelTimeResult(request.requestId, null))
        session.handle(Event.Heard("아니"))
        clock.now += Duration.ofDays(1)
        schedules = listOf(schedule("n", "다음 날 미팅", 24 * 60 + 60, gangnam))
        val next = session.handle(Event.AppEntered).one<Effect.RequestTravelTime>()
        assertEquals(gangnam, next.place)
    }

    @Test
    fun 판단_중_D가_되어_카드가_안_뜨면_그날_첫_탑승을_소진하지_않는다() {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(session.handle(Event.TravelTimeResult(request.requestId, null)).none { it is Effect.Save && it.snapshot.log.lastBoardedOn != null })
        session.handle(Event.GearChanged(Gear.PARK))
        clock.now += Duration.ofMinutes(11)
        val again = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        val card = session.handle(Event.TravelTimeResult(again.requestId, null)).one<Effect.ShowCard>().card
        assertTrue(card.voice.startsWith("12시 40분 고객 미팅까지"))
    }

    // ---- P단 기록 ----

    @Test
    fun D에서_N을_거쳐_P가_되어도_잠깐_정차로_본다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        val out = session.handle(Event.GearChanged(Gear.PARK))
        assertNotNull(out.one<Effect.Save>().snapshot.log.lastParkedAt)
        clock.now += Duration.ofMinutes(3)
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    // ---- 시동 신호 ----

    @Test
    fun 시동이_이미_ON인_채_시작하면_그날_탑승_기록이_없을_때만_한_번_탑승한다() {
        assertTrue(session.handle(Event.IgnitionChanged(Ignition.ON)).has<Effect.RequestTravelTime>())

        // 이미 탑승 기록이 있는 날이면 탑승으로 보지 않는다.
        newSession(Snapshot(BoardingLog(lastBoardedOn = day), emptyMap(), day))
        assertTrue(session.handle(Event.IgnitionChanged(Ignition.ON)).none { it is Effect.RequestTravelTime })
    }

    @Test
    fun OFF_LOCK_ACC에서_ON이_되면_탑승이고_START를_거친_ON은_탑승이_아니다() {
        val yesterday = Snapshot(BoardingLog(lastBoardedOn = day.minusDays(1)), emptyMap(), day)
        for (before in listOf(Ignition.OFF, Ignition.LOCK, Ignition.ACC)) {
            newSession(yesterday)
            session.handle(Event.IgnitionChanged(before))
            val out = session.handle(Event.IgnitionChanged(Ignition.ON))
            assertTrue("$before → ON", out.has<Effect.RequestTravelTime>())
        }

        newSession(yesterday)
        session.handle(Event.IgnitionChanged(Ignition.ON))
        session.handle(Event.IgnitionChanged(Ignition.START))
        assertTrue(session.handle(Event.IgnitionChanged(Ignition.ON)).none { it is Effect.RequestTravelTime })
    }

    @Test
    fun 같은_날_시동을_다시_켜는_두_번째_탑승은_대상_일정을_다시_본다() {
        newSession(Snapshot(BoardingLog(lastBoardedOn = day), emptyMap(), day))
        session.handle(Event.IgnitionChanged(Ignition.OFF))
        assertEquals(gangnam, session.handle(Event.IgnitionChanged(Ignition.ON)).one<Effect.RequestTravelTime>().place)
    }

    // ---- Suspend ----

    @Test
    fun 시동_OFF는_재생_중단_상태_저장_어댑터_해제_순서로_낸다() {
        boardWithCard()
        val out = session.handle(Event.IgnitionChanged(Ignition.OFF))
        val order = out.map { it::class }
        assertTrue(order.indexOf(Effect.StopVoice::class) < order.indexOf(Effect.Save::class))
        assertTrue(order.indexOf(Effect.Save::class) < order.indexOf(Effect.EnterSuspend::class))
        assertEquals(Effect.EnterSuspend, out.last())
        assertEquals(Effect.CollapseCard(instant = true), out.one<Effect.CollapseCard>())
    }

    @Test
    fun 카드가_없어도_Suspend_진입은_음성을_멈추고_저장하고_해제한다() {
        val out = session.handle(Event.SuspendRequested)
        assertTrue(out.has<Effect.StopVoice>())
        assertTrue(out.has<Effect.Save>())
        assertEquals(Effect.EnterSuspend, out.last())
        // 이미 Suspend면 다시 내지 않는다.
        assertEquals(emptyList<Effect>(), session.handle(Event.IgnitionChanged(Ignition.LOCK)))
    }

    @Test
    fun Suspend_뒤에는_새_말하기와_탑승_판단을_막는다() {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        session.handle(Event.SuspendRequested)
        assertTrue(session.handle(Event.TravelTimeResult(request.requestId, null)).none { it is Effect.ShowCard || it is Effect.Speak })
        assertTrue(session.handle(Event.Boarded).none { it is Effect.RequestTravelTime || it is Effect.Speak })
        assertTrue(session.handle(Event.AppEntered).none { it is Effect.RequestTravelTime })
    }

    @Test
    fun Resume은_어댑터만_되살리고_자동으로_말하지_않는다() {
        session.handle(Event.SuspendRequested)
        val out = session.handle(Event.Resumed)
        assertEquals(Effect.ExitSuspend, out.first())
        assertTrue(out.none { it is Effect.Speak || it is Effect.ShowCard || it is Effect.RequestTravelTime })
    }

    @Test
    fun Suspend_뒤_시동이_켜지면_어댑터를_되살린_다음_탑승을_판단한다() {
        session.handle(Event.IgnitionChanged(Ignition.OFF))
        val out = session.handle(Event.IgnitionChanged(Ignition.ON))
        val order = out.map { it::class }
        assertTrue(order.indexOf(Effect.ExitSuspend::class) < order.indexOf(Effect.RequestTravelTime::class))
    }

    // ---- 종일 일정 ----

    private fun allDay(title: String = "광주 직관") =
        Schedule("all", title, start, start + Duration.ofHours(24), allDay = true)

    @Test
    fun 종일_일정은_길안내_대상에서_빠지고_탑승_인사에만_쓴다() {
        schedules = listOf(allDay(), schedule("a", "고객 미팅", 40, gangnam, "계약서 2부"), schedule("b", "점심 약속", 180, cityHall))
        newSession()
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        assertEquals(gangnam, request.place)
        val card = session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ShowCard>().card
        assertEquals("광주 직관 날이에요!\n12시 40분 고객 미팅까지 40분이에요.", card.voice)
        // 오늘 일정 타일에도 종일 일정은 없다.
        val tile = card.tiles.first() as com.chagok.car.ui.TileView.Schedules
        assertEquals(listOf("고객 미팅", "점심 약속"), tile.rows.map { it.title })
    }

    @Test
    fun 종일_일정만_있으면_어디로_갈까요를_묻는다() {
        schedules = listOf(allDay())
        newSession()
        val out = session.handle(Event.Boarded)
        assertEquals("어디로 갈까요?", out.one<Effect.ShowCard>().card.voice)
        assertTrue(out.none { it is Effect.RequestTravelTime })
    }

    // ---- 접는 방식 ----

    @Test
    fun 주행_제한과_D는_바로_접고_버튼으로_접을_때는_애니메이션이_있다() {
        boardWithCard()
        assertEquals(Effect.CollapseCard(instant = true), session.handle(Event.RestrictionChanged(true)).one<Effect.CollapseCard>())

        newSession()
        boardWithCard()
        assertEquals(Effect.CollapseCard(instant = true), session.handle(Event.GearChanged(Gear.DRIVE)).one<Effect.CollapseCard>())

        newSession()
        boardWithCard()
        assertEquals(Effect.CollapseCard(instant = false), session.handle(Event.PrimaryPressed).one<Effect.CollapseCard>())
    }

    private val home = Favorite(FavoriteKind.HOME, Place("예시 아파트", LatLng(37.55, 126.92)))
    private val work = Favorite(FavoriteKind.WORK, Place("예시타워", LatLng(37.50, 127.04)))
    private val station = Favorite(FavoriteKind.OTHER, Place("서울역", LatLng(37.55, 126.97)), "서울 중구 한강대로 405")

    /** 일정이 없는 날 자주 가는 곳을 둔 채 탑승한다. 대상 일정이 없어 소요 시간을 묻지 않고 바로 카드를 띄운다. */
    private fun boardOnEmptyDay(vararg places: Favorite): List<Effect> {
        schedules = emptyList()
        favorites = places.toList()
        newSession()
        return session.handle(Event.Boarded)
    }

    private fun candidateNames(effects: List<Effect>) =
        (effects.one<Effect.ShowCard>().card.tiles.single() as TileView.Candidates).rows.map { it.name }

    @Test
    fun 일정이_없는_날_자주_가는_곳을_후보로_보이고_주_버튼은_1번_후보로_길안내한다() {
        val out = boardOnEmptyDay(home, work, station)
        val card = out.one<Effect.ShowCard>().card
        assertEquals("어디로 갈까요?", card.voice)
        assertEquals("집으로", card.primary)
        assertEquals(listOf("집", "회사", "서울역"), candidateNames(out))
        assertTrue(out.one<Effect.Speak>().thenListen)
        assertEquals(home.destination, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)
    }

    @Test
    fun 후보_줄을_누르면_그_후보로_길안내하고_없는_번호는_무시한다() {
        boardOnEmptyDay(home, work)
        assertEquals(emptyList<Effect>(), session.handle(Event.CandidatePressed(2)))
        val out = session.handle(Event.CandidatePressed(1))
        assertEquals(work.place, out.one<Effect.StartRoute>().place)
        assertTrue(out.has<Effect.CollapseCard>())
        // 카드가 접힌 뒤의 누름은 무시한다.
        assertEquals(emptyList<Effect>(), session.handle(Event.CandidatePressed(0)))
    }

    @Test
    fun 후보는_이름이나_순서로_말해_고르고_응은_1번_후보다() {
        boardOnEmptyDay(home, work, station)
        assertEquals(work.place, session.handle(Event.Heard("회사로 가자")).one<Effect.StartRoute>().place)
        boardOnEmptyDay(home, work, station)
        assertEquals(station.place, session.handle(Event.Heard("세 번째")).one<Effect.StartRoute>().place)
        boardOnEmptyDay(home, work, station)
        assertEquals(home.destination, session.handle(Event.Heard("응")).one<Effect.StartRoute>().place)
    }

    @Test
    fun 자주_가는_곳이_없는_날은_후보_없이_묻고_응은_다시_묻는다() {
        val card = boardOnEmptyDay().one<Effect.ShowCard>().card
        assertNull(card.primary)
        assertTrue(card.tiles.isEmpty())
        val out = session.handle(Event.Heard("응"))
        assertTrue(!out.has<Effect.StartRoute>())
        assertEquals(Phrases.ASK_AGAIN, out.one<Effect.Speak>().text)
    }

    @Test
    fun 여유가_많은_날은_일정_장소_뒤에_자주_가는_곳이_붙고_같은_곳은_빠진다() {
        schedules = listOf(schedule("c", "저녁 약속", 300, cityHall))
        favorites = listOf(Favorite(FavoriteKind.WORK, cityHall), home)
        newSession()
        val out = boardWithCard(travel = Duration.ofMinutes(30))
        assertEquals(listOf("서울시청", "집"), candidateNames(out))
        assertEquals("서울시청으로", out.one<Effect.ShowCard>().card.primary)
        assertEquals(home.destination, session.handle(Event.CandidatePressed(1)).one<Effect.StartRoute>().place)
    }

    // ---- 도착 → 다음 일정 ----

    /** 대상 일정(고객 미팅, 강남역) 300m 안·밖의 위치. 위도 0.001도는 약 111m다. */
    private val nearGangnam = LatLng(gangnam.position.lat + 0.002, gangnam.position.lng)
    private val farFromGangnam = LatLng(gangnam.position.lat + 0.003, gangnam.position.lng)

    private fun statusOf(out: List<Effect>, id: String) = out.one<Effect.Save>().snapshot.statuses[id]

    /** 출발 제안을 받아 길안내를 시작하고 출발한다. */
    private fun departAndDrive() {
        boardWithCard()
        assertEquals(gangnam, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)
        session.handle(Event.RouteRequestResult(true))
        session.handle(Event.GearChanged(Gear.DRIVE))
    }

    @Test
    fun 길안내한_일정에_내비가_도착을_알리면_도착이고_다시_타면_다음_일정을_한_줄로_묻는다() {
        departAndDrive()
        clock.now += Duration.ofMinutes(30)
        val arrived = session.handle(Event.DestinationArrived)
        assertEquals(ScheduleStatus.ARRIVED, statusOf(arrived, "a"))
        // 주행 중 도착이라도 이 순간 하차 카드를 한 번 말한다(사용자 결정 2026-11-15). 이어지는 P단에는 같은 카드가 다시 뜨지 않는다.
        assertEquals(1, arrived.count { it is Effect.ShowCard })
        assertEquals(1, arrived.count { it is Effect.Speak })
        val parked = session.handle(Event.GearChanged(Gear.PARK))
        assertTrue(parked.none { it is Effect.Speak || it is Effect.ShowCard })

        // 잠깐 정차(10분)가 지나 다시 타면 다음 일정(점심 약속)을 한 줄로 묻는다.
        clock.now += Duration.ofMinutes(20)
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        assertEquals(cityHall, request.place)
        val card = session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ShowCard>().card
        assertEquals("3시 점심 약속까지 2시간 10분이에요.", card.voice)
        assertEquals("출발할까요?", card.sub)
        assertTrue(card.tiles.isEmpty())
    }

    @Test
    fun 다시_탔어도_잠깐_정차면_말하지_않는다() {
        departAndDrive()
        session.handle(Event.DestinationArrived)
        session.handle(Event.GearChanged(Gear.PARK))
        clock.now += Duration.ofMinutes(5)
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    @Test
    fun 주행_중_받은_위치가_대상_일정_300m_안이면_P단에_넣을_때_도착이다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.LocationChanged(nearGangnam))
        val parked = session.handle(Event.GearChanged(Gear.PARK))
        assertEquals(ScheduleStatus.ARRIVED, statusOf(parked, "a"))
        assertTrue(parked.none { it is Effect.RequestLocation })
    }

    @Test
    fun P단에_넣으면_위치를_묻고_답이_300m_안이면_도착_밖이면_그대로다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(session.handle(Event.GearChanged(Gear.PARK)).has<Effect.RequestLocation>())
        assertTrue(session.handle(Event.LocationChanged(farFromGangnam)).none { it is Effect.Save })

        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(session.handle(Event.GearChanged(Gear.PARK)).has<Effect.RequestLocation>())
        assertEquals(ScheduleStatus.ARRIVED, statusOf(session.handle(Event.LocationChanged(nearGangnam)), "a"))
    }

    @Test
    fun 주행을_시작하면_전에_받은_위치는_도착_판단에_쓰지_않는다() {
        session.handle(Event.LocationChanged(nearGangnam))
        session.handle(Event.GearChanged(Gear.DRIVE))
        val parked = session.handle(Event.GearChanged(Gear.PARK))
        assertTrue(parked.has<Effect.RequestLocation>())
        assertTrue(parked.none { it is Effect.Save && it.snapshot.statuses.isNotEmpty() })
    }

    @Test
    fun 차곡이_길안내하지_않은_곳의_도착_알림은_무시한다() {
        boardWithCard()
        assertTrue(session.handle(Event.DestinationArrived).none { it is Effect.Save })
        // 자주 가는 곳으로 간 길안내의 도착도 일정 도착이 아니다.
        schedules = emptyList()
        favorites = listOf(home)
        newSession()
        session.handle(Event.Boarded)
        assertEquals(home.destination, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)
        assertTrue(session.handle(Event.DestinationArrived).none { it is Effect.Save })
    }
}
