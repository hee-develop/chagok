package com.chagok.car

import androidx.test.platform.app.InstrumentationRegistry
import com.chagok.car.domain.Place
import com.chagok.car.flow.Event
import com.chagok.car.flow.PairingClient
import com.chagok.car.flow.PairingCode
import com.chagok.car.flow.PairingStatus
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
import org.json.JSONArray

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

    /** P단 도착 판단의 위치 답. null이면 답하지 않는다(내비가 연결되지 않은 것처럼). */
    @Volatile var location: com.chagok.car.domain.LatLng? = null

    override fun requestLocation() {
        location?.let { post(Event.LocationChanged(it, naviAnswer = true)) }
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

/** 연결 서버 대신. 코드는 늘 123456이고, 테스트가 [paired]를 true로 바꾸면 다음 확인(2초 간격)에서 연결된다. */
class FakePairingClient : PairingClient {
    @Volatile var paired = false

    override fun issue(carId: String) = PairingCode(CODE, "chagok://pair?code=$CODE", Instant.now().plusSeconds(600))

    override fun status(carId: String) = PairingStatus(paired, codeActive = true)

    override fun unpair(carId: String) {
        paired = false
    }

    companion object {
        const val CODE = "123456"
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
            fetcher = ScheduleFetcher { at ->
                if (failFetch) throw java.io.IOException("E2E: 서버에 연결하지 못함")
                FixtureResponses.response(if (emptyDay) EMPTY_DAY else fixtureJson(), at, calendarsJson(), JSONArray(favoritesJson))
            },
            pairingClient = fakePairing,
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

        val fakePairing = FakePairingClient()

        /** 서버 favorites 자리에 넣을 자주 가는 곳(JSON 배열). 다음 일정 받기([SessionHost.resetDemo])부터 쓴다. 기본은 빈 목록 */
        @Volatile var favoritesJson: String = "[]"

        /** true면 일정이 하나도 없는 날로 답한다. 다음 일정 받기부터 쓴다. */
        @Volatile var emptyDay: Boolean = false

        /** true면 일정 받기가 실패한다(서버 연결 실패). 같은 날 받아 둔 사본이 있으면 앱은 그 사본을 쓴다. */
        @Volatile var failFetch: Boolean = false

        private const val EMPTY_DAY = """{"schedules":[]}"""

        private fun fixtureJson(): String = asset("schedules/gwangju-day.json")

        private fun calendarsJson(): String = asset("calendars/mock-device.json")

        private fun asset(path: String): String =
            InstrumentationRegistry.getInstrumentation().context.assets.open(path).bufferedReader().use { it.readText() }
    }
}
