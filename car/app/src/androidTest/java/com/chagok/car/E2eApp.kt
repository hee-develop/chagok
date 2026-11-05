package com.chagok.car

import androidx.test.platform.app.InstrumentationRegistry
import com.chagok.car.domain.Place
import com.chagok.car.flow.Event
import com.chagok.car.flow.ScheduleFetcher
import com.chagok.car.runtime.Adapters
import com.chagok.car.runtime.DemoClock
import com.chagok.car.runtime.Navigator
import com.chagok.car.runtime.SessionHost
import com.chagok.car.runtime.Speaker
import com.chagok.car.runtime.VehicleSignals
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** 기어·시동 대신 테스트가 이벤트를 직접 넣으므로 시작하면 시동 신호가 없다고만 알린다(앱 진입이 탑승 신호). */
class FakeSignals(private val onIgnitionSupport: (Boolean) -> Unit) : VehicleSignals {
    override fun start() = Unit
    override fun startPermissionGated() = onIgnitionSupport(false)
    override fun stop() = Unit
}

/**
 * 가짜 내비. 소요 시간 조회는 [travelTime]으로 바로 답하고(null이면 "모름"), 길안내 요청은 [routeOk]로 답하며 요청한 장소를 기록한다.
 */
class FakeNavigator(private val post: (Event) -> Unit) : Navigator {
    @Volatile var travelTime: Duration? = null
    @Volatile var routeOk = true
    val routes = java.util.concurrent.CopyOnWriteArrayList<Place>()

    override fun start() = Unit
    override fun stop() = Unit
    override fun requestTravelTime(requestId: Int, place: Place) = post(Event.TravelTimeResult(requestId, travelTime))

    override fun startRoute(place: Place): Boolean {
        routes += place
        return routeOk
    }
}

/**
 * 말한 문장과 말한 뒤 듣기를 열었는지를 기록하고, 멈출 때까지 "말하는 중"으로 둔다.
 * 들은 말은 테스트가 [Event.Heard]로 직접 넣는다.
 */
class FakeSpeaker(private val onSpeaking: (Boolean) -> Unit, private val onDucking: (Boolean) -> Unit) : Speaker {
    val spoken = java.util.concurrent.CopyOnWriteArrayList<String>()
    val listened = java.util.concurrent.CopyOnWriteArrayList<Boolean>()
    @Volatile var stopCount = 0

    override fun start() = Unit
    override fun stop() = Unit
    override fun speak(text: String, thenListen: Boolean) {
        spoken += text
        listened += thenListen
        onSpeaking(true)
        onDucking(true)
    }

    /** 말이 끝났다. 이어서 듣는 발화면 포커스를 쥔 채라 볼륨 낮춤은 유지된다. */
    fun endSpeech() {
        onSpeaking(false)
        if (listened.lastOrNull() != true) onDucking(false)
    }

    /** 듣기가 끝나 포커스를 반납했다. */
    fun endListening() = onDucking(false)

    override fun stopAll() {
        stopCount++
        onSpeaking(false)
        onDucking(false)
    }
}

class E2eApp : ChagokApp() {
    // 모든 권한을 받은 것으로 보고 권한 설명 카드를 건너뛴다
    override val runtimePermissions: List<String> = emptyList()

    override fun createHost(): SessionHost {
        lateinit var speaker: FakeSpeaker
        lateinit var navigator: FakeNavigator
        val host = SessionHost(
            this,
            clock = DemoClock(Clock.fixed(NOW, ZoneId.of("Asia/Seoul"))),
            fetcher = ScheduleFetcher { at -> FixtureResponses.response(fixtureJson(), at, calendarsJson()) },
            adapters = { post, onSpeaking, onDucking, onIgnitionSupport ->
                speaker = FakeSpeaker(onSpeaking, onDucking)
                navigator = FakeNavigator(post)
                Adapters(navigator, speaker, FakeSignals(onIgnitionSupport))
            },
        )
        fakeSpeaker = speaker
        fakeNavigator = navigator
        return host
    }

    companion object {
        /** 프로토타입 장면의 기준 시각: 09:20 KST */
        val NOW: Instant = Instant.parse("2026-11-06T00:20:00Z")

        lateinit var fakeSpeaker: FakeSpeaker
            private set

        lateinit var fakeNavigator: FakeNavigator
            private set

        private fun fixtureJson(): String = asset("schedules/gwangju-day.json")

        private fun calendarsJson(): String = asset("calendars/mock-device.json")

        private fun asset(path: String): String =
            InstrumentationRegistry.getInstrumentation().context.assets.open(path).bufferedReader().use { it.readText() }
    }
}
