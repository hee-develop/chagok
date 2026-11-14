package com.chagok.car

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Rules
import com.chagok.car.fakenavi.FakeNaviSession
import com.chagok.car.fakenavi.FakeRoute
import com.chagok.car.fakenavi.FakeTrip
import com.chagok.car.flow.Event
import com.chagok.car.runtime.Adapters
import com.chagok.car.runtime.Locator
import com.chagok.car.runtime.Navigator
import com.chagok.car.runtime.Speaker
import java.time.Duration

/**
 * E2E가 내비 결과와 듣기를 직접 정하게 하는 주입 값. 디버그 빌드에만 있고 릴리스 소스셋에는 [DebugHooks]의 항등 구현만 있다.
 * 값은 [DebugSignals]가 `chagok-debug://signal`의 `trip`·`route`·`listen`·`navi`·`drive`로 바꾼다.
 */
object DebugInjection {
    /** 소요 시간 조회 결과(초). null이면 실제 내비에 묻는다. [NO_TRIP]이면 "모름"으로 답한다. */
    @Volatile var tripSeconds: Long? = null

    /** 길안내 요청 결과. null이면 실제 내비에 요청한다. true·false면 내비를 거치지 않고 그 결과로 답한다. */
    @Volatile var routeOk: Boolean? = null

    /** false면 말이 끝나도 실제 STT를 열지 않는다. 들은 말은 `heard`로만 들어온다. */
    @Volatile var realListening: Boolean = true

    /** `heard`를 세션이 처리한 뒤 불린다. 디버그 줄이 화면에 표시한다. */
    @Volatile var heardProcessed: ((String) -> Unit)? = null

    /**
     * 하차 카드가 떠 있는 시간(초). null이면 [Rules.EXIT_CARD](5초)다.
     * 5초는 Maestro 확인에 빠듯해 E2E만 늘려 쓴다. 정책 기준값은 바꾸지 않고 release에는 없다. 신호 `exitcard=<초>`로 바꾼다.
     */
    @Volatile var exitCardSeconds: Long? = null

    /** true면 실제 내비 대신 가짜 길안내(직접 그린 지도)를 쓴다. 기본 false(실제 내비). */
    @Volatile var fakeNavi: Boolean = false

    /**
     * 신호 `loc`으로 주입한 위치. null이면 주입하지 않은 것이다(`loc=real`로 되돌린다).
     * 값이 있는 동안에는 위치 어댑터의 실제 위치, 가짜 경로 위 위치 이벤트, 실제 내비의 위치 답을 모두 세션에 넣지 않고
     * 위치를 묻는 [InjectedNavigator.requestLocation]은 이 값으로 답한다.
     */
    @Volatile var injectedLocation: LatLng? = null

    /** 가짜 경로 전체를 지나가는 데 걸리는 실제 시간(밀리초). 시연용 시간 압축 값이라 정책 기준값이 아니다. 신호 `drive=<초>`(소수 가능)로 바꾼다. */
    @Volatile var driveMillis: Long = DEFAULT_DRIVE_MILLIS

    /** 기본 4.5초. 처음 45초였는데 시연에서 너무 느려 10배 빠르게 했다(2026-11-12). */
    const val DEFAULT_DRIVE_MILLIS = 4_500L
    const val NO_TRIP = -1L
}

/** 디버그 빌드의 어댑터 묶음. 내비 결과와 듣기를 [DebugInjection]이 가로챌 수 있게 감싼다. */
object DebugHooks {
    /** 하차 카드를 띄워 두는 시간. [DebugInjection.exitCardSeconds]가 없으면 정책 기준값이다. */
    fun exitCardDuration(): Duration = DebugInjection.exitCardSeconds?.let { Duration.ofSeconds(it) } ?: Rules.EXIT_CARD

    /** 실제 내비의 위치 답이 쓰는 이벤트 출구. 위치를 주입한 동안([DebugInjection.injectedLocation])에는 그 답을 버린다. */
    fun naviSink(post: (Event) -> Unit): (Event) -> Unit = { event ->
        if (!(event is Event.LocationChanged && DebugInjection.injectedLocation != null)) post(event)
    }

    /** 위치 어댑터가 쓰는 이벤트 출구. 실제 위치를 받지 않는 동안([acceptsRealLocation])에는 위치 이벤트를 버린다. */
    fun locationSink(post: (Event) -> Unit): (Event) -> Unit = { event ->
        if (!(event is Event.LocationChanged && !acceptsRealLocation())) post(event)
    }

    /** 실제 위치(어댑터가 읽은 에뮬레이터·차의 위치)를 받는가. `loc`을 주입했거나 가짜 내비가 켜져 있으면 받지 않는다. */
    fun acceptsRealLocation(): Boolean = DebugInjection.injectedLocation == null && !DebugInjection.fakeNavi

    fun wrap(adapters: Adapters, post: (Event) -> Unit): Adapters {
        connect(FakeNaviSession.shared, post)
        return Adapters(
            navi = InjectedNavigator(adapters.navi, post),
            voice = InjectedSpeaker(adapters.voice),
            signals = adapters.signals,
            location = InjectedLocator(adapters.location),
        )
    }

    /** 가짜 내비의 도착·위치를 세션 이벤트로 잇는다. 테스트가 같은 연결을 쓰도록 따로 뒀다. */
    internal fun connect(fake: FakeNaviSession, post: (Event) -> Unit) {
        // 가짜 내비가 도착하면 실제 내비처럼 도착 알림을 세션에 넣는다. post는 메인 스레드로 넘긴다.
        fake.onArrived = { post(Event.DestinationArrived) }
        // 가짜 내비가 달리는 동안 가짜 경로 위 위치를 위치 이벤트로 넣는다(끝점은 목적지 좌표라 P단 300m 판정과 맞물린다).
        // `loc` 신호로 위치를 주입한 동안에는 넣지 않는다(주입한 위치가 덮어써지지 않게).
        fake.onLocation = { if (DebugInjection.injectedLocation == null) post(Event.LocationChanged(it)) }
    }
}

internal class InjectedNavigator(
    private val inner: Navigator,
    private val post: (Event) -> Unit,
    private val fake: FakeNaviSession = FakeNaviSession.shared,
) : Navigator {
    // 세션이 내비 어댑터를 멈추는 Suspend 동안에는 가짜 내비도 멈춘다(도착·위치 이벤트를 넣지 않는다).
    override fun start() {
        fake.setStopped(false)
        inner.start()
    }

    override fun stop() {
        fake.setStopped(true)
        inner.stop()
    }

    override fun requestTravelTime(requestId: Int, place: Place) {
        val seconds = DebugInjection.tripSeconds
        // trip 주입값이 가장 우선. 없고 가짜 내비면 가짜 경로 길이로 계산한 값으로 답한다.
        val travelTime = when {
            seconds != null -> if (seconds == DebugInjection.NO_TRIP) null else Duration.ofSeconds(seconds)
            DebugInjection.fakeNavi -> FakeRoute.to(place).duration
            else -> {
                inner.requestTravelTime(requestId, place)
                return
            }
        }
        post(Event.TravelTimeResult(requestId, travelTime))
    }

    override fun startRoute(place: Place): Boolean {
        if (!DebugInjection.fakeNavi) return DebugInjection.routeOk ?: inner.startRoute(place)
        // 가짜 내비는 실제 내비를 거치지 않는다. route=fail이면 경로를 시작하지 않고 실패로 답한다.
        val ok = DebugInjection.routeOk ?: true
        // 실패면 남아 있던 이전 가짜 경로를 지운다(옛 경로가 계속 달려 도착 알림을 내지 않게).
        if (ok) fake.start(place) else fake.clear()
        return ok
    }

    // 위치는 실제 내비에 묻는다. 다만 E2E가 chagok-debug://signal?loc=위도,경도로 위치를 주입했으면(가짜 내비 여부와 무관하게)
    // 실제 내비에 묻지 않고 그 주입 위치로 답한다. 주입이 없고 가짜 내비 경로가 있으면 그 경로 위 차 위치로 답한다(에뮬레이터의 실제 위치가 섞이지 않게).
    override fun requestLocation() {
        val injected = DebugInjection.injectedLocation
        val trip = fake.trip
        when {
            injected != null -> post(Event.LocationChanged(injected))
            !DebugInjection.fakeNavi -> inner.requestLocation()
            trip != null -> post(Event.LocationChanged(carPosition(trip)))
            else -> inner.requestLocation()
        }
    }

    private fun carPosition(trip: FakeTrip): LatLng =
        if (trip.arrived) trip.route.destination.position else trip.position.position
}

private class InjectedSpeaker(private val inner: Speaker) : Speaker {
    override fun start() = inner.start()
    override fun stop() = inner.stop()
    override fun stopAll() = inner.stopAll()
    override fun speak(text: String, thenListen: Boolean) =
        inner.speak(text, thenListen && DebugInjection.realListening)
}

/** `loc` 주입 중에는 실제 위치를 읽어 오지 않는다(주기·수동 갱신은 [DebugHooks.locationSink]가 막는다). */
private class InjectedLocator(private val inner: Locator) : Locator {
    override fun start() = inner.start()
    override fun stop() = inner.stop()
    override fun setForeground(foreground: Boolean) = inner.setForeground(foreground)
    override fun refreshNow(deliver: (Event) -> Unit) {
        if (DebugHooks.acceptsRealLocation()) inner.refreshNow(deliver)
    }
}
