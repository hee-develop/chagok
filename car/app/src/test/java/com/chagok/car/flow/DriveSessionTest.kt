package com.chagok.car.flow

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.domain.ScheduleStatus
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
        session = DriveSession(clock, { ScheduleSnapshot(schedules) }, restored)
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
    fun 첫_탑승은_카드를_띄우고_말한다() {
        val boarded = session.handle(Event.Boarded)
        val request = boarded.one<Effect.RequestTravelTime>()
        assertEquals(gangnam, request.place)
        // 탑승 기록은 카드를 실제로 띄울 때 남긴다.
        assertTrue(!boarded.has<Effect.Save>())

        val out = session.handle(Event.TravelTimeResult(request.requestId, null))
        assertEquals(day, out.one<Effect.Save>().snapshot.log.lastBoardedOn)
        val card = out.one<Effect.ShowCard>().card
        assertEquals("12시 40분 고객 미팅까지 40분이에요.", card.voice)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요. 챙기셨어요?", card.sub)
        assertNull(card.primary)
        assertEquals("닫기", card.secondary)
        val speak = out.one<Effect.Speak>()
        assertEquals("12시 40분 고객 미팅까지 40분이에요. 고객 미팅 메모에 ‘계약서 2부’가 있어요. 챙기셨어요?", speak.text)
        assertEquals(Rules.CARD_TIMEOUT, out.one<Effect.ScheduleCardTimeout>().delay)
    }

    @Test
    fun 소요_시간을_모르면_출발을_제안한다() {
        val out = boardWithCard(travel = null)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요. 챙기셨어요?", out.one<Effect.ShowCard>().card.sub)
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
    fun 닫기_버튼은_음성을_멈추고_카드를_접는다() {
        val timer = boardWithCard().one<Effect.ScheduleCardTimeout>()
        val out = session.handle(Event.CloseRequested)
        assertTrue(out.has<Effect.StopVoice>())
        assertEquals(Effect.CollapseCard(instant = false), out.one<Effect.CollapseCard>())
        // 닫힌 카드의 타이머와 닫기는 아무 일도 하지 않는다.
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(timer.timerId)))
        assertEquals(emptyList<Effect>(), session.handle(Event.CloseRequested))
    }

    @Test
    fun 카드는_30초_뒤_접힌다() {
        val timer = boardWithCard().one<Effect.ScheduleCardTimeout>()
        val out = session.handle(Event.CardTimedOut(timer.timerId))
        assertEquals(Effect.CollapseCard(instant = false), out.one<Effect.CollapseCard>())
        assertTrue(out.has<Effect.StopVoice>())
    }

    @Test
    fun 같은_날_두_번째_탑승은_아무_반응이_없다() {
        val timer = boardWithCard().one<Effect.ScheduleCardTimeout>()
        session.handle(Event.CardTimedOut(timer.timerId))
        clock.now += Duration.ofMinutes(1)
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    @Test
    fun 늦으면_늦는다고_말하고_일정을_늦음으로_기록한다() {
        val out = boardWithCard(travel = Duration.ofMinutes(60))
        val card = out.one<Effect.ShowCard>().card
        assertEquals("고객 미팅이 12시 40분인데 지금 출발하면 1시 도착이에요.", card.voice)
        assertNull(card.sub)
        assertNull(card.primary)
        assertEquals("닫기", card.secondary)
        assertEquals(ScheduleStatus.LATE, out.one<Effect.Save>().snapshot.statuses["a"])
        assertEquals(Effect.Speak("고객 미팅이 12시 40분인데 지금 출발하면 1시 도착이에요."), out.one<Effect.Speak>())
    }

    @Test
    fun 늦게_타고_소요_시간을_모르면_이미_지난_시간만_말한다() {
        clock.now = start + Duration.ofMinutes(52)
        val out = boardWithCard(travel = null)
        assertEquals("고객 미팅이 12시 40분인데 이미 12분 지났어요.", out.one<Effect.ShowCard>().card.voice)
    }

    @Test
    fun 출발까지_여유가_많으면_제안_장소를_후보로_묻는다() {
        schedules = listOf(schedule("c", "저녁 모임", 300, cityHall))
        newSession()
        val card = boardWithCard(travel = Duration.ofMinutes(20)).one<Effect.ShowCard>().card
        assertEquals("어디로 갈까요? 5시 저녁 모임은 4시 30분에 출발하면 돼요.", card.voice)
        assertNull(card.primary)
        assertEquals("닫기", card.secondary)
    }

    @Test
    fun 일정이_없으면_어디로_갈까요를_묻고_닫기로_접는다() {
        schedules = emptyList()
        newSession()
        val out = session.handle(Event.Boarded)
        val card = out.one<Effect.ShowCard>().card
        assertEquals("어디로 갈까요?", card.voice)
        assertNull(card.primary)
        assertEquals("닫기", card.secondary)
        val timer = out.one<Effect.ScheduleCardTimeout>()
        assertTrue(session.handle(Event.CloseRequested).has<Effect.CollapseCard>())
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(timer.timerId)))
    }

    @Test
    fun 장소를_모르면_일정_제목으로_묻는다() {
        schedules = listOf(schedule("d", "치과", 30, null))
        newSession()
        val card = session.handle(Event.Boarded).one<Effect.ShowCard>().card
        assertEquals("'치과' 어디로 가면 될까요?", card.voice)
        assertNull(card.primary)
        assertEquals("닫기", card.secondary)
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
    fun 주행하고_P단에_넣은_뒤_다시_들어와도_두_번째_탑승은_아무_반응이_없다() {
        val request = session.handle(Event.AppEntered).one<Effect.RequestTravelTime>()
        val timer = session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ScheduleCardTimeout>()
        session.handle(Event.CardTimedOut(timer.timerId))

        park()
        // 10분이 안 지났으면 잠깐 정차
        clock.now += Duration.ofMinutes(3)
        assertEquals(emptyList<Effect>(), session.handle(Event.AppEntered))
        clock.now += Duration.ofMinutes(10)
        assertEquals(emptyList<Effect>(), session.handle(Event.AppEntered))
    }

    @Test
    fun 다음_날_첫_진입은_다시_첫_탑승이다() {
        val request = session.handle(Event.AppEntered).one<Effect.RequestTravelTime>()
        session.handle(Event.TravelTimeResult(request.requestId, null))
        session.handle(Event.CloseRequested)
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
    fun 같은_날_시동을_다시_켜는_두_번째_탑승은_아무_반응이_없다() {
        newSession(Snapshot(BoardingLog(lastBoardedOn = day), emptyMap(), day))
        session.handle(Event.IgnitionChanged(Ignition.OFF))
        assertTrue(session.handle(Event.IgnitionChanged(Ignition.ON)).none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
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
    fun 주행_제한과_D는_바로_접고_닫기_버튼은_애니메이션이_있다() {
        boardWithCard()
        assertEquals(Effect.CollapseCard(instant = true), session.handle(Event.RestrictionChanged(true)).one<Effect.CollapseCard>())

        newSession()
        boardWithCard()
        assertEquals(Effect.CollapseCard(instant = true), session.handle(Event.GearChanged(Gear.DRIVE)).one<Effect.CollapseCard>())

        newSession()
        boardWithCard()
        assertEquals(Effect.CollapseCard(instant = false), session.handle(Event.CloseRequested).one<Effect.CollapseCard>())
    }
}
