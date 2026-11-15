package com.chagok.car.flow

import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 정책서 6장 '주행 중: 먼저 말하지 않음, 카드 접기 / NextChip'. 주행 중 다음 일정 칩의 표시 조건. */
class DriveSessionNextChipTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val cityHall = Place("서울시청", LatLng(37.5663, 126.9779))
    private val clock = MutableClock(start)
    private var schedules: List<Schedule> = emptyList()
    private lateinit var session: DriveSession

    private fun at(min: Long) = start + Duration.ofMinutes(min)
    private val meeting get() = Schedule("a", "고객 미팅", at(40), at(100), place = gangnam)
    private val lunch get() = Schedule("b", "점심 약속", at(180), at(240), place = cityHall)

    private fun begin(vararg items: Schedule) {
        schedules = items.toList()
        session = DriveSession(clock, { ScheduleSnapshot(schedules) })
        session.handle(Event.GearChanged(Gear.PARK))
    }

    /** 마지막 칩 효과의 본문. 칩 효과가 없으면 null. */
    private fun List<Effect>.chip(): String? = filterIsInstance<Effect.ShowNextChip>().lastOrNull()?.text

    /** 탑승 → 수락 → 길안내 시작. 이후 주행을 시작하면 칩이 뜬다. */
    private fun acceptRoute() {
        val request = session.handle(Event.Boarded).filterIsInstance<Effect.RequestTravelTime>().single()
        session.handle(Event.TravelTimeResult(request.requestId, null))
        session.handle(Event.PrimaryPressed)
        session.handle(Event.RouteRequestResult(true))
    }

    @Before fun setUp() = begin(meeting, lunch)

    private fun beginUnpaired() {
        schedules = listOf(meeting, lunch)
        session = DriveSession(clock, { ScheduleSnapshot(schedules) }, paired = false)
        session.handle(Event.GearChanged(Gear.PARK))
    }

    @Test fun `주행을 시작하면 다음 일정 칩이 뜨고 정차하면 숨긴다`() {
        assertEquals("00:40 고객 미팅", session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        assertEquals("", session.handle(Event.GearChanged(Gear.PARK)).chip())
    }

    @Test fun `정차 중에는 칩 효과를 내지 않는다`() {
        assertEquals(null, session.handle(Event.GearChanged(Gear.NEUTRAL)).chip())
        assertEquals(null, session.handle(Event.Boarded).chip())
    }

    @Test fun `같은 내용이면 다시 내지 않는다`() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals(null, session.handle(Event.GearChanged(Gear.REVERSE)).chip())
        assertEquals(null, session.handle(Event.RestrictionChanged(true)).chip())
    }

    @Test fun `주행 제한만 켜져도 주행이라 칩이 뜬다`() {
        assertEquals("00:40 고객 미팅", session.handle(Event.RestrictionChanged(true)).chip())
    }

    @Test fun `다음 일정이 없으면 칩을 두지 않는다`() {
        begin()
        assertEquals(null, session.handle(Event.GearChanged(Gear.DRIVE)).chip())
    }

    @Test fun `종일 일정은 칩이 되지 않는다`() {
        begin(Schedule("d", "광주 직관 날", at(0), at(1440), allDay = true), lunch)
        assertEquals("03:00 점심 약속", session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        begin(Schedule("d", "광주 직관 날", at(0), at(1440), allDay = true))
        assertEquals(null, session.handle(Event.GearChanged(Gear.DRIVE)).chip())
    }

    @Test fun `도착하면 칩이 다음 일정으로 바뀐다`() {
        acceptRoute()
        assertEquals("00:40 고객 미팅", session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        assertEquals("03:00 점심 약속", session.handle(Event.DestinationArrived).chip())
    }

    @Test fun `마지막 일정에 도착하면 칩이 사라진다`() {
        begin(meeting)
        acceptRoute()
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals("", session.handle(Event.DestinationArrived).chip())
    }

    /** 점심(90분)이 고객 미팅(40~100분)과 겹쳐 겹침 카드에서 다음 일정(점심)을 골라 길안내를 시작한다. 길안내 중인 일정이 칩의 '다음 일정'(미팅)과 달라진다. */
    private fun routeToSecondOfOverlap(result: Boolean? = true) {
        val overlapLunch = Schedule("b", "점심 약속", at(90), at(150), place = cityHall)
        begin(meeting, overlapLunch)
        session.handle(Event.Boarded)
        val request = session.handle(Event.SecondaryPressed).filterIsInstance<Effect.RequestTravelTime>().single()
        session.handle(Event.TravelTimeResult(request.requestId, null))
        session.handle(Event.PrimaryPressed)
        result?.let { session.handle(Event.RouteRequestResult(it)) }
    }

    @Test fun `경로 요청이 실패하면 길안내 기억을 지워 칩이 남은 첫 일정이다`() {
        routeToSecondOfOverlap(result = false)
        assertEquals("00:40 고객 미팅", session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        // 실패한 길안내의 도착 알림은 도착으로 보지 않는다(칩이 그대로다).
        assertEquals(null, session.handle(Event.DestinationArrived).chip())
    }

    @Test fun `주행 중에 경로 요청 실패 결과가 오면 칩이 길안내 일정에서 남은 첫 일정으로 바뀐다`() {
        routeToSecondOfOverlap(result = null)
        // 결과가 오기 전에는 수락한 일정(점심)이 칩이다.
        assertEquals("01:30 점심 약속", session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        assertEquals("00:40 고객 미팅", session.handle(Event.RouteRequestResult(false)).chip())
    }

    @Test fun `길안내 중에는 칩이 지금 가고 있는 일정이고 도착하면 다음 일정으로 바뀐다`() {
        routeToSecondOfOverlap()
        // 먼저인 일정(고객 미팅)이 아직 남아 있어도 길안내 중인 점심 약속이 칩이다.
        assertEquals("01:30 점심 약속", session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        // 도착하면 길안내 일정이 끝나 지금처럼 남은 일정 중 첫 일정(고객 미팅)이다.
        assertEquals("00:40 고객 미팅", session.handle(Event.DestinationArrived).chip())
    }

    @Test fun `길안내가 없으면 칩은 지금처럼 다음 일정이다`() {
        begin(meeting, lunch)
        // 겹치지 않는 두 일정에서 수락 없이 주행을 시작하면 길안내가 없으므로 첫 일정이다.
        assertEquals("00:40 고객 미팅", session.handle(Event.GearChanged(Gear.DRIVE)).chip())
    }

    @Test fun `길안내 중인 일정이 건너뜀이 되면 칩은 남은 첫 일정으로 돌아온다`() {
        routeToSecondOfOverlap()
        assertEquals("01:30 점심 약속", session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        // 점심 약속이 끝난 뒤(고객 미팅도 지났다): 둘 다 건너뜀이라 칩이 사라진다.
        clock.now = at(151)
        assertEquals("", session.handle(Event.ClockChanged).chip())
    }

    @Test fun `연결이 풀리면 길안내 기억도 지운다`() {
        routeToSecondOfOverlap()
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals("", session.handle(Event.Unpaired).chip())
        // 새 운전자가 연결해 달리는 중이어도 지난 길안내 일정(점심)이 아니라 남은 첫 일정이 칩이다.
        assertEquals("00:40 고객 미팅", session.handle(Event.Paired(brief = false)).chip())
    }

    private fun List<Effect>.timer(): Effect.ScheduleChipRecheck? = filterIsInstance<Effect.ScheduleChipRecheck>().lastOrNull()

    /** 칩 표시·타이머 효과가 없다(건너뜀 저장 같은 다른 효과는 있을 수 있다). */
    private fun assertNoChipEffects(out: List<Effect>) =
        assertTrue(out.toString(), out.none { it is Effect.ShowNextChip || it is Effect.ScheduleChipRecheck })

    private val slack = DriveSession.CHIP_RECHECK_SLACK

    @Test fun `칩이 뜨면 대상 일정이 끝나는 시각에 다시 판단하는 타이머를 건다`() {
        val out = session.handle(Event.GearChanged(Gear.DRIVE))
        // 고객 미팅은 01:40에 끝난다(시작 00:00 기준 100분)
        assertEquals(Duration.ofMinutes(100) + slack, out.timer()!!.delay)
    }

    @Test fun `이벤트 없이 시계만 흘러 대상이 끝나면 타이머 이벤트로 다음 일정 칩이 된다`() {
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        clock.now = at(101)
        val out = session.handle(Event.ChipRecheck(first.timerId))
        assertEquals("03:00 점심 약속", out.chip())
        // 새 칩은 점심이 끝나는 04:00에 다시 판단한다
        assertEquals(Duration.ofMinutes(240 - 101) + slack, out.timer()!!.delay)
    }

    @Test fun `마지막 일정이 끝나면 타이머 이벤트로 칩이 사라지고 타이머도 없다`() {
        begin(meeting)
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        clock.now = at(101)
        val out = session.handle(Event.ChipRecheck(first.timerId))
        assertEquals("", out.chip())
        assertEquals(null, out.timer())
    }

    @Test fun `낡은 타이머는 무시한다`() {
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        session.handle(Event.GearChanged(Gear.PARK)) // 칩이 숨겨져 타이머가 무효가 된다
        clock.now = at(101)
        assertNoChipEffects(session.handle(Event.ChipRecheck(first.timerId)))
        // 다시 주행하면 새 타이머가 걸리고, 예전 번호는 여전히 무시된다
        val second = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        assertTrue(second.timerId != first.timerId)
        assertNoChipEffects(session.handle(Event.ChipRecheck(first.timerId)))
    }

    @Test fun `칩이 바뀌면 이전 타이머는 무시된다`() {
        acceptRoute()
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        val arrived = session.handle(Event.DestinationArrived)
        assertEquals("03:00 점심 약속", arrived.chip())
        val second = arrived.timer()!!
        assertTrue(second.timerId != first.timerId)
        clock.now = at(101)
        assertNoChipEffects(session.handle(Event.ChipRecheck(first.timerId)))
    }

    @Test fun `자정을 넘겨 이어지는 일정은 자정에 깨우지 않고 끝 시각에 다시 판단한다`() {
        // 전날 23:00 시작, 다음 날 02:00 끝나는 일정: 자정에 깨워도 칩이 안 바뀌므로 끝 시각(26시간 뒤)에만 깨운다
        val night = Schedule("n", "야간 근무", start - Duration.ofHours(1), start + Duration.ofHours(26), place = gangnam)
        begin(night)
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        assertEquals(Duration.ofHours(26) + slack, first.delay)
        clock.now = start + Duration.ofHours(24) // 자정을 넘겨도 일정이 남아 칩은 그대로
        assertNoChipEffects(session.handle(Event.GearChanged(Gear.REVERSE)))
    }

    @Test fun `시계가 건너뛰면 예약 시각을 다시 맞추고 다른 동작은 일으키지 않는다`() {
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        clock.now = at(101) // 대상이 끝나는 시각을 지나도록 시계가 뛰었다
        val out = session.handle(Event.ClockChanged)
        assertEquals("03:00 점심 약속", out.chip())
        assertTrue(out.timer()!!.timerId != first.timerId)
        assertEquals(Duration.ofMinutes(240 - 101) + slack, out.timer()!!.delay)
        assertTrue(out.toString(), out.none { it is Effect.Speak || it is Effect.ShowCard || it is Effect.RequestTravelTime || it is Effect.RefreshSchedules })
    }

    @Test fun `정차 중 시계가 바뀌어도 아무것도 하지 않는다`() {
        assertTrue(session.handle(Event.ClockChanged).isEmpty())
    }

    @Test fun `주행 중 대상이 없다가 일정을 받으면 칩이 나타난다`() {
        begin()
        assertEquals(null, session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        schedules = listOf(meeting)
        session.handle(Event.ScheduleLoading(1))
        assertEquals("00:40 고객 미팅", session.handle(Event.ScheduleLoaded(1)).chip())
    }

    @Test fun `받는 중 재판단 이벤트가 오면 받기가 끝날 때 다시 예약한다`() {
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        session.handle(Event.ScheduleLoading(1))
        clock.now = at(101)
        assertNoChipEffects(session.handle(Event.ChipRecheck(first.timerId)))
        val loaded = session.handle(Event.ScheduleLoaded(1))
        assertEquals("03:00 점심 약속", loaded.chip())
        assertTrue(loaded.timer()!!.timerId != first.timerId)
    }

    @Test fun `주행 중 초기화해도 칩 예약을 다시 맞춘다`() {
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        val out = session.handle(Event.Reset)
        assertTrue(out.timer()!!.timerId != first.timerId)
        assertNoChipEffects(session.handle(Event.ChipRecheck(first.timerId)))
    }

    @Test fun `종일 일정만 있으면 칩도 타이머도 없다`() {
        begin(Schedule("d", "광주 직관 날", at(0), at(1440), allDay = true))
        assertNoChipEffects(session.handle(Event.GearChanged(Gear.DRIVE)))
    }

    @Test fun `타이머가 일찍 와도 다시 예약한다`() {
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        clock.now = at(99) // 아직 끝나지 않음
        val out = session.handle(Event.ChipRecheck(first.timerId))
        assertEquals(null, out.chip())
        assertEquals(Duration.ofMinutes(1) + slack, out.timer()!!.delay)
    }

    @Test fun `일정을 받는 중에는 주행 중이어도 칩을 바꾸지 않는다`() {
        session.handle(Event.GearChanged(Gear.DRIVE)) // 칩 00:40 고객 미팅
        schedules = listOf(lunch)
        val loading = session.handle(Event.ScheduleLoading(1))
        assertEquals(null, loading.chip())
        // 받기가 끝나면 그때 맞춘다
        assertEquals("03:00 점심 약속", session.handle(Event.ScheduleLoaded(1)).chip())
    }

    @Test fun `받는 중에도 정차하면 칩은 숨긴다`() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.ScheduleLoading(1))
        assertEquals("", session.handle(Event.GearChanged(Gear.PARK)).chip())
    }

    @Test fun `연결 전에는 주행 중이어도 칩을 보이지 않고 연결되면 바로 보인다`() {
        beginUnpaired()
        assertEquals(null, session.handle(Event.GearChanged(Gear.DRIVE)).chip())
        assertNoChipEffects(session.handle(Event.RestrictionChanged(true)))
        assertEquals("00:40 고객 미팅", session.handle(Event.Paired(brief = false)).chip())
    }

    @Test fun `연결이 풀리면 주행 중 칩을 숨기고 타이머도 무효로 한다`() {
        val first = session.handle(Event.GearChanged(Gear.DRIVE)).timer()!!
        assertEquals("", session.handle(Event.Unpaired).chip())
        clock.now = at(101)
        assertNoChipEffects(session.handle(Event.ChipRecheck(first.timerId)))
    }

    @Test fun `Suspend 중에는 칩을 숨기고 돌아오면 다시 보인다`() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertEquals("", session.handle(Event.SuspendRequested).chip())
        assertNoChipEffects(session.handle(Event.GearChanged(Gear.REVERSE)))
        assertEquals("00:40 고객 미팅", session.handle(Event.Resumed).chip())
    }

    @Test fun `칩을 바꿀 때는 말하지 않는다`() {
        val out = session.handle(Event.GearChanged(Gear.DRIVE)) + session.handle(Event.GearChanged(Gear.PARK))
        assertTrue(out.none { it is Effect.Speak })
    }
}
