package com.chagok.car

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.fakenavi.FakeNaviSession
import com.chagok.car.fakenavi.FakeRoute
import com.chagok.car.fakenavi.TickScheduler
import com.chagok.car.flow.Event
import com.chagok.car.runtime.Navigator
import java.time.Duration
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 디버그 내비 래퍼: 가짜 내비를 켜지 않으면(기본) 실제 내비에 그대로 맡기고, 켜면 가짜 경로로 답한다. */
class InjectedNavigatorTest {
    private class RecordingNavigator : Navigator {
        val calls = mutableListOf<String>()
        override fun start() { calls += "start" }
        override fun stop() { calls += "stop" }
        override fun requestTravelTime(requestId: Int, place: Place) { calls += "travel:${place.name}" }
        override fun startRoute(place: Place): Boolean { calls += "route:${place.name}"; return true }
        override fun requestLocation() { calls += "location" }
    }

    private object NoTicks : TickScheduler {
        override fun postDelayed(task: Runnable, delayMs: Long) = Unit
        override fun cancel(task: Runnable) = Unit
    }

    private val place = Place("광주 육전집", LatLng(35.1595, 126.8526))
    private val inner = RecordingNavigator()
    private val posted = mutableListOf<Event>()
    private val fake = FakeNaviSession(NoTicks, { 0L }, { })
    private val navigator = InjectedNavigator(inner, { posted += it }, fake)

    @Before fun setUp() = reset()

    @After fun tearDown() = reset()

    private fun reset() {
        DebugInjection.fakeNavi = false
        DebugInjection.tripSeconds = null
        DebugInjection.routeOk = null
        DebugInjection.injectedLocation = null
    }

    @Test fun `기본값은 소요 시간·길안내·위치를 실제 내비에 맡긴다`() {
        navigator.requestTravelTime(1, place)
        assertTrue(navigator.startRoute(place))
        navigator.requestLocation()
        assertEquals(listOf("travel:광주 육전집", "route:광주 육전집", "location"), inner.calls)
        assertTrue(posted.isEmpty())
        assertNull(fake.trip)
    }

    @Test fun `가짜 내비는 trip이 없으면 가짜 경로 길이로 소요 시간을 답한다`() {
        DebugInjection.fakeNavi = true
        navigator.requestTravelTime(7, place)
        assertEquals(listOf<Event>(Event.TravelTimeResult(7, FakeRoute.to(place).duration)), posted)
        assertTrue(inner.calls.isEmpty())
    }

    @Test fun `trip 주입값은 가짜 내비보다 먼저다`() {
        DebugInjection.fakeNavi = true
        DebugInjection.tripSeconds = 12_000
        navigator.requestTravelTime(2, place)
        assertEquals(Event.TravelTimeResult(2, Duration.ofSeconds(12_000)), posted.single())
        posted.clear()
        DebugInjection.tripSeconds = DebugInjection.NO_TRIP
        navigator.requestTravelTime(3, place)
        assertEquals(Event.TravelTimeResult(3, null), posted.single())
    }

    @Test fun `가짜 내비의 길안내는 실제 내비를 거치지 않고 경로를 시작한다`() {
        DebugInjection.fakeNavi = true
        assertTrue(navigator.startRoute(place))
        assertNotNull(fake.trip)
        assertTrue(inner.calls.isEmpty())
    }

    @Test fun `route=fail이면 가짜 경로를 시작하지 않고 실패로 답한다`() {
        DebugInjection.fakeNavi = true
        DebugInjection.routeOk = false
        assertFalse(navigator.startRoute(place))
        assertNull(fake.trip)
    }

    @Test fun `가짜 경로가 있으면 위치 요청에 경로 위 차 위치로 답한다`() {
        DebugInjection.fakeNavi = true
        navigator.requestLocation()
        assertEquals(listOf("location"), inner.calls) // 경로가 없으면 실제 내비에 묻는다
        assertTrue(posted.isEmpty())

        fake.start(place)
        fake.setProgress(1.0)
        posted.clear()
        navigator.requestLocation()
        assertEquals(1, inner.calls.size)
        assertEquals(listOf<Event>(Event.LocationChanged(place.position, naviAnswer = true)), posted) // 도착했으면 목적지 좌표
    }

    @Test fun `route=fail은 남아 있던 이전 가짜 경로를 지운다`() {
        DebugInjection.fakeNavi = true
        assertTrue(navigator.startRoute(place))
        assertNotNull(fake.trip)
        DebugInjection.routeOk = false
        assertFalse(navigator.startRoute(place))
        assertNull(fake.trip)
    }

    @Test fun `loc을 주입했으면 가짜 내비가 켜져 있어도 가짜 경로 위치 대신 주입 위치로 답한다`() {
        DebugInjection.fakeNavi = true
        fake.start(place)
        fake.setProgress(1.0)
        val injected = LatLng(35.1690, 126.8888)
        DebugInjection.injectedLocation = injected
        posted.clear()
        navigator.requestLocation()
        assertEquals(listOf<Event>(Event.LocationChanged(injected, naviAnswer = true)), posted)
        assertTrue(inner.calls.isEmpty())
    }

    @Test fun `가짜 내비가 꺼져 있어도 loc을 주입했으면 실제 내비에 묻지 않고 주입 위치로 답한다`() {
        val injected = LatLng(35.1690, 126.8888)
        DebugInjection.injectedLocation = injected
        navigator.requestLocation()
        assertTrue(inner.calls.isEmpty())
        assertEquals(listOf<Event>(Event.LocationChanged(injected, naviAnswer = true)), posted)
    }

    @Test fun `loc을 주입한 동안에는 실제 내비의 위치 답도 어댑터의 실제 위치도 버리고 가짜 내비가 켜져 있으면 실제 위치를 받지 않는다`() {
        val out = mutableListOf<Event>()
        val naviSink = DebugHooks.naviSink { out += it }
        val locationSink = DebugHooks.locationSink { out += it }
        val real = Event.LocationChanged(LatLng(35.1, 126.8))
        naviSink(real); locationSink(real)
        assertEquals(listOf(real, real), out) // 주입도 가짜 내비도 없으면 그대로 통과
        out.clear()

        DebugInjection.injectedLocation = LatLng(35.2, 126.9)
        naviSink(real); locationSink(real)
        naviSink(Event.DestinationArrived)
        assertEquals(listOf<Event>(Event.DestinationArrived), out) // 위치만 막고 다른 이벤트는 통과
        out.clear()

        DebugInjection.injectedLocation = null
        DebugInjection.fakeNavi = true
        assertFalse(DebugHooks.acceptsRealLocation())
        locationSink(real)
        assertTrue(out.isEmpty())
    }

    @Test fun `loc을 주입한 동안에는 가짜 경로 위치 이벤트도 넣지 않는다`() {
        DebugHooks.connect(fake) { posted += it }
        DebugInjection.fakeNavi = true
        DebugInjection.injectedLocation = LatLng(35.1690, 126.8888)
        fake.start(place)
        assertTrue(posted.none { it is Event.LocationChanged })
        DebugInjection.injectedLocation = null
        fake.setProgress(0.5)
        assertTrue(posted.any { it is Event.LocationChanged })
    }

    @Test fun `stop하면 가짜 내비도 멈추고 start하면 이어 간다`() {
        DebugHooks.connect(fake) { posted += it }
        DebugInjection.fakeNavi = true
        assertTrue(navigator.startRoute(place))
        posted.clear()
        navigator.stop()
        fake.setProgress(1.0)
        assertTrue(posted.isEmpty())
        assertTrue(fake.trip!!.remainingRatio > 0.99)
        navigator.start()
        fake.setProgress(1.0)
        assertTrue(posted.contains(Event.DestinationArrived))
        assertEquals(listOf("stop", "start"), inner.calls)
    }
}
