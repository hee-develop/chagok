package com.chagok.car

import com.chagok.car.domain.Place
import com.chagok.car.domain.Rules
import com.chagok.car.flow.Event
import com.chagok.car.runtime.Adapters
import com.chagok.car.runtime.Navigator
import com.chagok.car.runtime.Speaker
import java.time.Duration

/**
 * E2E가 내비 결과와 듣기를 직접 정하게 하는 주입 값. 디버그 빌드에만 있고 릴리스 소스셋에는 [DebugHooks]의 항등 구현만 있다.
 * 값은 [DebugSignals]가 `chagok-debug://signal`의 `trip`·`route`·`listen`으로 바꾼다.
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

    const val NO_TRIP = -1L
}

/** 디버그 빌드의 어댑터 묶음. 내비 결과와 듣기를 [DebugInjection]이 가로챌 수 있게 감싼다. */
object DebugHooks {
    /** 하차 카드를 띄워 두는 시간. [DebugInjection.exitCardSeconds]가 없으면 정책 기준값이다. */
    fun exitCardDuration(): Duration = DebugInjection.exitCardSeconds?.let { Duration.ofSeconds(it) } ?: Rules.EXIT_CARD

    fun wrap(adapters: Adapters, post: (Event) -> Unit): Adapters = Adapters(
        navi = InjectedNavigator(adapters.navi, post),
        voice = InjectedSpeaker(adapters.voice),
        signals = adapters.signals,
    )
}

private class InjectedNavigator(private val inner: Navigator, private val post: (Event) -> Unit) : Navigator {
    override fun start() = inner.start()
    override fun stop() = inner.stop()

    override fun requestTravelTime(requestId: Int, place: Place) {
        val seconds = DebugInjection.tripSeconds
        if (seconds == null) {
            inner.requestTravelTime(requestId, place)
            return
        }
        val travelTime = if (seconds == DebugInjection.NO_TRIP) null else Duration.ofSeconds(seconds)
        post(Event.TravelTimeResult(requestId, travelTime))
    }

    override fun startRoute(place: Place): Boolean = DebugInjection.routeOk ?: inner.startRoute(place)

    // 위치는 실제 내비에 묻는다. E2E는 chagok-debug://signal?loc=위도,경도로 답을 직접 넣는다.
    override fun requestLocation() = inner.requestLocation()
}

private class InjectedSpeaker(private val inner: Speaker) : Speaker {
    override fun start() = inner.start()
    override fun stop() = inner.stop()
    override fun stopAll() = inner.stopAll()
    override fun speak(text: String, thenListen: Boolean) =
        inner.speak(text, thenListen && DebugInjection.realListening)
}
