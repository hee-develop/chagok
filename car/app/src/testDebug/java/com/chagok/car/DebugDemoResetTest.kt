package com.chagok.car

import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import com.chagok.car.flow.DriveSession
import com.chagok.car.flow.Effect
import com.chagok.car.flow.Event
import com.chagok.car.flow.ScheduleSnapshot
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** [데모 초기화] 버튼([DebugDemoReset]): 시연 시작 상태로(시계·기어·주입값) 돌아가고 앱 진입 판단을 한 번 돌린다. */
class DebugDemoResetTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = MutableClock(start)
    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val schedules = listOf(Schedule("a", "고객 미팅", start + Duration.ofMinutes(240), start + Duration.ofMinutes(300), place = gangnam))
    private lateinit var session: DriveSession
    private val log = mutableListOf<String>()
    private val effects = mutableListOf<Effect>()

    /** 세션과 시계에 그대로 반영하는 대상. 호출 순서도 적는다. */
    private val target = object : DebugDemoReset.Target {
        override fun post(event: Event) {
            log += event.toString()
            effects += session.handle(event)
        }

        override fun resetDemo(at: Instant) {
            log += "resetDemo($at)"
            clock.now = at
            effects += session.handle(Event.Reset)
        }
    }

    private var fakeRouteCleared = 0

    private fun reset(now: Instant) = DebugDemoReset.reset(target, now = now, clearFakeRoute = { fakeRouteCleared++ })

    @Before
    fun setUp() {
        DebugInjection.demoStartAt = null
        session = DriveSession(clock, { ScheduleSnapshot(schedules) }, paired = true)
        session.handle(Event.GearChanged(Gear.PARK))
    }

    @After
    fun tearDown() {
        DebugInjection.demoStartAt = null
        DebugInjection.injectedLocation = null
        DebugInjection.exitCardSeconds = null
    }

    @Test fun `마지막 now 시각으로 시계를 되돌리고 기어 P를 먼저 넣은 뒤 비우고 앱 진입을 넣는다`() {
        DebugInjection.demoStartAt = start
        clock.now = start + Duration.ofMinutes(50)
        reset(now = Instant.parse("2030-01-01T00:00:00Z"))
        assertEquals(start, clock.now)
        assertEquals(
            listOf("GearChanged(gear=PARK)", "RestrictionChanged(requiresDistractionOptimization=false)", "resetDemo($start)", "AppEntered"),
            log,
        )
    }

    @Test fun `now를 받은 적이 없으면 앱 시작 때의 시계 즉 실제 지금으로 돌아간다`() {
        val real = Instant.parse("2030-01-01T00:00:00Z")
        reset(now = real)
        assertEquals(real, clock.now)
    }

    @Test fun `주입 위치와 늘려 둔 하차 카드 시간을 지우고 시작 시각은 남겨 둔다`() {
        DebugInjection.demoStartAt = start
        DebugInjection.injectedLocation = gangnam.position
        DebugInjection.exitCardSeconds = 60
        reset(now = start)
        assertNull(DebugInjection.injectedLocation)
        assertNull(DebugInjection.exitCardSeconds)
        assertEquals(1, fakeRouteCleared)
        assertEquals(start, DebugInjection.demoStartAt)
    }

    @Test fun `시간을 밀고 주행한 뒤 초기화하면 정차 상태로 첫 탑승 브리핑이 다시 나온다`() {
        DebugInjection.demoStartAt = start
        // 시연: 시계를 밀고(+10분 여러 번) 주행 중인 상태
        clock.now = start + Duration.ofMinutes(60)
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(session.isDriving)
        effects.clear()

        reset(now = start)

        assertTrue("정차로 돌아와야 한다", !session.isDriving)
        // 앱 진입이 탑승으로 이어져 소요 시간을 묻고, 답이 오면 첫 탑승 브리핑 카드가 나온다.
        val request = effects.filterIsInstance<Effect.RequestTravelTime>().single()
        val card = session.handle(Event.TravelTimeResult(request.requestId, null)).filterIsInstance<Effect.ShowCard>().single().card
        assertTrue("첫 탑승 브리핑 카드: ${card.voice}", card.voice.contains("고객 미팅"))
    }
}
