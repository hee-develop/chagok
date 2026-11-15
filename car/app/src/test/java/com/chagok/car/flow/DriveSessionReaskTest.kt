package com.chagok.car.flow

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.PendingReask
import com.chagok.car.domain.Place
import com.chagok.car.domain.ReaskKind
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.runtime.SnapshotCodec
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

/**
 * 무응답·보류 뒤 다시 묻기와 대안(정책서 6장 '무응답', 7장 '보류'·'거절'·'대안'). 계약은 docs/reask.md.
 * 질문 카드가 30초 동안 대답 없이 접히면(보류한 뒤 접힌 것 포함) 그 질문을 저장해 두고, 다음 정차(달린 뒤 넣은 P단, 잠깐 정차 P단 제외)
 * 또는 다음 탑승 판단 때 그 시점의 판단으로 만든 질문을 한 번만 다시 묻는다.
 */
class DriveSessionReaskTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = MutableClock(start)
    private lateinit var schedules: List<Schedule>
    private var favorites: List<Favorite> = emptyList()
    private var origin = ScheduleOrigin.FRESH
    private lateinit var session: DriveSession

    private val day get() = start.atZone(ZoneOffset.UTC).toLocalDate()

    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val cityHall = Place("서울시청", LatLng(37.5663, 126.9779))
    private val home = Favorite(FavoriteKind.HOME, Place("예시 아파트", LatLng(37.55, 126.92)))
    private val work = Favorite(FavoriteKind.WORK, Place("예시타워", LatLng(37.50, 127.04)))
    private val station = Favorite(FavoriteKind.OTHER, Place("서울역", LatLng(37.55, 126.97)), "서울 중구 한강대로 405")

    private fun schedule(id: String, title: String, startMin: Long, place: Place?, lengthMin: Long = 60) = Schedule(
        id = id,
        title = title,
        start = start + Duration.ofMinutes(startMin),
        end = start + Duration.ofMinutes(startMin + lengthMin),
        place = place,
    )

    @Before
    fun setUp() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam), schedule("b", "점심 약속", 180, cityHall))
        newSession()
    }

    private fun newSession(restored: Snapshot? = null, gear: Gear? = Gear.PARK) {
        session = DriveSession(clock, { ScheduleSnapshot(schedules, origin, favorites) }, restored)
        gear?.let { session.handle(Event.GearChanged(it)) }
    }

    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()
    private inline fun <reified T : Effect> List<Effect>.has() = any { it is T }
    private fun List<Effect>.lastSnapshot() = filterIsInstance<Effect.Save>().last().snapshot
    private fun List<Effect>.card() = filterIsInstance<Effect.ShowCard>().last().card

    /** 탑승 → 소요 시간 응답까지 진행해 카드를 띄운다. */
    private fun boardWithCard(travel: Duration? = null): List<Effect> {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        return session.handle(Event.TravelTimeResult(request.requestId, travel))
    }

    /** 카드를 띄우고 30초 무응답으로 접는다. 접힌 직후의 효과를 돌려준다. */
    private fun boardAndIgnore(travel: Duration? = null): List<Effect> {
        val timer = boardWithCard(travel).one<Effect.ScheduleCardTimeout>()
        return session.handle(Event.CardTimedOut(timer.timerId))
    }

    private fun drive() = session.handle(Event.GearChanged(Gear.DRIVE))
    private fun park() = session.handle(Event.GearChanged(Gear.PARK))

    /**
     * 달린 뒤 P단에 넣는다. 다시 묻는 질문이 있으면 이 효과에 소요 시간 요청·카드가 나온다.
     * 일정 장소가 시간 창 안이면 세션은 내비에 현재 위치를 묻고 기다리므로(위치로 도착을 판단하는 동안은 다시 묻지 않는다) 내비가 답하지 않은 것으로 보고 3초 타임아웃까지 넣는다.
     */
    private fun driveAndPark(minutes: Long = 5): List<Effect> {
        drive()
        clock.now += Duration.ofMinutes(minutes)
        val parked = park()
        val timer = parked.filterIsInstance<Effect.ScheduleLocationTimeout>().singleOrNull() ?: return parked
        return parked + session.handle(Event.LocationTimedOut(timer.timerId))
    }

    /** P단에 넣고, 위치 답을 기다리면(일정 장소가 시간 창 안) 내비가 답하지 않은 것으로 보고 타임아웃까지 넣는다. [driveAndPark]의 P단 부분. */
    private fun parkWithTimeout(): List<Effect> {
        val parked = park()
        val timer = parked.filterIsInstance<Effect.ScheduleLocationTimeout>().singleOrNull() ?: return parked
        return parked + session.handle(Event.LocationTimedOut(timer.timerId))
    }

    // ---- 접히는 때와 저장 ----

    @Test
    fun 무응답으로_30초_뒤_접히면_그_질문을_다시_물을_질문으로_저장한다() {
        val out = boardAndIgnore()
        assertTrue(out.has<Effect.CollapseCard>())
        assertEquals(PendingReask(ReaskKind.DEPART, "a"), out.lastSnapshot().reask)
    }

    @Test
    fun 보류한_뒤_30초가_지나_접혀도_다시_물을_질문이다() {
        boardWithCard()
        val hold = session.handle(Event.Heard("잠깐만")).one<Effect.ScheduleCardTimeout>()
        val out = session.handle(Event.CardTimedOut(hold.timerId))
        assertEquals(PendingReask(ReaskKind.DEPART, "a"), out.lastSnapshot().reask)
    }

    @Test
    fun 잠깐만_버튼으로_보류한_뒤_접혀도_다시_물을_질문이다() {
        boardWithCard()
        val hold = session.handle(Event.SecondaryPressed).one<Effect.ScheduleCardTimeout>()
        val out = session.handle(Event.CardTimedOut(hold.timerId))
        assertEquals(ReaskKind.DEPART, out.lastSnapshot().reask?.kind)
    }

    @Test
    fun 거절하면_다시_묻지_않는다() {
        boardWithCard()
        val out = session.handle(Event.Heard("아니"))
        assertTrue(out.has<Effect.CollapseCard>())
        assertNull(out.filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.reask)
        // 다음 정차(달린 뒤 P단)에서도 묻지 않는다.
        val parked = driveAndPark(20)
        assertTrue(parked.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
    }

    @Test
    fun 그냥_갈게_버튼도_다시_묻지_않는다() {
        schedules = emptyList()
        favorites = listOf(home)
        newSession()
        session.handle(Event.Boarded)
        session.handle(Event.SecondaryPressed)
        val parked = driveAndPark(20)
        assertTrue(parked.none { it is Effect.ShowCard })
    }

    @Test
    fun 수락하면_다시_묻지_않는다() {
        boardWithCard()
        assertTrue(session.handle(Event.PrimaryPressed).has<Effect.StartRoute>())
        val parked = driveAndPark(20)
        assertTrue(parked.none { it is Effect.ShowCard })
    }

    @Test
    fun 주행이_시작돼_접힌_카드는_다시_묻지_않는다() {
        boardWithCard()
        val out = drive()
        assertTrue(out.has<Effect.CollapseCard>())
        assertNull(out.filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.reask)
        clock.now += Duration.ofMinutes(1)
        assertTrue(park().none { it is Effect.ShowCard })
    }

    @Test
    fun 후보를_묻는_질문과_늦게_탐도_종류별로_저장한다() {
        // 일정 없음 → 후보 묻기(일정 없음)
        schedules = emptyList()
        favorites = listOf(home, work)
        newSession()
        val destination = session.handle(Event.Boarded).one<Effect.ScheduleCardTimeout>()
        assertEquals(PendingReask(ReaskKind.ASK_DESTINATION, null), session.handle(Event.CardTimedOut(destination.timerId)).lastSnapshot().reask)

        // 늦게 탐
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam))
        favorites = emptyList()
        newSession()
        clock.now = start + Duration.ofMinutes(50)
        val late = boardWithCard().one<Effect.ScheduleCardTimeout>()
        assertEquals(PendingReask(ReaskKind.DEPART_LATE, "a"), session.handle(Event.CardTimedOut(late.timerId)).lastSnapshot().reask)
    }

    // ---- 다음 정차(달린 뒤 넣은 P단) ----

    @Test
    fun 달린_뒤_P단에서_한_번_다시_묻고_또_무응답이어도_더_묻지_않는다() {
        boardAndIgnore()
        val parked = driveAndPark(15)
        // 재탑승 한 줄로 판단한다: 소요 시간부터 묻는다.
        val request = parked.one<Effect.RequestTravelTime>()
        val shown = session.handle(Event.TravelTimeResult(request.requestId, null))
        val card = shown.card()
        assertEquals("12시 40분 고객 미팅까지 25분이에요.", card.voice)
        assertEquals("출발할까요?", card.sub)
        assertTrue("재탑승 한 줄이라 타일이 없다", card.tiles.isEmpty())
        assertTrue(shown.one<Effect.Speak>().thenListen)
        // 다시 묻는 카드를 띄우면 저장해 둔 질문은 지운다.
        assertNull(shown.lastSnapshot().reask)

        // 이 카드가 또 무응답이어도 다시 저장하지 않는다.
        val timer = shown.one<Effect.ScheduleCardTimeout>()
        val folded = session.handle(Event.CardTimedOut(timer.timerId))
        assertTrue(folded.has<Effect.CollapseCard>())
        assertNull(folded.filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.reask)
        val again = driveAndPark(40)
        assertTrue(again.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
    }

    @Test
    fun 다시_묻는_카드를_보류한_뒤_접혀도_더_묻지_않는다() {
        boardAndIgnore()
        val request = driveAndPark(15).one<Effect.RequestTravelTime>()
        session.handle(Event.TravelTimeResult(request.requestId, null))
        val hold = session.handle(Event.Heard("이따가")).one<Effect.ScheduleCardTimeout>()
        val folded = session.handle(Event.CardTimedOut(hold.timerId))
        assertNull(folded.filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.reask)
        assertTrue(driveAndPark(40).none { it is Effect.ShowCard })
    }

    @Test
    fun 직전_P단_뒤_10분_안의_잠깐_정차_P단에서는_묻지_않고_다음_탑승_판단에서_묻는다() {
        // 마지막 P단이 3분 전이었다: 이번 P단은 잠깐 정차 P단이다(주차장에서 차를 옮기는 경우 등).
        val log = BoardingLog(lastBoardedOn = day, lastParkedAt = start - Duration.ofMinutes(3), parkedAfterDriveSinceBoarding = true)
        newSession(Snapshot(log, emptyMap(), day, reask = PendingReask(ReaskKind.DEPART, "a")), gear = null)
        session.handle(Event.GearChanged(Gear.DRIVE))
        clock.now += Duration.ofMinutes(2)
        val quick = session.handle(Event.GearChanged(Gear.PARK))
        assertTrue(quick.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })

        // 질문은 남아 있다가 10분이 지난 다음 탑승 판단에서 한 번 묻는다.
        clock.now += Duration.ofMinutes(11)
        val shown = boardWithCard()
        assertEquals("출발할까요?", shown.card().sub)
        assertNull(shown.lastSnapshot().reask)
    }

    @Test
    fun 다음_탑승_판단_때_한_번_묻고_이_카드가_또_무응답이어도_더_묻지_않는다() {
        boardAndIgnore()
        // 접힌 뒤 같은 자리에서 시동을 껐다 켜는 다음 탑승: 마지막 P단이 없어 잠깐 정차가 아니다.
        clock.now += Duration.ofMinutes(20)
        val shown = boardWithCard()
        assertEquals("출발할까요?", shown.card().sub)
        assertNull(shown.lastSnapshot().reask)
        val folded = session.handle(Event.CardTimedOut(shown.one<Effect.ScheduleCardTimeout>().timerId))
        assertNull(folded.filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.reask)
        clock.now += Duration.ofMinutes(20)
        val third = boardWithCard()
        assertEquals("출발할까요?", third.card().sub)
        // 이번에는 다시 묻는 카드가 아니라 새 탑승 판단의 질문이다. 그 무응답은 새로 다시 물을 질문이 된다(한 번만은 접힌 질문 하나당 한 번).
        assertEquals(ReaskKind.DEPART, session.handle(Event.CardTimedOut(third.one<Effect.ScheduleCardTimeout>().timerId)).lastSnapshot().reask?.kind)
    }

    // ---- 그 사이 상황이 바뀌었을 때 ----

    @Test
    fun 그_사이_대상_일정이_바뀌면_그_시점의_판단으로_다시_만든_질문을_묻는다() {
        boardAndIgnore()
        // 폰에서 더 이른 일정이 생겼다(고객 미팅과 겹치지 않게 짧게): 접힌 질문은 고객 미팅이었지만 지금 대상은 새 일정이다.
        schedules = listOf(schedule("n", "새 일정", 12, cityHall, lengthMin = 5)) + schedules
        val request = driveAndPark(10).one<Effect.RequestTravelTime>()
        assertEquals(cityHall, request.place)
        val card = session.handle(Event.TravelTimeResult(request.requestId, null)).card()
        assertEquals("12시 12분 새 일정까지 2분이에요.", card.voice)
    }

    @Test
    fun 그_사이_이미_늦었으면_늦게_탐으로_다시_만든_질문을_묻는다() {
        boardAndIgnore()
        val request = driveAndPark(55).one<Effect.RequestTravelTime>()
        val card = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(20))).card()
        assertEquals("고객 미팅이 12시 40분인데 지금 출발하면 1시 15분 도착이에요.", card.voice)
    }

    @Test
    fun 대상_일정이_도착이_되면_다시_묻지_않고_지운다() {
        boardAndIgnore()
        drive()
        clock.now = start + Duration.ofMinutes(50)
        session.handle(Event.LocationChanged(LatLng(gangnam.position.lat + 0.001, gangnam.position.lng)))
        val parked = park()
        // 접힌 질문의 대상 일정(고객 미팅)에 위치로 도착했다 → 하차 카드가 뜨고 질문은 지운다.
        assertTrue(parked.any { it is Effect.ShowCard && it.card.status == Phrases.STATUS_BEFORE_EXIT })
        assertNull(parked.lastSnapshot().reask)
        assertTrue(parked.none { it is Effect.RequestTravelTime })
    }

    @Test
    fun 대상_일정이_건너뜀이_되어도_다시_묻지_않는다() {
        boardAndIgnore()
        drive()
        clock.now = start + Duration.ofMinutes(101)
        val parked = park()
        // 일정 a가 끝났다 → 건너뜀 → 접힌 질문을 지운다. b는 새 판단이 아니라 다시 묻기가 아니므로 달린 뒤 P단은 조용하다.
        assertTrue(parked.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
        assertNull(parked.lastSnapshot().reask)
    }

    // ---- 지우는 조건 ----

    @Test
    fun 날짜가_바뀌면_지운다() {
        boardAndIgnore()
        clock.now += Duration.ofDays(1)
        schedules = listOf(schedule("a", "고객 미팅", 24 * 60 + 40, gangnam))
        val out = session.handle(Event.Resumed)
        assertNull(out.lastSnapshot().reask)
    }

    @Test
    fun 저장분의_날짜가_오늘이_아니면_복원할_때_버린다() {
        val yesterday = day.minusDays(1)
        newSession(Snapshot(BoardingLog(lastBoardedOn = yesterday), emptyMap(), yesterday, reask = PendingReask(ReaskKind.DEPART, "a")), gear = null)
        assertTrue(driveAndPark(5).none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
    }

    @Test
    fun 초기화하면_지운다() {
        boardAndIgnore()
        val out = session.handle(Event.Reset)
        assertNull(out.lastSnapshot().reask)
    }

    @Test
    fun 연결이_풀리면_지운다() {
        boardAndIgnore()
        val out = session.handle(Event.Unpaired)
        assertNull(out.lastSnapshot().reask)
    }

    @Test
    fun 시동을_껐다_켜도_질문은_남아_다음_탑승_판단에서_묻는다() {
        boardAndIgnore()
        val off = session.handle(Event.IgnitionChanged(Ignition.OFF))
        assertEquals(ReaskKind.DEPART, off.lastSnapshot().reask?.kind)
        clock.now += Duration.ofMinutes(30)
        val on = session.handle(Event.IgnitionChanged(Ignition.ON))
        val shown = session.handle(Event.TravelTimeResult(on.one<Effect.RequestTravelTime>().requestId, null))
        assertEquals("출발할까요?", shown.card().sub)
        assertNull(shown.lastSnapshot().reask)
    }

    // ---- 저장·복원 ----

    @Test
    fun 저장한_질문은_프로세스가_다시_떠도_이어져_달린_뒤_P단에서_한_번_묻는다() {
        val snapshot = boardAndIgnore().lastSnapshot()
        // 인코딩·디코딩을 거친 저장분으로 새 세션(프로세스 재시작)
        val restored = SnapshotCodec.decode(SnapshotCodec.encode(snapshot))
        assertEquals(PendingReask(ReaskKind.DEPART, "a"), restored?.reask)
        newSession(restored, gear = Gear.PARK)
        val request = driveAndPark(15).one<Effect.RequestTravelTime>()
        val shown = session.handle(Event.TravelTimeResult(request.requestId, null))
        assertEquals("출발할까요?", shown.card().sub)
    }

    // ---- 하차 카드·위치 판단과 겹치는 P단 ----

    @Test
    fun 하차_카드가_뜨는_P단에서는_다시_묻지_않고_다음_탑승_판단에서_묻는다() {
        // 접힌 질문은 고객 미팅(a). 그 뒤 폰에서 점심 약속(b)이 들어와 길안내 없이 b 근처 P단에서 위치로 도착한다(창: 시작 60분 전 ~ 종료).
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, lengthMin = 400))
        newSession()
        boardAndIgnore()
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, lengthMin = 400), schedule("b", "점심 약속", 180, cityHall))
        drive()
        clock.now = start + Duration.ofMinutes(130)
        session.handle(Event.LocationChanged(LatLng(cityHall.position.lat + 0.001, cityHall.position.lng)))
        val parked = park()
        // 위치(P단 직전 30초 안)로 바로 도착 → 하차 카드. 다시 묻기(소요 시간 요청)는 이 P단에서 하지 않는다.
        assertTrue(parked.any { it is Effect.ShowCard && it.card.status == Phrases.STATUS_BEFORE_EXIT })
        assertTrue(parked.none { it is Effect.RequestTravelTime })
        assertEquals("접힌 질문은 남아 있다", PendingReask(ReaskKind.DEPART, "a"), parked.lastSnapshot().reask)

        // 하차 카드가 닫히고 한참 뒤의 다음 탑승 판단에서 한 번 묻는다.
        clock.now += Duration.ofMinutes(30)
        val request = session.handle(Event.Boarded).filterIsInstance<Effect.RequestTravelTime>().singleOrNull()
        assertNotNull(request)
        val shown = session.handle(Event.TravelTimeResult(request!!.requestId, null))
        assertTrue(shown.card().sub!!.contains("출발할까요?"))
        assertNull(shown.lastSnapshot().reask)
    }

    @Test
    fun 위치로_도착을_판단하는_동안에는_기다렸다가_도착이_아니면_그_P단에서_묻는다() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, lengthMin = 400))
        newSession()
        boardAndIgnore()
        drive()
        clock.now = start + Duration.ofMinutes(130)
        val parked = park()
        // 믿을 위치가 없어 내비에 위치를 묻는 중: 아직 다시 묻지 않는다.
        assertTrue(parked.has<Effect.RequestLocation>())
        assertTrue(parked.none { it is Effect.RequestTravelTime })
        // 내비 답이 와서 어느 일정 장소도 아니면(집도 없음) 이 P단에서 다시 묻는다.
        val answer = session.handle(Event.LocationChanged(LatLng(37.60, 127.10), naviAnswer = true))
        assertEquals(1, answer.filterIsInstance<Effect.RequestTravelTime>().size)
    }

    @Test
    fun 위치_답을_기다리다_도착이_되면_하차_카드가_먼저고_다시_묻지_않는다() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, lengthMin = 400))
        newSession()
        boardAndIgnore()
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, lengthMin = 400), schedule("b", "점심 약속", 180, cityHall))
        drive()
        clock.now = start + Duration.ofMinutes(130)
        park()
        val answer = session.handle(Event.LocationChanged(LatLng(cityHall.position.lat + 0.001, cityHall.position.lng), naviAnswer = true))
        assertTrue(answer.any { it is Effect.ShowCard && it.card.status == Phrases.STATUS_BEFORE_EXIT })
        assertTrue(answer.none { it is Effect.RequestTravelTime })
        assertEquals(ReaskKind.DEPART, answer.lastSnapshot().reask?.kind)
    }

    @Test
    fun 위치_답이_끝내_없으면_타임아웃_뒤_그_P단에서_묻는다() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, lengthMin = 400))
        newSession()
        boardAndIgnore()
        drive()
        clock.now = start + Duration.ofMinutes(130)
        val parked = park()
        val timer = parked.one<Effect.ScheduleLocationTimeout>()
        val out = session.handle(Event.LocationTimedOut(timer.timerId))
        assertEquals(1, out.filterIsInstance<Effect.RequestTravelTime>().size)
    }

    @Test
    fun 다시_묻는_자리에서_바로_주행을_시작하면_접고_질문은_이미_썼다() {
        boardAndIgnore()
        val request = driveAndPark(15).one<Effect.RequestTravelTime>()
        // 소요 시간을 기다리는 중 D → 판단을 버린다. 카드를 띄우지 않았으니 접힌 질문은 그대로 남는다.
        val out = drive()
        assertTrue(out.none { it is Effect.ShowCard })
        assertTrue(session.handle(Event.TravelTimeResult(request.requestId, null)).none { it is Effect.ShowCard })
        val next = driveAndPark(15)
        assertEquals(1, next.filterIsInstance<Effect.RequestTravelTime>().size)
    }

    @Test
    fun 앱을_켤_때_이미_P단이거나_달리지_않고_넣은_P단에서는_묻지_않는다() {
        boardAndIgnore()
        // 달리지 않고 N→P: 달린 뒤 P단이 아니다.
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        val out = session.handle(Event.GearChanged(Gear.PARK))
        assertTrue(out.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
    }

    // ---- P단 다시 묻기는 탑승이 아니다(M1) ----

    @Test
    fun P단에서_다시_묻는_것은_탑승_기록을_남기지_않아_내렸다_40분_뒤_앱에_들어오면_재탑승_한_줄이_나온다() {
        boardAndIgnore()
        val parked = driveAndPark(15)
        val request = parked.one<Effect.RequestTravelTime>()
        val shown = session.handle(Event.TravelTimeResult(request.requestId, null))
        // P단에서 다시 묻는 카드: 마지막 탑승 뒤 '달린 뒤 P단'과 P단 시각이 그대로 남는다(탑승이 아니라서 지우지 않는다).
        val afterReask = shown.lastSnapshot().log
        assertTrue("달린 뒤 P단 표시가 남아야 한다", afterReask.parkedAfterDriveSinceBoarding)
        assertEquals(clock.now, afterReask.lastParkedAt)
        // 이 카드도 무응답으로 접힌 뒤 내려서 40분이 지난다.
        session.handle(Event.CardTimedOut(shown.one<Effect.ScheduleCardTimeout>().timerId))
        clock.now += Duration.ofMinutes(40)
        // 시동 신호가 없어 앱 진입이 탑승 신호다: 마지막 탑승 뒤 주행하고 P단에 넣었으므로 탑승으로 인정하고, 같은 날 재탑승이라 한 줄이다.
        val entered = session.handle(Event.AppEntered)
        val again = session.handle(Event.TravelTimeResult(entered.one<Effect.RequestTravelTime>().requestId, null))
        val card = again.card()
        assertTrue("재탑승 한 줄이라 타일이 없다", card.tiles.isEmpty())
        assertTrue(card.voice, card.voice.contains("고객 미팅"))
    }

    // ---- 주행 제한이 풀릴 때 이어서 묻기(M2) ----

    @Test
    fun P단_신호가_주행_제한_해제보다_먼저_와도_해제될_때_이어서_묻는다() {
        boardAndIgnore()
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.RestrictionChanged(true))
        clock.now += Duration.ofMinutes(15)
        // P단이 먼저 오고 제한이 아직 안 풀렸다: 말하지도 묻지도 않지만 기회는 남는다.
        val parked = parkWithTimeout()
        assertTrue(parked.none { it is Effect.RequestTravelTime || it is Effect.ShowCard || it is Effect.Speak })
        val released = session.handle(Event.RestrictionChanged(false))
        val shown = session.handle(Event.TravelTimeResult(released.one<Effect.RequestTravelTime>().requestId, null))
        assertEquals("출발할까요?", shown.card().sub)
        assertNull("한 번 썼다", shown.lastSnapshot().reask)
    }

    @Test
    fun 제한이_풀리기_전에_다시_달리기_시작하면_다시_묻기를_접고_질문은_남는다() {
        boardAndIgnore()
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.RestrictionChanged(true))
        clock.now += Duration.ofMinutes(15)
        parkWithTimeout()
        // 제한이 풀리기 전에 다시 달리기 시작하면 첫 P단의 다시 묻기는 접힌다(주행 중에는 묻지 않는다).
        assertTrue(session.handle(Event.GearChanged(Gear.DRIVE)).none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
        assertTrue(session.handle(Event.RestrictionChanged(false)).none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
        // 질문은 남아 있어 다음 달린 뒤 P단에서 묻는다.
        clock.now += Duration.ofMinutes(15)
        assertEquals(1, parkWithTimeout().filterIsInstance<Effect.RequestTravelTime>().size)
    }

    // ---- 앱이 앞에 있을 때만(Pleos 점검) ----

    @Test
    fun 앱이_뒤에_있으면_기회를_쓰지_않고_앞에_온_뒤_정차_중이면_묻는다() {
        boardAndIgnore()
        session.handle(Event.ForegroundChanged(false))
        val parked = driveAndPark(15)
        assertTrue("뒤에서는 말하지도 카드를 띄우지도 않는다", parked.none { it is Effect.RequestTravelTime || it is Effect.ShowCard || it is Effect.Speak })
        // 질문은 남아 있다. 앱이 앞으로 오면(같은 P단) 이어서 묻는다.
        val front = session.handle(Event.ForegroundChanged(true))
        val shown = session.handle(Event.TravelTimeResult(front.one<Effect.RequestTravelTime>().requestId, null))
        assertEquals("출발할까요?", shown.card().sub)
        assertTrue(shown.one<Effect.Speak>().thenListen)
        assertNull(shown.lastSnapshot().reask)
    }

    @Test
    fun 뒤에_있는_동안_다시_달리면_그_P단의_기회는_접고_다음_P단에서_앞에_있으면_묻는다() {
        boardAndIgnore()
        session.handle(Event.ForegroundChanged(false))
        driveAndPark(15)
        session.handle(Event.GearChanged(Gear.DRIVE))
        // 달리는 중에 앞으로 와도 묻지 않는다(주행 중).
        assertTrue(session.handle(Event.ForegroundChanged(true)).none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
        clock.now += Duration.ofMinutes(15)
        assertEquals(1, parkWithTimeout().filterIsInstance<Effect.RequestTravelTime>().size)
    }

    @Test
    fun 뒤에_있는_동안_질문의_대상_일정이_건너뜀이_되면_앞에_와도_묻지_않는다() {
        boardAndIgnore()
        session.handle(Event.ForegroundChanged(false))
        driveAndPark(15)
        clock.now = start + Duration.ofMinutes(101)
        val front = session.handle(Event.ForegroundChanged(true))
        assertTrue(front.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
        assertNull(front.lastSnapshot().reask)
    }

    @Test
    fun 뒤에_있는_동안_하차_카드가_먼저_뜬_P단에서는_앞에_와도_묻지_않고_질문은_남는다() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, lengthMin = 400))
        newSession()
        boardAndIgnore()
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, lengthMin = 400), schedule("b", "점심 약속", 180, cityHall))
        session.handle(Event.ForegroundChanged(false))
        drive()
        clock.now = start + Duration.ofMinutes(130)
        session.handle(Event.LocationChanged(LatLng(cityHall.position.lat + 0.001, cityHall.position.lng)))
        val parked = park()
        assertTrue(parked.any { it is Effect.ShowCard && it.card.status == Phrases.STATUS_BEFORE_EXIT })
        val front = session.handle(Event.ForegroundChanged(true))
        assertTrue(front.none { it is Effect.RequestTravelTime })
        assertEquals("접힌 질문은 남아 다음 기회에 묻는다", ReaskKind.DEPART, session.handle(Event.SuspendRequested).lastSnapshot().reask?.kind)
    }

    // ---- 말하지 못했을 때(Pleos 점검) ----

    @Test
    fun 다시_묻는_카드를_오디오_포커스를_못_얻어_말하지_못했으면_기회를_쓴_것으로_치지_않는다() {
        boardAndIgnore()
        val request = driveAndPark(15).one<Effect.RequestTravelTime>()
        val shown = session.handle(Event.TravelTimeResult(request.requestId, null))
        // 어댑터가 포커스를 못 얻어 말하지 못했다고 알린다.
        session.handle(Event.SpeechUnavailable)
        val folded = session.handle(Event.CardTimedOut(shown.one<Effect.ScheduleCardTimeout>().timerId))
        assertEquals("기회를 쓰지 않았으니 다시 남는다", ReaskKind.DEPART, folded.lastSnapshot().reask?.kind)
        // 다음 정차에서 다시 묻는다. 이번에는 말했으니 접혀도 더 묻지 않는다.
        val second = driveAndPark(15).one<Effect.RequestTravelTime>()
        val again = session.handle(Event.TravelTimeResult(second.requestId, null))
        val foldedAgain = session.handle(Event.CardTimedOut(again.one<Effect.ScheduleCardTimeout>().timerId))
        assertNull(foldedAgain.filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.reask)
        assertTrue(driveAndPark(15).none { it is Effect.ShowCard })
    }

    @Test
    fun 말하지_못했어도_사용자가_버튼으로_답한_다시_묻는_카드는_평소대로_처리한다() {
        boardAndIgnore()
        val request = driveAndPark(15).one<Effect.RequestTravelTime>()
        session.handle(Event.TravelTimeResult(request.requestId, null))
        session.handle(Event.SpeechUnavailable)
        // 수락하면 길안내하고 접힌 질문은 없다.
        assertTrue(session.handle(Event.PrimaryPressed).has<Effect.StartRoute>())
        assertTrue(driveAndPark(15).none { it is Effect.ShowCard })
    }

    @Test
    fun 다시_묻는_카드가_아닌_카드의_말하기_실패는_다시_묻기와_무관하다() {
        // 첫 카드를 말하지 못해도(다시 묻는 카드가 아님) 접히면 평소대로 다시 물을 질문으로 남는다.
        val shown = boardWithCard()
        session.handle(Event.SpeechUnavailable)
        val folded = session.handle(Event.CardTimedOut(shown.one<Effect.ScheduleCardTimeout>().timerId))
        assertEquals(ReaskKind.DEPART, folded.lastSnapshot().reask?.kind)
    }

    // ---- 받는 중·연결 해제(m1, m10) ----

    @Test
    fun 일정을_받는_중에_보류한_P단_다시_묻기는_받기가_끝난_뒤_잠깐_정차_규칙_없이_이어_묻는다() {
        boardAndIgnore()
        origin = ScheduleOrigin.STORED
        val parked = driveAndPark(15)
        // 일정 출처가 최신이 아니라 먼저 다시 받는다: 받는 동안 탑승 판단(다시 묻기)은 보류한다.
        assertTrue(parked.has<Effect.RefreshSchedules>())
        assertTrue(parked.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
        origin = ScheduleOrigin.FRESH
        session.handle(Event.ScheduleLoading(1))
        val loaded = session.handle(Event.ScheduleLoaded(1))
        // 방금 P단에 넣은 직후라 보통은 잠깐 정차(10분 안)로 침묵할 시각이지만, 다시 묻는 것은 규칙을 건너뛴다.
        val shown = session.handle(Event.TravelTimeResult(loaded.one<Effect.RequestTravelTime>().requestId, null))
        assertEquals("출발할까요?", shown.card().sub)
        assertNull(shown.lastSnapshot().reask)
        // 탑승이 아니므로 마지막 탑승 뒤 달린 뒤 P단 표시가 남는다.
        assertTrue(shown.lastSnapshot().log.parkedAfterDriveSinceBoarding)
    }

    @Test
    fun 일정을_받는_중에_앱이_뒤로_가면_받기가_끝나도_기회를_쓰지_않고_앞에_올_때_묻는다() {
        boardAndIgnore()
        origin = ScheduleOrigin.STORED
        driveAndPark(15)
        session.handle(Event.ForegroundChanged(false))
        origin = ScheduleOrigin.FRESH
        session.handle(Event.ScheduleLoading(1))
        val loaded = session.handle(Event.ScheduleLoaded(1))
        assertTrue(loaded.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
        val front = session.handle(Event.ForegroundChanged(true))
        assertEquals(1, front.filterIsInstance<Effect.RequestTravelTime>().size)
    }

    @Test
    fun 연결이_풀리면_보류해_둔_다시_묻기_표시도_지워_다음_연결의_첫_브리핑이_사라지지_않는다() {
        boardAndIgnore()
        origin = ScheduleOrigin.STORED
        driveAndPark(15).also { assertTrue(it.has<Effect.RefreshSchedules>()) }
        // 받는 중에 연결이 풀렸다(받던 일정은 버려지고 완료는 오지 않는다).
        session.handle(Event.Unpaired)
        origin = ScheduleOrigin.FRESH
        // 다른 운전자가 연결하면 일정을 새로 받아 탑승으로 브리핑한다. 낡은 '다시 묻는 중' 표시가 남아 있으면 이 브리핑이 사라진다.
        val paired = session.handle(Event.Paired(brief = true))
        assertTrue(paired.has<Effect.RefreshSchedules>())
        session.handle(Event.ScheduleLoading(2))
        val loaded = session.handle(Event.ScheduleLoaded(2))
        assertTrue("새 연결의 첫 브리핑이 나와야 한다", loaded.has<Effect.RequestTravelTime>() || loaded.has<Effect.ShowCard>())
    }

    // ---- 겹침에서 고른 뒤(m2) ----

    @Test
    fun 다시_묻는_겹침_카드에서_일정을_고른_뒤의_출발_제안이_또_접혀도_다시_묻지_않는다() {
        schedules = listOf(schedule("a", "점심 약속", 40, gangnam), schedule("b", "친구 모임", 90, cityHall))
        newSession()
        val timer = session.handle(Event.Boarded).one<Effect.ScheduleCardTimeout>()
        session.handle(Event.CardTimedOut(timer.timerId))
        // 달린 뒤 P단에서 겹침을 다시 묻는다(점심 약속이 시간 창 안이라 위치 답을 기다리다 타임아웃).
        val asked = driveAndPark(5)
        assertEquals("‘점심 약속’과 ‘친구 모임’이 겹쳐요.", asked.card().voice)
        // 다음 일정을 고르면 같은 카드에서 출발 제안으로 바뀐다. 이 카드는 '다시 묻는 중'이라 또 접혀도 세 번째 질문이 없다.
        val request = session.handle(Event.SecondaryPressed).one<Effect.RequestTravelTime>()
        val depart = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(20)))
        val folded = session.handle(Event.CardTimedOut(depart.one<Effect.ScheduleCardTimeout>().timerId))
        assertNull(folded.filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.reask)
        assertTrue(driveAndPark(20).none { it is Effect.ShowCard || it is Effect.RequestTravelTime })
    }

    @Test
    fun 처음_겹침_카드에서_고른_출발_제안이_접히면_그_질문을_한_번_다시_묻는다() {
        schedules = listOf(schedule("a", "점심 약속", 40, gangnam), schedule("b", "친구 모임", 90, cityHall))
        newSession()
        session.handle(Event.Boarded)
        val request = session.handle(Event.SecondaryPressed).one<Effect.RequestTravelTime>()
        val depart = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(20)))
        val folded = session.handle(Event.CardTimedOut(depart.one<Effect.ScheduleCardTimeout>().timerId))
        assertEquals(PendingReask(ReaskKind.DEPART, "b"), folded.lastSnapshot().reask)
    }

    // ---- 대안(7장) ----

    private fun emptyDayCard(vararg places: Favorite): List<Effect> {
        schedules = emptyList()
        favorites = places.toList()
        newSession()
        return session.handle(Event.Boarded)
    }

    private fun rows(out: List<Effect>) = (out.card().tiles.single() as TileView.Candidates).rows.map { it.name }

    @Test
    fun 다른_데라고_하면_다음_후보_하나만_보이고_다시_듣는다() {
        emptyDayCard(home, work, station)
        val first = session.handle(Event.Heard("다른 데"))
        assertEquals(listOf("회사"), rows(first))
        assertEquals("회사로 갈까요?", first.card().voice)
        assertEquals("회사로", first.card().primary)
        assertEquals(Effect.Speak("회사로 갈까요?", thenListen = true), first.one<Effect.Speak>())
        assertEquals(Rules.CARD_TIMEOUT, first.one<Effect.ScheduleCardTimeout>().delay)

        val second = session.handle(Event.Heard("다른 데"))
        assertEquals(listOf("서울역"), rows(second))
        assertEquals("서울역으로 갈까요?", second.card().voice)
    }

    @Test
    fun 대안으로_바뀐_카드에서_응이나_버튼은_보이는_후보로_길안내한다() {
        emptyDayCard(home, work, station)
        session.handle(Event.Heard("다른 데"))
        assertEquals(work.place, session.handle(Event.Heard("응")).one<Effect.StartRoute>().place)

        emptyDayCard(home, work, station)
        session.handle(Event.Heard("다른 곳"))
        assertEquals(work.place, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)

        emptyDayCard(home, work, station)
        session.handle(Event.Heard("다른 데"))
        session.handle(Event.Heard("다른 데"))
        assertEquals(station.place, session.handle(Event.CandidatePressed(0)).one<Effect.StartRoute>().place)
    }

    @Test
    fun 더_보일_후보가_없으면_찾지_못했다고_하고_카드는_그대로_둔다() {
        emptyDayCard(home, work)
        session.handle(Event.Heard("다른 데"))
        val none = session.handle(Event.Heard("다른 데"))
        assertEquals("다른 곳은 찾지 못했어요.", none.one<Effect.Speak>().text)
        assertEquals("다른 곳은 찾지 못했어요.", none.card().notice)
        assertEquals(listOf("회사"), rows(none))
        // 듣기는 닫혔다(안내만 말하고 버튼으로 기다린다).
        assertEquals(emptyList<Effect>(), session.handle(Event.Heard("응")))
        assertEquals(work.place, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)
    }

    @Test
    fun 후보가_하나뿐이거나_후보가_없는_질문은_바로_찾지_못했다고_한다() {
        emptyDayCard(home)
        assertEquals("다른 곳은 찾지 못했어요.", session.handle(Event.Heard("다른 데")).one<Effect.Speak>().text)
        emptyDayCard()
        assertEquals("다른 곳은 찾지 못했어요.", session.handle(Event.Heard("다른 데")).one<Effect.Speak>().text)
        // 출발 제안에는 후보가 없다.
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam))
        newSession()
        boardWithCard()
        assertEquals("다른 곳은 찾지 못했어요.", session.handle(Event.Heard("다른 데")).one<Effect.Speak>().text)
    }

    @Test
    fun 여유_많음에서는_일정_장소_다음_후보로_바뀌고_일정_장소는_다시_보이지_않는다() {
        schedules = listOf(schedule("c", "저녁 모임", 300, cityHall))
        favorites = listOf(home, work)
        newSession()
        val first = boardWithCard(Duration.ofMinutes(20))
        assertEquals(listOf("서울시청", "집", "회사"), rows(first))
        val alt = session.handle(Event.Heard("다른 데"))
        assertEquals(listOf("집"), rows(alt))
        assertEquals("집으로 갈까요?", alt.card().voice)
        // 이름으로 고르는 말도 지금 보이는 후보만 받는다.
        val other = session.handle(Event.Heard("서울시청"))
        assertEquals(Phrases.ASK_AGAIN, other.one<Effect.Speak>().text)
    }

    @Test
    fun 대안으로_바뀐_카드가_무응답으로_접히면_다시_물을_질문은_후보_묻기_하나다() {
        schedules = emptyList()
        favorites = listOf(home, work, station)
        newSession()
        val first = session.handle(Event.Boarded).one<Effect.ScheduleCardTimeout>()
        val alt = session.handle(Event.Heard("다른 데"))
        // 첫 카드의 낡은 타이머는 무시되고, 대안으로 바뀐 카드의 새 30초가 지나야 접힌다.
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(first.timerId)))
        val folded = session.handle(Event.CardTimedOut(alt.one<Effect.ScheduleCardTimeout>().timerId))
        assertEquals(PendingReask(ReaskKind.ASK_DESTINATION, null), folded.lastSnapshot().reask)
    }
}
