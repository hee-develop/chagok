package com.chagok.car.flow

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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 일정 장소 하차 카드("도착 · 내리기 전", 정책서 4·6·9장). 계약은 docs/exit-card.md */
class DriveSessionExitCardTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = MutableClock(start)
    private lateinit var schedules: List<Schedule>
    private lateinit var session: DriveSession
    private var paired = true
    private var exitTimeout: Duration = Rules.EXIT_CARD

    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val cityHall = Place("서울시청", LatLng(37.5663, 126.9779))
    private val nearGangnam = LatLng(gangnam.position.lat + 0.002, gangnam.position.lng)
    private val farFromGangnam = LatLng(gangnam.position.lat + 0.003, gangnam.position.lng)

    private fun schedule(id: String, title: String, startMin: Long, place: Place?, memo: String? = null, care: String? = null) = Schedule(
        id = id,
        title = title,
        start = start + Duration.ofMinutes(startMin),
        end = start + Duration.ofMinutes(startMin + 60),
        place = place,
        memo = memo,
        care = care,
    )

    @Before
    fun setUp() {
        schedules = listOf(
            schedule("a", "고객 미팅", 40, gangnam, "계약서 2부"),
            schedule("b", "점심 약속", 180, cityHall),
        )
        newSession()
    }

    /** @param gear 시작할 때의 기어. 앱을 켠 순간 이미 P단이면 '방금 P단에 넣음'이 아니다. */
    private fun newSession(restored: Snapshot? = null, gear: Gear? = Gear.PARK) {
        session = DriveSession(clock, { ScheduleSnapshot(schedules) }, restored, paired = paired, exitCardTimeout = { exitTimeout })
        gear?.let { session.handle(Event.GearChanged(it)) }
    }

    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()
    private inline fun <reified T : Effect> List<Effect>.has() = any { it is T }

    private fun List<Effect>.exitCard() = filterIsInstance<Effect.ShowCard>().map { it.card }.singleOrNull { it.status == Phrases.STATUS_BEFORE_EXIT }
    private fun List<Effect>.noExitCard() = filterIsInstance<Effect.ShowCard>().none { it.card.status == Phrases.STATUS_BEFORE_EXIT }
    private fun List<Effect>.savedExitTarget() = filterIsInstance<Effect.Save>().lastOrNull()?.snapshot?.exitTargetId

    /** 이 이벤트에서 하차 대기가 아무 때도 저장되지 않았다(Save가 없어도 통과하므로 '세우지 않았다'를 확인할 때만 쓴다). */
    private fun List<Effect>.neverSavedExitTarget() = filterIsInstance<Effect.Save>().none { it.snapshot.exitTargetId != null }

    /** 이 이벤트가 하차 대기를 지웠다: 지운 상태를 담은 Save가 반드시 있어야 하고 마지막 Save에 대기가 없다. Save가 없으면 실패한다. */
    private fun List<Effect>.assertExitCleared() {
        val saves = filterIsInstance<Effect.Save>()
        assertTrue("대기를 지운 Save가 있어야 한다", saves.isNotEmpty())
        assertNull(saves.last().snapshot.exitTargetId)
        assertNull(saves.last().snapshot.exitArrivedAt)
    }

    /** 탑승 → 소요 시간 응답까지 진행해 카드를 띄운다. */
    private fun boardWithCard(): List<Effect> {
        var boarded = session.handle(Event.Boarded)
        // 일정 겹침(시간이 겹치는 두 일정이 서로 다른 곳)이면 먼저인 일정(주 버튼)을 고른다. 이 테스트들은 먼저인 고객 미팅을 길안내하는 것이 전제다.
        if (boarded.none { it is Effect.RequestTravelTime }) boarded = session.handle(Event.PrimaryPressed)
        val request = boarded.one<Effect.RequestTravelTime>()
        return session.handle(Event.TravelTimeResult(request.requestId, null))
    }

    /** 출발 제안을 받아 길안내를 시작하고 출발한다(고객 미팅이 길안내 대상 일정). */
    private fun departAndDrive() {
        boardWithCard()
        session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        session.handle(Event.RouteRequestResult(true))
        session.handle(Event.GearChanged(Gear.DRIVE))
    }

    /** 내비 도착 알림까지 보낸 상태(주행 중). 아직 P단이 아니라 카드가 없다. */
    private fun driveAndArrive(afterMinutes: Long = 30): List<Effect> {
        departAndDrive()
        clock.now += Duration.ofMinutes(afterMinutes)
        return session.handle(Event.DestinationArrived)
    }

    private fun park() = session.handle(Event.GearChanged(Gear.PARK))

    @Test
    fun 내비_도착_뒤_달린_다음_P단에서_하차_카드를_한_번_말하고_5초_뒤_닫는다() {
        val arrived = driveAndArrive()
        // 도착 순간에는 말도 카드도 없다.
        assertTrue(arrived.none { it is Effect.Speak || it is Effect.ShowCard })
        assertEquals("a", arrived.savedExitTarget())

        val parked = park()
        val card = parked.exitCard()!!
        assertEquals("도착 · 내리기 전", card.status)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요.", card.voice)
        assertEquals("챙겼어요", card.primary)
        assertNull(card.secondary)
        assertEquals(Rules.EXIT_CARD, card.autoDismiss)
        assertEquals(listOf("5초 뒤 자동으로 닫혀요"), card.hints)
        val speak = parked.one<Effect.Speak>()
        assertEquals("고객 미팅 메모에 계약서 2부가 있어요.", speak.text)
        assertFalse(speak.thenListen)
        val timeout = parked.one<Effect.ScheduleCardTimeout>()
        assertEquals(Rules.EXIT_CARD, timeout.delay)
        // 카드를 보이면 대기는 지운다.
        assertNull(parked.savedExitTarget())

        val closed = session.handle(Event.CardTimedOut(timeout.timerId))
        assertTrue(closed.has<Effect.StopVoice>())
        assertTrue(closed.has<Effect.CollapseCard>())
    }

    @Test
    fun 같은_도착으로는_한_번만_띄운다() {
        driveAndArrive()
        val timeout = park().one<Effect.ScheduleCardTimeout>()
        session.handle(Event.CardTimedOut(timeout.timerId))
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().noExitCard())
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 도착_뒤_15분이_지나서_P단에_넣으면_카드가_없고_대기를_버린다() {
        driveAndArrive()
        clock.now += Duration.ofMinutes(15) + Duration.ofSeconds(1)
        val parked = park()
        assertTrue(parked.noExitCard())
        assertTrue(parked.none { it is Effect.Speak })
        // 만료가 대기를 지워 저장했다(이 이벤트의 Save가 대기 없음을 담는다).
        parked.assertExitCleared()
        // 달려서 다시 P단에 넣어도 대기가 없으니 카드가 없다.
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 도착_뒤_정확히_15분이면_아직_띄운다() {
        driveAndArrive()
        clock.now += Duration.ofMinutes(15)
        assertNotNull(park().exitCard())
    }

    @Test
    fun D에서_N을_거쳐_P단에_넣어도_달린_뒤라서_띄운다() {
        driveAndArrive()
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        assertNotNull(park().exitCard())
    }

    @Test
    fun 달리지_않고_넣은_P단은_카드가_없고_대기를_버린다() {
        // P단에서 길안내를 수락하고 N으로 옮긴 뒤 도착 알림이 오고, 달리지 않은 채 다시 P단에 넣는다.
        boardWithCard()
        session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        assertEquals("a", session.handle(Event.DestinationArrived).savedExitTarget())
        val parked = park()
        assertTrue(parked.noExitCard())
        assertNull(parked.savedExitTarget())
    }

    @Test
    fun 앱_시작_때_이미_P단이면_저장돼_있던_대기를_버린다() {
        val saved = Snapshot(
            log = com.chagok.car.domain.BoardingLog(),
            statuses = mapOf("a" to ScheduleStatus.ARRIVED),
            date = start.atZone(ZoneOffset.UTC).toLocalDate(),
            exitTargetId = "a",
            exitArrivedAt = start,
        )
        newSession(restored = saved, gear = null)
        val first = session.handle(Event.GearChanged(Gear.PARK))
        assertTrue(first.noExitCard())
        assertNull(first.savedExitTarget())
    }

    @Test
    fun 주행_중_프로세스가_다시_떠도_저장한_대기로_다음_P단에서_띄운다() {
        val arrived = driveAndArrive()
        val saved = arrived.filterIsInstance<Effect.Save>().last().snapshot
        assertEquals("a", saved.exitTargetId)
        assertEquals(clock.now, saved.exitArrivedAt)
        newSession(restored = saved, gear = null)
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertNotNull(park().exitCard())
    }

    @Test
    fun 이미_P단에서_도착_알림이_오면_그_P단이_달린_뒤였을_때만_바로_띄운다() {
        departAndDrive()
        park()
        val arrived = session.handle(Event.DestinationArrived)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요.", arrived.exitCard()!!.voice)
        assertTrue(arrived.has<Effect.Speak>())
        assertNull(arrived.savedExitTarget())
    }

    @Test
    fun 달리지_않은_P단에서_도착_알림이_오면_카드가_없고_대기도_남기지_않는다() {
        boardWithCard()
        session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        val arrived = session.handle(Event.DestinationArrived)
        assertEquals(ScheduleStatus.ARRIVED, arrived.filterIsInstance<Effect.Save>().last().snapshot.statuses["a"])
        assertTrue(arrived.noExitCard())
        assertNull(arrived.savedExitTarget())
    }

    @Test
    fun 주행_제한이_걸린_P단의_도착은_풀릴_때까지_미룬다() {
        departAndDrive()
        park()
        session.handle(Event.RestrictionChanged(true))
        val arrived = session.handle(Event.DestinationArrived)
        assertTrue(arrived.noExitCard())
        assertEquals("a", arrived.savedExitTarget())
        assertNotNull(session.handle(Event.RestrictionChanged(false)).exitCard())
    }

    @Test
    fun 길안내한_일정이_없는_도착_알림은_하차_대기를_세우지_않는다() {
        assertTrue(session.handle(Event.DestinationArrived).neverSavedExitTarget())
        // 이미 P단이라 park()가 무동작이 되지 않게 달렸다가 실제로 P단에 넣는다.
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 이미_건너뜀이_된_일정의_도착_알림은_하차_대기를_세우지_않는다() {
        // 일정이 끝난 뒤(고객 미팅 종료 = 시작 40분 + 60분) 도착 알림이 오면 먼저 건너뜀으로 정리돼 새 도착이 아니다.
        val arrived = driveAndArrive(afterMinutes = 130)
        assertTrue(arrived.noExitCard())
        assertNull(arrived.savedExitTarget())
        assertTrue(park().noExitCard())
    }

    @Test
    fun P단_위치로_도착이_기록되면_도착한_그_시점에_바로_띄운다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.LocationChanged(nearGangnam))
        // 주행 중 받은 위치가 있으면 P단에 넣는 순간 도착이고 같은 처리에서 카드가 뜬다.
        val parked = park()
        assertNotNull(parked.exitCard())
        assertNull(parked.savedExitTarget())
    }

    @Test
    fun P단_뒤_비동기로_온_위치_답이_300m_안이면_그때_띄우고_밖이면_없다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().has<Effect.RequestLocation>())
        assertTrue(session.handle(Event.LocationChanged(farFromGangnam)).noExitCard())

        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().has<Effect.RequestLocation>())
        val answered = session.handle(Event.LocationChanged(nearGangnam))
        assertNotNull(answered.exitCard())
        assertTrue(answered.has<Effect.Speak>())
    }

    @Test
    fun 위치_답이_늦게_왔을_때_이미_주행을_시작했으면_도착도_카드도_없다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        park()
        session.handle(Event.GearChanged(Gear.DRIVE))
        val answered = session.handle(Event.LocationChanged(nearGangnam))
        assertTrue(answered.noExitCard())
        assertTrue(answered.none { it is Effect.Save })
    }

    @Test
    fun 다른_카드가_떠_있으면_하차_카드를_띄우지_않고_그_카드를_그대로_둔다() {
        // P단에 넣으며 위치를 물었고(답 전), 잠깐 정차가 지나 탑승 카드가 뜬 뒤 위치 답이 와서 도착이 기록된다.
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().has<Effect.RequestLocation>())
        clock.now += Duration.ofMinutes(11)
        boardWithCard()
        val answered = session.handle(Event.LocationChanged(nearGangnam))
        assertTrue(answered.noExitCard())
        assertTrue(answered.none { it is Effect.CollapseCard })
        assertNull(answered.savedExitTarget())
        // 도착 자체는 기록된다.
        assertEquals(ScheduleStatus.ARRIVED, answered.filterIsInstance<Effect.Save>().last().snapshot.statuses["a"])
    }

    @Test
    fun 휴대폰과_연결_전이면_띄우지_않는다() {
        paired = false
        newSession()
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.LocationChanged(nearGangnam))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 잠깐_정차_안의_탑승_신호는_하차_카드를_그대로_둔다() {
        driveAndArrive()
        park().exitCard()!!
        clock.now += Duration.ofMinutes(5)
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    @Test
    fun 잠깐_정차가_지난_진짜_탑승이면_카드를_접고_재탑승_한_줄을_판단한다() {
        driveAndArrive()
        park().exitCard()!!
        // 도착 직후 P단과 재탑승(10분 뒤)은 시점이 다르다: 카드는 이미 5초 뒤 닫혔을 때가 보통이지만, 떠 있어도 접고 다음 일정을 묻는다.
        clock.now += Duration.ofMinutes(11)
        val boarded = session.handle(Event.Boarded)
        assertTrue(boarded.has<Effect.CollapseCard>())
        val request = boarded.one<Effect.RequestTravelTime>()
        assertEquals(cityHall, request.place)
        val card = session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ShowCard>().card
        assertEquals("3시 점심 약속까지 2시간 19분이에요.", card.voice)
    }

    @Test
    fun 못_보인_하차_대기는_진짜_탑승_판단이_시작되면_지운다() {
        driveAndArrive()
        // N단에서 탑승을 판단하면(잠깐 정차 기록 없음) 새 탑승이라 하차 카드는 더 보이지 않는다.
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        val boarded = session.handle(Event.Boarded)
        assertTrue(boarded.has<Effect.Save>())
        assertNull(boarded.savedExitTarget())
        assertTrue(park().noExitCard())
    }

    @Test
    fun 주행을_시작하면_하차_카드를_즉시_접는다() {
        driveAndArrive()
        park().exitCard()!!
        val driving = session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals(Effect.CollapseCard(instant = true), driving.one<Effect.CollapseCard>())
        assertTrue(driving.has<Effect.StopVoice>())
    }

    @Test
    fun 챙겼어요는_카드를_닫기만_한다() {
        driveAndArrive()
        val timeout = park().one<Effect.ScheduleCardTimeout>()
        val pressed = session.handle(Event.PrimaryPressed)
        assertTrue(pressed.has<Effect.StopVoice>())
        assertTrue(pressed.has<Effect.CollapseCard>())
        assertTrue(pressed.none { it is Effect.ShowResult || it is Effect.StartRoute || it is Effect.Speak })
        // 이미 닫힌 카드의 타이머는 무시한다.
        assertEquals(emptyList<Effect>(), session.handle(Event.CardTimedOut(timeout.timerId)))
    }

    @Test
    fun 메모가_없으면_인사만_하고_버튼이_없다() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam), schedule("b", "점심 약속", 180, cityHall))
        newSession()
        driveAndArrive()
        val parked = park()
        val card = parked.exitCard()!!
        assertEquals("잘 다녀오세요.", card.voice)
        assertTrue(card.alert)
        assertNull(card.primary)
        assertEquals("잘 다녀오세요.", parked.one<Effect.Speak>().text)
    }

    @Test
    fun 앱_채비가_있으면_메모_대신_채비로_카드를_만든다() {
        schedules = listOf(schedule("a", "KIA 직관", 40, gangnam, memo = "주차는 B2", care = "유니폼·응원봉·티켓"), schedule("b", "점심 약속", 180, cityHall))
        newSession()
        driveAndArrive()
        val card = park().exitCard()!!
        assertEquals("유니폼·응원봉·티켓 챙기세요!", card.voice)
        assertEquals("‘KIA 직관’ 일정 채비: 유니폼·응원봉·티켓", card.footnote)
    }

    @Test
    fun 카드_시간은_주입한_값을_따른다() {
        exitTimeout = Duration.ofSeconds(30)
        newSession()
        driveAndArrive()
        val parked = park()
        assertEquals(Duration.ofSeconds(30), parked.one<Effect.ScheduleCardTimeout>().delay)
        assertEquals(Duration.ofSeconds(30), parked.exitCard()!!.autoDismiss)
        assertEquals(listOf("30초 뒤 자동으로 닫혀요"), parked.exitCard()!!.hints)
    }

    @Test
    fun 초기화하면_대기를_지운다() {
        driveAndArrive()
        session.handle(Event.Reset).assertExitCleared()
        // 달린 뒤 P단 조건을 되돌려도(초기화는 '달림' 기록도 지우므로 다시 달린다) 카드가 없다.
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 시동을_끄면_대기를_지운다() {
        driveAndArrive()
        session.handle(Event.IgnitionChanged(Ignition.OFF)).assertExitCleared()
        // 시동을 다시 켜 생긴 탑승 판단을 끝내고(카드도 접고) 달린 뒤 P단 조건을 되돌려도 카드가 없다.
        val resumed = session.handle(Event.IgnitionChanged(Ignition.ACC))
        resumed.filterIsInstance<Effect.RequestTravelTime>().singleOrNull()?.let {
            session.handle(Event.TravelTimeResult(it.requestId, null))
        }
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 연결이_풀리면_대기를_지운다() {
        driveAndArrive()
        session.handle(Event.Unpaired).assertExitCleared()
        // 연결이 돌아와도(연결 전이라서 안 띄운 것이 아니도록) 달린 뒤 P단에 넣어도 카드가 없다.
        session.handle(Event.Paired(brief = false))
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 연결이_풀리면_떠_있던_하차_카드도_접는다() {
        driveAndArrive()
        park().exitCard()!!
        assertTrue(session.handle(Event.Unpaired).has<Effect.CollapseCard>())
    }

    @Test
    fun 날짜가_바뀌면_대기를_지운다() {
        val late = Instant.parse("2026-12-03T23:50:00Z")
        clock.now = late
        schedules = listOf(
            schedule("a", "야간 미팅", 23 * 60 + 51, gangnam, "계약서 2부").copy(end = late + Duration.ofMinutes(9)),
        )
        newSession()
        boardWithCard()
        session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        session.handle(Event.RouteRequestResult(true))
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals("a", session.handle(Event.DestinationArrived).savedExitTarget())
        // 자정을 넘기고(15분 안) P단에 넣어도 새 날이라 카드가 없다.
        clock.now = Instant.parse("2026-12-04T00:02:00Z")
        val parked = park()
        assertTrue(parked.noExitCard())
        assertNull(parked.savedExitTarget())
    }

    private val nearCityHall = LatLng(cityHall.position.lat + 0.002, cityHall.position.lng)

    @Test
    fun 달려_와_댄_자리에서_다시_탑승해_수락하면_그_뒤_도착_알림에는_카드가_없다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        park()
        clock.now += Duration.ofMinutes(11)
        boardWithCard()
        session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        session.handle(Event.RouteRequestResult(true))
        val arrived = session.handle(Event.DestinationArrived)
        assertTrue(arrived.noExitCard())
        assertNull(arrived.savedExitTarget())
        assertEquals(ScheduleStatus.ARRIVED, arrived.filterIsInstance<Effect.Save>().last().snapshot.statuses["a"])
    }

    @Test
    fun 달려_와_댄_뒤_초기화하고_수락해도_그_뒤_도착_알림에는_카드가_없다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        park()
        session.handle(Event.Reset)
        boardWithCard()
        session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        assertTrue(session.handle(Event.DestinationArrived).noExitCard())
    }

    @Test
    fun 카드가_떠_있을_때_온_도착의_대기는_길안내를_수락하면_지운다() {
        departAndDrive()
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        // N단에서 새 탑승 카드가 뜬 뒤 도착 알림이 오면 대기가 서고, 수락하면 그 대기는 더 보이지 않는다.
        boardWithCard()
        assertEquals("a", session.handle(Event.DestinationArrived).savedExitTarget())
        session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        assertTrue(park().noExitCard())
    }

    @Test
    fun 먼저_기다리던_대기를_뒤_도착이_덮어쓰지_않는다() {
        // 점심 약속(b)이 P단 시각의 위치 도착 시간 창(시작 60분 전부터)에 들도록 70분에 시작한다.
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam, "계약서 2부"), schedule("b", "점심 약속", 70, cityHall))
        newSession()
        driveAndArrive()
        session.handle(Event.RestrictionChanged(true))
        assertTrue(park().has<Effect.RequestLocation>())
        // 제한이 안 풀린 P단에서 위치 답으로 다음 일정(점심 약속)도 도착이 되지만 먼저 기다린 고객 미팅 카드가 우선이다.
        val answered = session.handle(Event.LocationChanged(nearCityHall))
        assertEquals(ScheduleStatus.ARRIVED, answered.filterIsInstance<Effect.Save>().last().snapshot.statuses["b"])
        assertTrue(answered.noExitCard())
        assertEquals("a", answered.savedExitTarget())
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요.", session.handle(Event.RestrictionChanged(false)).exitCard()!!.voice)
    }

    @Test
    fun P단에_넣는_순간_주행_제한이_걸려_있다가_풀리면_그때_띄운다() {
        driveAndArrive()
        session.handle(Event.RestrictionChanged(true))
        assertTrue(park().noExitCard())
        assertNotNull(session.handle(Event.RestrictionChanged(false)).exitCard())
    }

    @Test
    fun 탑승_판단이_진행_중이면_하차_카드를_띄우지_않는다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().has<Effect.RequestLocation>())
        clock.now += Duration.ofMinutes(11)
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        val answered = session.handle(Event.LocationChanged(nearGangnam))
        assertTrue(answered.noExitCard())
        assertNull(answered.savedExitTarget())
        // 이어서 탑승 카드는 그대로 뜬다.
        val boarding = session.handle(Event.TravelTimeResult(request.requestId, null))
        assertEquals("정차 중 · 출발 전", boarding.one<Effect.ShowCard>().card.status)
    }

    @Test
    fun 시계가_뒤로_가_도착_시각이_미래가_되면_만료로_본다() {
        driveAndArrive()
        clock.now -= Duration.ofMinutes(1)
        val parked = park()
        assertTrue(parked.noExitCard())
        assertNull(parked.savedExitTarget())
    }

    @Test
    fun 시동_신호가_없는_차의_앱_진입도_잠깐_정차면_카드를_그대로_둔다() {
        driveAndArrive()
        park().exitCard()!!
        clock.now += Duration.ofMinutes(5)
        assertEquals(emptyList<Effect>(), session.handle(Event.AppEntered))
    }

    @Test
    fun D_P_R_P로_다시_대면_카드는_접히고_다시_뜨지_않는다() {
        driveAndArrive()
        park().exitCard()!!
        val reversing = session.handle(Event.GearChanged(Gear.REVERSE))
        assertTrue(reversing.has<Effect.CollapseCard>())
        assertTrue(park().noExitCard())
    }

    @Test
    fun 하차_카드에서_보조_버튼_들은_말_후보_누름은_아무_일도_하지_않는다() {
        driveAndArrive()
        park().exitCard()!!
        assertEquals(emptyList<Effect>(), session.handle(Event.SecondaryPressed))
        assertEquals(emptyList<Effect>(), session.handle(Event.Heard("응")))
        assertEquals(emptyList<Effect>(), session.handle(Event.CandidatePressed(0)))
        // 카드는 그대로 떠 있어 [챙겼어요]가 닫는다.
        assertTrue(session.handle(Event.PrimaryPressed).has<Effect.CollapseCard>())
    }

    @Test
    fun 주행_제한이_걸린_P단에서_도착_뒤_15분이_지난_뒤_제한이_풀리면_카드가_없다() {
        driveAndArrive()
        session.handle(Event.RestrictionChanged(true))
        assertTrue(park().noExitCard())
        clock.now += Duration.ofMinutes(15) + Duration.ofSeconds(1)
        val released = session.handle(Event.RestrictionChanged(false))
        assertTrue(released.noExitCard())
        assertTrue(released.none { it is Effect.Speak })
        released.assertExitCleared()
    }

    @Test
    fun N단에서_주행_제한이_풀려도_카드가_없고_P단에_넣으면_그때_띄운다() {
        driveAndArrive()
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        session.handle(Event.RestrictionChanged(true))
        val released = session.handle(Event.RestrictionChanged(false))
        assertTrue(released.noExitCard())
        assertTrue(released.none { it is Effect.Speak })
        // 대기는 남아 있어 달린 뒤 넣는 P단에서 뜬다.
        assertNotNull(park().exitCard())
    }

    @Test
    fun 오래전에_넣은_P단에_늦게_온_내비_도착은_카드가_없고_대기를_버린다() {
        departAndDrive()
        park()
        clock.now += Duration.ofMinutes(15) + Duration.ofSeconds(1)
        val arrived = session.handle(Event.DestinationArrived)
        // 도착은 기록되지만 그 P단은 15분 넘게 지난 것이라 하차가 아니다.
        assertEquals(ScheduleStatus.ARRIVED, arrived.filterIsInstance<Effect.Save>().last().snapshot.statuses["a"])
        assertTrue(arrived.noExitCard())
        assertTrue(arrived.none { it is Effect.Speak })
        assertTrue(arrived.neverSavedExitTarget())
        // 달려서 다시 P단에 넣어도 대기가 없으니 카드가 없다.
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().noExitCard())
    }

    @Test
    fun P단에_넣은_지_정확히_15분이면_늦게_온_내비_도착도_바로_띄운다() {
        departAndDrive()
        park()
        clock.now += Duration.ofMinutes(15)
        assertNotNull(session.handle(Event.DestinationArrived).exitCard())
    }

    @Test
    fun P단_뒤_위치_답이_15분_넘게_늦으면_도착은_기록하지만_카드가_없다() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(park().has<Effect.RequestLocation>())
        clock.now += Duration.ofMinutes(15) + Duration.ofSeconds(1)
        val answered = session.handle(Event.LocationChanged(nearGangnam))
        assertEquals(ScheduleStatus.ARRIVED, answered.filterIsInstance<Effect.Save>().last().snapshot.statuses["a"])
        assertTrue(answered.noExitCard())
        assertTrue(answered.neverSavedExitTarget())
    }

    @Test
    fun 저장한_날짜가_오늘이_아니면_복원할_때_하차_대기도_버린다() {
        val yesterday = start.atZone(ZoneOffset.UTC).toLocalDate().minusDays(1)
        val saved = Snapshot(
            log = com.chagok.car.domain.BoardingLog(),
            statuses = mapOf("a" to ScheduleStatus.ARRIVED),
            date = yesterday,
            exitTargetId = "a",
            exitArrivedAt = start - Duration.ofMinutes(1),
        )
        newSession(restored = saved, gear = null)
        session.handle(Event.GearChanged(Gear.DRIVE))
        val parked = park()
        assertTrue(parked.noExitCard())
        assertTrue(parked.none { it is Effect.Speak })
        // 같은 날 저장분이면(위 조건만 다름) 같은 흐름에서 카드가 뜬다.
        newSession(restored = saved.copy(date = start.atZone(ZoneOffset.UTC).toLocalDate()), gear = null)
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertNotNull(park().exitCard())
    }
}
