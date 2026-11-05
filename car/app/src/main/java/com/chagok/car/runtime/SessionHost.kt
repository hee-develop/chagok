package com.chagok.car.runtime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.chagok.car.BuildConfig
import com.chagok.car.flow.DriveSession
import com.chagok.car.flow.Effect
import com.chagok.car.flow.Event
import com.chagok.car.flow.HttpScheduleFetcher
import com.chagok.car.flow.ScheduleFetcher
import com.chagok.car.flow.ScheduleOrigin
import com.chagok.car.flow.ScheduleRefresher
import com.chagok.car.flow.ServerScheduleSource
import com.chagok.car.ui.CardContent
import java.time.Duration
import java.time.Instant

/** 화면이 그릴 현재 상태. */
data class UiState(
    val card: CardContent? = null,
    /** 차곡이 말하는 동안 true */
    val speaking: Boolean = false,
    /** 카드가 접힐 때 애니메이션 없이 바로 접는다(주행 제한 등). card가 null일 때만 뜻이 있다. */
    val collapseInstantly: Boolean = false,
    /** 주행 중(기어 D·R 또는 주행 제한)이면 true. 화면은 이때 아무것도 말하거나 띄우지 않는다. */
    val driving: Boolean = false,
)

/** 세션이 쓰는 SDK 어댑터 묶음. */
class Adapters(
    val travel: TravelTimeProvider,
    val voice: Speaker,
    val signals: VehicleSignals,
)

/**
 * [DriveSession]에 이벤트를 넣고 Effect를 실행하는 얇은 어댑터. Application 범위에 두며
 * 앱이 뒤에 있어도 기어 변화와 P단 시각을 기록한다.
 * Suspend(시동 OFF·LOCK, 시스템 종료 알림)에서는 세션이 낸 Effect 순서대로 재생 중단 → 포커스 반납 →
 * 상태 저장 → 어댑터 해제를 하고, 다시 켜질 때 어댑터만 되살린다.
 *
 * 오늘 일정은 서버에서 받는다. 받기가 시작되고 끝날 때(첫 시작, 앱 재진입 때 마지막 받기가 최신이 아닐 때, 데모 시각을 바꿨을 때)
 * 세션에 ScheduleLoading·ScheduleLoaded를 넣는다. 모든 이벤트는 같은 경로([post])로 순서대로 세션에 들어가고,
 * 받는 동안 탑승 판단을 보류하는 일은 세션이 한다. 받기는 연결·읽기 각 2초, 이름 해석을 포함한 전체 3초 안에 끝난다.
 * 일정 출처가 최신이 아닌데 탑승을 판단해야 하면 세션이 [Effect.RefreshSchedules]를 내고 여기서 다시 받는다.
 */
class SessionHost(
    private val context: Context,
    val clock: DemoClock = DemoClock(),
    fetcher: ScheduleFetcher = HttpScheduleFetcher(BuildConfig.SERVER_URL),
    adapters: (post: (Event) -> Unit, onSpeaking: (Boolean) -> Unit, onIgnitionSupport: (Boolean) -> Unit) -> Adapters =
        { post, onSpeaking, onIgnitionSupport ->
            Adapters(
                travel = NaviAdapter(context, post),
                voice = VoiceAdapter(context, onSpeaking),
                signals = CarSignals(context, post, onIgnitionSupport),
            )
        },
) {
    private val store = ChagokStore(context)
    private val main = Handler(Looper.getMainLooper())
    private val source = ServerScheduleSource(
        fetcher,
        anchor = { store.anchor(clock) },
        copies = store,
        zone = { clock.zone },
        logger = AndroidLogger,
    )
    private val session = DriveSession(clock, source, store.load())
    private val refresher = ScheduleRefresher(source, ::post, ::dispatch)

    /** 이번 이벤트를 처리하는 중 세션이 일정 다시 받기를 요청했는가. 처리가 끝난 뒤 한 번만 받는다. */
    private var refreshRequested = false

    private val parts = adapters(::post, ::onSpeaking, ::onIgnitionSupport)
    private val navi = parts.travel
    private val voice = parts.voice
    private val carSignals = parts.signals

    var ui = UiState()
        private set
    var listener: ((UiState) -> Unit)? = null
        set(value) {
            field = value
            value?.invoke(ui)
        }

    // 시동 신호가 없을 때만 앱 진입(onResume)을 탑승으로 쓴다. 지원 여부는 Car 연결 뒤에 안다.
    private var ignitionSupported: Boolean? = null
    private var resumed = false

    // 시스템 종료 알림. Suspend로 가는 신호 중 서드파티 앱이 받을 수 있는 것(시동 OFF·LOCK과 함께 쓴다).
    private val shutdownReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = post(Event.SuspendRequested)
    }

    fun start() {
        navi.start()
        voice.start()
        carSignals.start()
        registerShutdownReceiver()
        refreshSchedules()
    }

    private fun registerShutdownReceiver() {
        val filter = IntentFilter(Intent.ACTION_SHUTDOWN)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(shutdownReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(shutdownReceiver, filter)
        }
    }

    /** 런타임 권한을 받은 뒤(또는 이미 받았을 때) 권한이 필요한 신호를 시작한다. */
    fun startPermissionGatedSources() {
        carSignals.startPermissionGated()
    }

    fun onActivityResumed() {
        main.post {
            resumed = true
            // Suspend 중이었다면 어댑터를 다시 켠다. 포커스·재생은 되찾지 않는다.
            post(Event.Resumed)
            if (ignitionSupported == false) post(Event.AppEntered)
            // 받기 시작은 위 이벤트를 큐에 넣은 뒤에 한다. 받기가 바로 끝나도 완료가 그 이벤트들 뒤에 오므로 그 이벤트는 받는 동안 보류된다.
            if (source.snapshot().origin != ScheduleOrigin.FRESH && !source.refreshing) refreshSchedules()
        }
    }

    fun onActivityPaused() {
        main.post { resumed = false }
    }

    private fun onIgnitionSupport(supported: Boolean) {
        main.post {
            ignitionSupported = supported
            if (!supported && resumed) post(Event.AppEntered)
        }
    }

    /** 이벤트를 메인 스레드에서 세션에 넣는다. SDK 콜백(바인더 스레드 등)은 모두 이 경로로 들어온다. */
    fun post(event: Event) {
        main.post { dispatch(event) }
    }

    /** 데모 초기화. [at]을 주면 데모 시계를 그 시각으로 맞추고 일정 기준 시각도 그 시각으로 한다. */
    fun resetDemo(at: Instant? = null) {
        main.post {
            if (at != null) clock.offset = Duration.between(Instant.now(), at)
            store.setAnchor(clock.instant())
            refreshSchedules()
            dispatch(Event.Reset)
        }
    }

    fun advanceClock(by: Duration) {
        clock.offset += by
    }

    /** 메인 스레드에서 부른다. 순서는 [ScheduleRefresher]가 정한다. */
    private fun refreshSchedules() = refresher.refresh()

    private fun dispatch(event: Event) {
        session.handle(event).forEach(::execute)
        if (refreshRequested) {
            refreshRequested = false
            refreshSchedules()
        }
        if (ui.driving != session.isDriving) publish(ui.copy(driving = session.isDriving))
    }

    private fun execute(effect: Effect) {
        when (effect) {
            is Effect.ShowCard -> publish(ui.copy(card = effect.card))
            is Effect.CollapseCard -> publish(ui.copy(card = null, collapseInstantly = effect.instant))
            is Effect.Speak -> voice.speak(effect.text)
            Effect.StopVoice -> voice.stopAll()
            // 이 앞에 StopVoice(재생 중단·포커스 반납)와 Save(상태 저장)가 이미 실행됐다.
            // 시동 신호를 받는 carSignals는 그대로 둔다.
            Effect.EnterSuspend -> {
                navi.stop()
                voice.stop()
            }
            Effect.ExitSuspend -> {
                navi.start()
                voice.start()
            }
            is Effect.RequestTravelTime -> navi.requestTravelTime(effect.requestId, effect.place)
            is Effect.Save -> store.save(effect.snapshot)
            Effect.RefreshSchedules -> refreshRequested = true
            is Effect.ScheduleCardTimeout ->
                main.postDelayed({ post(Event.CardTimedOut(effect.timerId)) }, effect.delay.toMillis())
        }
    }

    /** TTS 콜백·오디오 포커스 콜백은 어느 스레드에서든 올 수 있어 메인으로 넘겨 화면 상태에 반영한다. */
    private fun onSpeaking(speaking: Boolean) {
        main.post { if (ui.speaking != speaking) publish(ui.copy(speaking = speaking)) }
    }

    private fun publish(state: UiState) {
        ui = state
        listener?.invoke(state)
    }
}
