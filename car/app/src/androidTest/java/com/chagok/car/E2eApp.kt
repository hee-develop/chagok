package com.chagok.car

import androidx.test.platform.app.InstrumentationRegistry
import com.chagok.car.domain.Place
import com.chagok.car.flow.Event
import com.chagok.car.flow.ScheduleFetcher
import com.chagok.car.runtime.Adapters
import com.chagok.car.runtime.DemoClock
import com.chagok.car.runtime.SessionHost
import com.chagok.car.runtime.Speaker
import com.chagok.car.runtime.TravelTimeProvider
import com.chagok.car.runtime.VehicleSignals
import java.time.Clock
import java.time.Instant
import java.time.ZoneId

/** 기어·시동 대신 테스트가 이벤트를 직접 넣으므로 시작하면 시동 신호가 없다고만 알린다(앱 진입이 탑승 신호). */
class FakeSignals(private val onIgnitionSupport: (Boolean) -> Unit) : VehicleSignals {
    override fun start() = Unit
    override fun startPermissionGated() = onIgnitionSupport(false)
    override fun stop() = Unit
}

/** 소요 시간 조회는 바로 "모름"으로 답한다(내비 없음). */
class FakeTravel(private val post: (Event) -> Unit) : TravelTimeProvider {
    override fun start() = Unit
    override fun stop() = Unit
    override fun requestTravelTime(requestId: Int, place: Place) = post(Event.TravelTimeResult(requestId, null))
}

/** 말한 문장을 기록하고, 멈출 때까지 "말하는 중"으로 둔다. */
class FakeSpeaker(private val onSpeaking: (Boolean) -> Unit) : Speaker {
    val spoken = java.util.concurrent.CopyOnWriteArrayList<String>()
    @Volatile var stopCount = 0

    override fun start() = Unit
    override fun stop() = Unit
    override fun speak(text: String) {
        spoken += text
        onSpeaking(true)
    }

    override fun stopAll() {
        stopCount++
        onSpeaking(false)
    }
}

class E2eApp : ChagokApp() {
    // 모든 권한을 받은 것으로 보고 권한 설명 카드를 건너뛴다
    override val runtimePermissions: List<String> = emptyList()

    override fun createHost(): SessionHost {
        lateinit var speaker: FakeSpeaker
        val host = SessionHost(
            this,
            clock = DemoClock(Clock.fixed(NOW, ZoneId.of("Asia/Seoul"))),
            fetcher = ScheduleFetcher { at -> FixtureResponses.response(fixtureJson(), at) },
            adapters = { post, onSpeaking, onIgnitionSupport ->
                speaker = FakeSpeaker(onSpeaking)
                Adapters(FakeTravel(post), speaker, FakeSignals(onIgnitionSupport))
            },
        )
        fakeSpeaker = speaker
        return host
    }

    companion object {
        /** 프로토타입 장면의 기준 시각: 09:20 KST */
        val NOW: Instant = Instant.parse("2026-11-06T00:20:00Z")

        lateinit var fakeSpeaker: FakeSpeaker
            private set

        private fun fixtureJson(): String =
            InstrumentationRegistry.getInstrumentation().context.assets.open("schedules/gwangju-day.json")
                .bufferedReader().use { it.readText() }
    }
}
