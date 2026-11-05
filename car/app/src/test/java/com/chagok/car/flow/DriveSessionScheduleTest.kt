package com.chagok.car.flow

import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 일정을 받는 동안의 탑승 보류, 받기 실패·저장된 사본·다시 받기 처리. */
class DriveSessionScheduleTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private class Source(var schedules: List<Schedule>, var origin: ScheduleOrigin) : ScheduleSource {
        override fun snapshot() = ScheduleSnapshot(schedules, origin)
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val cityHall = Place("서울시청", LatLng(37.5663, 126.9779))
    private val meeting = Schedule("a", "고객 미팅", start + Duration.ofMinutes(40), start + Duration.ofMinutes(100), place = gangnam)
    private val lunch = Schedule("b", "점심 약속", start + Duration.ofMinutes(180), start + Duration.ofMinutes(240), place = cityHall)
    private lateinit var clock: MutableClock
    private lateinit var source: Source
    private lateinit var session: DriveSession

    private inline fun <reified T : Effect> List<Effect>.has() = any { it is T }
    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()

    @Before
    fun setUp() {
        clock = MutableClock(start)
        source = Source(listOf(meeting), ScheduleOrigin.FRESH)
        session = DriveSession(clock, source)
        session.handle(Event.GearChanged(Gear.PARK))
    }

    /** 세션이 다시 받기를 요청하면 [generation]세대로 받기를 시작하고 끝낸다. 끝난 뒤의 Effect를 돌려준다. */
    private fun refreshCycle(generation: Int = 1): List<Effect> {
        session.handle(Event.ScheduleLoading(generation))
        return session.handle(Event.ScheduleLoaded(generation))
    }

    private fun boardWithCard(): List<Effect> {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        return session.handle(Event.TravelTimeResult(request.requestId, null))
    }

    // ---- 받는 동안 보류 ----

    @Test fun `일정을 받는 동안 탑승은 보류하고 받기가 끝나면 이어 간다`() {
        session.handle(Event.ScheduleLoading(1))
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
        assertEquals(emptyList<Effect>(), session.handle(Event.AppEntered))

        val out = session.handle(Event.ScheduleLoaded(1))
        assertEquals(gangnam, out.one<Effect.RequestTravelTime>().place)
        assertTrue(session.handle(Event.ScheduleLoaded(1)).none { it is Effect.RequestTravelTime })
    }

    @Test fun `시동 ON으로 이어지는 탑승도 보류한다`() {
        session.handle(Event.IgnitionChanged(Ignition.OFF))
        session.handle(Event.ScheduleLoading(1))
        assertTrue(session.handle(Event.IgnitionChanged(Ignition.ON)).none { it is Effect.RequestTravelTime })
        assertTrue(session.handle(Event.ScheduleLoaded(1)).has<Effect.RequestTravelTime>())
    }

    @Test fun `받는 동안에도 기어 제한 닫기 Suspend는 바로 처리한다`() {
        boardWithCard()
        session.handle(Event.ScheduleLoading(1))
        val closed = session.handle(Event.CloseRequested)
        assertTrue(closed.has<Effect.StopVoice>())
        assertEquals(Effect.CollapseCard(false), closed.one<Effect.CollapseCard>())
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(session.isDriving)
        session.handle(Event.GearChanged(Gear.PARK))
        session.handle(Event.RestrictionChanged(true))
        assertTrue(session.isDriving)
        assertEquals(Effect.EnterSuspend, session.handle(Event.SuspendRequested).last())
    }

    @Test fun `받는 동안 카드 타이머는 바로 처리한다`() {
        val timer = boardWithCard().one<Effect.ScheduleCardTimeout>()
        session.handle(Event.ScheduleLoading(1))
        assertTrue(session.handle(Event.CardTimedOut(timer.timerId)).has<Effect.CollapseCard>())
    }

    @Test fun `보류 중 주행이 시작되면 보류한 탑승은 버린다`() {
        session.handle(Event.ScheduleLoading(1))
        session.handle(Event.Boarded)
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.GearChanged(Gear.PARK))
        assertTrue(session.handle(Event.ScheduleLoaded(1)).none { it is Effect.RequestTravelTime })
    }

    @Test fun `보류 중 Suspend가 되면 보류한 탑승은 버린다`() {
        session.handle(Event.ScheduleLoading(1))
        session.handle(Event.Boarded)
        session.handle(Event.SuspendRequested)
        session.handle(Event.Resumed)
        assertTrue(session.handle(Event.ScheduleLoaded(1)).none { it is Effect.RequestTravelTime })
    }

    @Test fun `보류 중 데모 초기화를 해도 이후 탑승은 받기가 끝나면 이어 간다`() {
        session.handle(Event.ScheduleLoading(1))
        session.handle(Event.Reset)
        session.handle(Event.AppEntered)
        assertTrue(session.handle(Event.ScheduleLoaded(1)).has<Effect.RequestTravelTime>())
    }

    @Test fun `마지막 세대의 완료에만 보류를 푼다`() {
        session.handle(Event.ScheduleLoading(1))
        session.handle(Event.ScheduleLoading(2))
        session.handle(Event.Boarded)
        // 오래된 세대의 완료는 무시한다.
        assertTrue(session.handle(Event.ScheduleLoaded(1)).none { it is Effect.RequestTravelTime })
        assertTrue(session.handle(Event.Boarded).none { it is Effect.RequestTravelTime })
        assertTrue(session.handle(Event.ScheduleLoaded(2)).has<Effect.RequestTravelTime>())
    }

    @Test fun `받는 동안에는 이전 일정 캐시를 새 시각 기준으로 지난 일정 처리하지 않는다`() {
        // 데모 시각을 하루 뒤로 옮기고 받기를 시작한다. 캐시는 아직 이전 날 일정이다.
        clock.now = start + Duration.ofDays(1)
        session.handle(Event.ScheduleLoading(1))
        session.handle(Event.Reset)
        source.schedules = listOf(meeting.copy(start = clock.now + Duration.ofMinutes(40), end = clock.now + Duration.ofMinutes(100)))
        session.handle(Event.AppEntered)

        assertEquals(gangnam, session.handle(Event.ScheduleLoaded(1)).one<Effect.RequestTravelTime>().place)
    }

    // ---- 출처가 최신이 아닐 때 다시 받기 ----

    @Test fun `일정 출처가 최신이 아니면 탑승 판단 전에 다시 받는다`() {
        source.origin = ScheduleOrigin.STORED
        val out = session.handle(Event.Boarded)
        assertTrue(out.has<Effect.RefreshSchedules>())
        assertTrue(out.none { it is Effect.RequestTravelTime || it is Effect.ShowCard })

        // 받는 동안 다른 탑승 신호는 보류한다. 다시 받기를 겹쳐 요청하지 않는다.
        assertEquals(emptyList<Effect>(), session.handle(Event.AppEntered))

        // 받기가 성공하면 그 일정으로 판단한다.
        session.handle(Event.ScheduleLoading(1))
        source.origin = ScheduleOrigin.FRESH
        val request = session.handle(Event.ScheduleLoaded(1)).one<Effect.RequestTravelTime>()
        val card = session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ShowCard>().card
        assertNull(card.footnote)
    }

    @Test fun `다시 받기가 끝나기 전에 도착한 오래된 완료는 보류를 풀지 않는다`() {
        source.origin = ScheduleOrigin.STORED
        session.handle(Event.Boarded)
        // 요청 직후 실행한 쪽이 세대를 알려 주기 전에 이전 세대의 완료가 먼저 들어온다.
        assertTrue(session.handle(Event.ScheduleLoaded(0)).none { it is Effect.RequestTravelTime || it is Effect.ShowCard })
        session.handle(Event.ScheduleLoading(1))
        source.origin = ScheduleOrigin.FRESH
        assertTrue(session.handle(Event.ScheduleLoaded(1)).has<Effect.RequestTravelTime>())
    }

    @Test fun `같은 세대의 완료가 받기 시작보다 먼저 와도 시작이 오면 이미 끝난 것으로 처리한다`() {
        source.origin = ScheduleOrigin.STORED
        session.handle(Event.Boarded)
        source.origin = ScheduleOrigin.FRESH
        // 완료가 먼저 도착한다(세대 확정 전이라 기억만 한다).
        assertTrue(session.handle(Event.ScheduleLoaded(1)).none { it is Effect.RequestTravelTime })
        // 같은 세대의 시작이 오면 바로 이어 간다.
        assertTrue(session.handle(Event.ScheduleLoading(1)).has<Effect.RequestTravelTime>())
    }

    @Test fun `받기 시작은 세대가 늘 때만 받는다`() {
        session.handle(Event.ScheduleLoading(2))
        session.handle(Event.Boarded)
        // 더 오래된 시작이 뒤늦게 와도 세대가 되돌아가지 않는다.
        session.handle(Event.ScheduleLoading(1))
        assertTrue(session.handle(Event.ScheduleLoaded(1)).none { it is Effect.RequestTravelTime })
        assertTrue(session.handle(Event.ScheduleLoaded(2)).has<Effect.RequestTravelTime>())
    }

    @Test fun `데모 초기화가 끼어들어도 세대가 되돌아가지 않아 보류가 풀린다`() {
        source.origin = ScheduleOrigin.STORED
        session.handle(Event.ScheduleLoading(3))
        session.handle(Event.ScheduleLoaded(3))
        session.handle(Event.Reset)
        // 세션이 다시 받기를 요청하면 세대는 확정 전이 되고, 이후 더 큰 세대의 시작과 완료로 풀린다.
        assertTrue(session.handle(Event.Boarded).has<Effect.RefreshSchedules>())
        session.handle(Event.Reset)
        session.handle(Event.ScheduleLoading(2))
        session.handle(Event.ScheduleLoading(4))
        source.origin = ScheduleOrigin.FRESH
        assertTrue(session.handle(Event.ScheduleLoaded(4)).none { it is Effect.RefreshSchedules })
    }

    @Test fun `일정 안내 기록은 스냅샷에 담겨 프로세스를 다시 시작해도 이어진다`() {
        givenNoSchedule()
        session.handle(Event.AppEntered)
        val shown = refreshCycle(1)
        val saved = shown.filterIsInstance<Effect.Save>().last().snapshot
        assertEquals(java.time.LocalDate.of(2026, 12, 3), saved.noticeDate)

        // 같은 날 새 세션(프로세스 재시작)에서는 안내하지 않는다.
        val restarted = DriveSession(clock, source, saved)
        restarted.handle(Event.GearChanged(Gear.PARK))
        restarted.handle(Event.AppEntered)
        restarted.handle(Event.ScheduleLoading(1))
        val out = restarted.handle(Event.ScheduleLoaded(1))
        assertTrue(out.none { it is Effect.Speak || it is Effect.ShowCard })
    }

    @Test fun `다시 받아도 사본뿐이면 사본 문구로 브리핑하고 같은 탑승에서 또 받지 않는다`() {
        source.origin = ScheduleOrigin.STORED
        assertTrue(session.handle(Event.Boarded).has<Effect.RefreshSchedules>())
        val loaded = refreshCycle()
        assertFalse(loaded.has<Effect.RefreshSchedules>())
        val request = loaded.one<Effect.RequestTravelTime>()
        val card = session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ShowCard>().card
        assertEquals(Phrases.STALE_SCHEDULE, card.footnote)
        assertTrue(Phrases.spoken(card).endsWith(Phrases.STALE_SCHEDULE))
    }

    @Test fun `최신 일정으로 만든 카드에는 사본 문구가 없다`() {
        assertNull(boardWithCard().one<Effect.ShowCard>().card.footnote)
    }

    // ---- 일정을 못 받은 경우 ----

    private fun givenNoSchedule() {
        source.schedules = emptyList()
        source.origin = ScheduleOrigin.NONE
    }

    @Test fun `일정을 못 받았고 사본도 없으면 탑승을 소진하지 않고 안내만 보인다`() {
        givenNoSchedule()
        assertTrue(session.handle(Event.Boarded).has<Effect.RefreshSchedules>())
        val out = refreshCycle()
        val notice = out.one<Effect.ShowCard>().card
        assertEquals(Phrases.scheduleUnavailableCard(), notice)
        assertTrue(out.has<Effect.Speak>())
        // 탑승 기록은 남기지 않는다(안내 날짜만 저장된다).
        assertTrue(out.filterIsInstance<Effect.Save>().all { it.snapshot.log.lastBoardedOn == null })
        assertTrue(out.none { it is Effect.RequestTravelTime })
    }

    @Test fun `일정 안내는 그날 한 번만 말하고 이후 앱 진입은 조용하다`() {
        givenNoSchedule()
        session.handle(Event.AppEntered)
        assertTrue(refreshCycle(1).has<Effect.Speak>())
        // 안내를 닫고 내비 화면에서 돌아오듯 앱에 다시 들어온다. 받기는 다시 시도하지만 말하거나 띄우지 않는다.
        session.handle(Event.CloseRequested)
        val again = session.handle(Event.AppEntered)
        assertTrue(again.has<Effect.RefreshSchedules>())
        val after = refreshCycle(2)
        assertTrue(after.none { it is Effect.Speak || it is Effect.ShowCard })
        assertTrue(session.handle(Event.AppEntered).none { it is Effect.Speak || it is Effect.ShowCard })
    }

    @Test fun `다음 날에는 일정 안내를 다시 한다`() {
        givenNoSchedule()
        session.handle(Event.Boarded)
        refreshCycle(1)
        session.handle(Event.CloseRequested)
        clock.now += Duration.ofDays(1)
        session.handle(Event.Boarded)
        assertTrue(refreshCycle(2).has<Effect.Speak>())
    }

    @Test fun `일정 안내 카드가 떠 있는 동안 받기가 성공하면 브리핑으로 바뀐다`() {
        givenNoSchedule()
        session.handle(Event.Boarded)
        refreshCycle(1)

        session.handle(Event.ScheduleLoading(2))
        source.schedules = listOf(meeting)
        source.origin = ScheduleOrigin.FRESH
        val out = session.handle(Event.ScheduleLoaded(2))
        assertEquals(Effect.CollapseCard(instant = true), out.one<Effect.CollapseCard>())
        assertEquals(gangnam, out.one<Effect.RequestTravelTime>().place)
    }

    @Test fun `안내를 한 날 받기가 성공한 뒤 앱에 들어오면 정상 탑승 규칙대로 브리핑한다`() {
        givenNoSchedule()
        session.handle(Event.AppEntered)
        refreshCycle(1)
        session.handle(Event.CloseRequested)

        source.schedules = listOf(meeting)
        source.origin = ScheduleOrigin.FRESH
        assertTrue(session.handle(Event.AppEntered).has<Effect.RequestTravelTime>())
    }

    @Test fun `서버가 일정 없음으로 답하면 목적지를 묻고 받기 실패 안내와 다르다`() {
        source.schedules = emptyList()
        source.origin = ScheduleOrigin.FRESH
        val out = session.handle(Event.Boarded)
        assertEquals(Phrases.ASK_DESTINATION, out.one<Effect.ShowCard>().card.voice)
        assertTrue(out.has<Effect.Save>())
    }

    // ---- 소요 시간 응답의 대상 ----

    @Test fun `기다리는 사이 대상 일정이 바뀌면 그 소요 시간은 쓰지 않는다`() {
        source.schedules = listOf(meeting, lunch)
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        assertEquals(gangnam, request.place)
        // 대상이었던 고객 미팅이 사라지고 점심 약속이 대상이 된다.
        source.schedules = listOf(lunch)
        val card = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofHours(5))).one<Effect.ShowCard>().card
        // 5시간 소요를 점심 약속에 쓰면 늦게 탄 것으로 보이지만, 쓰지 않으므로 일반 인사다.
        assertFalse(card.voice.contains("도착이에요"))
        assertTrue(card.voice.contains("점심 약속"))
    }

    @Test fun `대상이 그대로면 소요 시간을 쓴다`() {
        source.schedules = listOf(meeting.copy(start = start + Duration.ofMinutes(10), end = start + Duration.ofMinutes(70)))
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        val card = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofHours(2))).one<Effect.ShowCard>().card
        assertTrue(card.voice.contains("도착이에요"))
    }
}
