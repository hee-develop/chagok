package com.chagok.car

import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.fakenavi.FakeNaviSession
import com.chagok.car.fakenavi.TickScheduler
import com.chagok.car.flow.DriveSession
import com.chagok.car.flow.Effect
import com.chagok.car.flow.Event
import com.chagok.car.flow.ScheduleSnapshot
import com.chagok.car.runtime.Navigator
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [DriveSession] + [InjectedNavigator] + [FakeNaviSession](틱 없는 구성)을 [SessionHost]처럼 이벤트·Effect 순서로 이어 붙인 흐름 테스트.
 * 가짜 경로를 [FakeNaviSession.setProgress]로 옮겨 도착시킨다(실제 시계·Handler 없음).
 */
class FakeNaviFlowTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private class RecordingNavigator : Navigator {
        val calls = mutableListOf<String>()
        override fun start() { calls += "start" }
        override fun stop() { calls += "stop" }
        override fun requestTravelTime(requestId: Int, place: Place) { calls += "travel" }
        override fun startRoute(place: Place): Boolean { calls += "route"; return true }
        override fun requestLocation() { calls += "location" }
    }

    private object NoTicks : TickScheduler {
        override fun postDelayed(task: Runnable, delayMs: Long) = Unit
        override fun cancel(task: Runnable) = Unit
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val lunchPlace = Place("광주 육전집", LatLng(35.1595, 126.8526))
    private val gamePlace = Place("챔피언스필드", LatLng(35.1682, 126.8889))
    private val lunch = Schedule("lunch", "육전집 점심", start + Duration.ofMinutes(40), start + Duration.ofMinutes(100), place = lunchPlace)
    private val game = Schedule("game", "KIA 직관", start + Duration.ofMinutes(180), start + Duration.ofMinutes(240), place = gamePlace)

    private val clock = MutableClock(start)
    private val session = DriveSession(clock, { ScheduleSnapshot(listOf(lunch, game)) })
    private val inner = RecordingNavigator()
    private val fake = FakeNaviSession(NoTicks, { 0L }, { })
    private val queue = ArrayDeque<Event>()
    private val navigator = InjectedNavigator(inner, { queue += it }, fake)

    /** 세션에 들어간 이벤트와 마지막으로 저장한 일정 상태 */
    private val events = mutableListOf<Event>()
    private val effects = mutableListOf<Effect>()
    private var statuses: Map<String, ScheduleStatus> = emptyMap()

    @Before fun setUp() {
        DebugInjection.fakeNavi = true
        DebugInjection.tripSeconds = 1_800 // 출발 시각(40 - 30 - 10분)이 지금이라 출발 제안이 뜬다
        DebugInjection.routeOk = null
        DebugInjection.injectedLocation = null
        DebugHooks.connect(fake) { queue += it }
    }

    @After fun tearDown() {
        DebugInjection.fakeNavi = false
        DebugInjection.tripSeconds = null
        DebugInjection.routeOk = null
        DebugInjection.injectedLocation = null
    }

    /** [com.chagok.car.runtime.SessionHost]처럼 이벤트를 하나씩 세션에 넣고 나온 Effect를 순서대로 실행한다. 실행 중 넣은 이벤트는 큐 뒤에 선다. */
    private fun send(event: Event) {
        queue += event
        drain()
    }

    private fun drain() {
        while (queue.isNotEmpty()) {
            val next = queue.removeFirst()
            events += next
            for (effect in session.handle(next)) {
                effects += effect
                when (effect) {
                    is Effect.RequestTravelTime -> navigator.requestTravelTime(effect.requestId, effect.place)
                    is Effect.StartRoute -> queue += Event.RouteRequestResult(navigator.startRoute(effect.place))
                    Effect.RequestLocation -> navigator.requestLocation()
                    Effect.EnterSuspend -> navigator.stop()
                    Effect.ExitSuspend -> navigator.start()
                    is Effect.Save -> statuses = effect.snapshot.statuses
                    else -> Unit
                }
            }
        }
    }

    private fun status(id: String) = statuses[id] ?: ScheduleStatus.PLANNED

    private fun arrivals() = events.count { it == Event.DestinationArrived }

    /** 정차 중 탑승 → 출발 제안 수락 → 육전집으로 가짜 길안내 시작. */
    private fun acceptRoute() {
        send(Event.GearChanged(Gear.PARK))
        send(Event.Boarded)
        send(Event.PrimaryPressed)
    }

    @Test fun `가짜 경로 수락 후 주행하다 도착하면 대상 일정만 도착이고 P단에서 다음 일정은 도착이 아니다`() {
        acceptRoute()
        assertNotNull(fake.trip)
        assertEquals(lunchPlace, fake.trip!!.route.destination)
        assertTrue(effects.any { it == Effect.StartRoute(lunchPlace) })
        assertTrue(inner.calls.isEmpty()) // 실제 내비는 거치지 않았다

        send(Event.GearChanged(Gear.DRIVE))
        assertEquals(ScheduleStatus.PLANNED, status("lunch"))

        // 가짜 내비가 목적지에 닿으면 위치와 도착 알림을 세션에 넣는다.
        fake.setProgress(1.0)
        drain()
        assertEquals(1, arrivals())
        assertEquals(ScheduleStatus.ARRIVED, status("lunch"))
        assertEquals(ScheduleStatus.PLANNED, status("game"))

        // P단: 다음 일정(KIA 직관)을 위치로 판단한다. 가짜 경로 끝(육전집)은 그 장소에서 멀어 도착이 아니다.
        effects.clear()
        send(Event.GearChanged(Gear.PARK))
        assertTrue(effects.contains(Effect.RequestLocation))
        assertTrue(events.contains(Event.LocationChanged(lunchPlace.position))) // 위치 요청에 가짜 경로 끝으로 답했다
        assertEquals(ScheduleStatus.ARRIVED, status("lunch"))
        assertEquals(ScheduleStatus.PLANNED, status("game"))
        assertEquals(1, arrivals())
    }

    @Test fun `route=fail이면 이전 가짜 경로를 지워 옛 경로가 도착 이벤트를 내지 않는다`() {
        acceptRoute()
        assertNotNull(fake.trip) // 첫 길안내는 성공

        // 같은 일정에 대해 다시 길안내를 요청했는데 실패한다.
        DebugInjection.routeOk = false
        send(Event.Boarded)
        send(Event.PrimaryPressed)
        assertNull(fake.trip)
        assertTrue(effects.contains(Effect.StartRoute(lunchPlace)))

        send(Event.GearChanged(Gear.DRIVE))
        fake.setProgress(1.0) // 경로가 없어 무시
        drain()
        assertEquals(0, arrivals())
        assertFalse(status("lunch") == ScheduleStatus.ARRIVED)
    }

    @Test fun `Suspend 동안에는 가짜 내비도 멈춰 도착을 넣지 않고 재개하면 이어 간다`() {
        acceptRoute()
        send(Event.GearChanged(Gear.DRIVE))

        send(Event.SuspendRequested)
        assertEquals(listOf("stop"), inner.calls)
        val before = events.size
        fake.setProgress(1.0) // 멈춘 동안은 무시
        drain()
        assertEquals(before, events.size)
        assertEquals(0, arrivals())

        send(Event.Resumed)
        assertEquals(listOf("stop", "start"), inner.calls)
        fake.setProgress(1.0)
        drain()
        assertEquals(1, arrivals())
        assertEquals(ScheduleStatus.ARRIVED, status("lunch"))
    }
}
