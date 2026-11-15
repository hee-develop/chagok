package com.chagok.car.runtime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.chagok.car.BuildConfig
import com.chagok.car.DebugHooks
import com.chagok.car.FlowLog
import com.chagok.car.domain.Gear
import com.chagok.car.flow.DriveSession
import com.chagok.car.flow.Effect
import com.chagok.car.flow.Event
import com.chagok.car.flow.HttpPairingClient
import com.chagok.car.flow.HttpScheduleFetcher
import com.chagok.car.flow.PairingClient
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
    /** 카드를 접은 뒤에도 남기는 결과 한 줄. 정차 중에만 화면에 보인다. */
    val result: String = "",
    /** 차곡이 말하는 동안 true */
    val speaking: Boolean = false,
    /** 오디오 포커스를 쥐고 볼륨을 낮추는 동안(말하기와 듣기) true */
    val ducking: Boolean = false,
    /** 카드가 접힐 때 애니메이션 없이 바로 접는다(주행 제한 등). card가 null일 때만 뜻이 있다. */
    val collapseInstantly: Boolean = false,
    /** 주행 중(기어 D·R 또는 주행 제한)이면 true. 화면은 이때 아무것도 말하거나 띄우지 않는다. */
    val driving: Boolean = false,
    /** 주행 중에 보이는 다음 일정 칩의 본문("13:00 육전집 점심"). 비어 있으면 숨긴다. 표시 전용이라 누를 수 없다. */
    val nextChip: String = "",
    /** 지금 위치를 쓸 일이 있는가(집 좌표가 있거나 오늘 남은 일정 중 장소가 있음). 없으면 위치 권한 설명 카드도 띄우지 않는다. */
    val locationNeeded: Boolean = false,
)

/** 세션이 쓰는 SDK 어댑터 묶음. */
class Adapters(
    val navi: Navigator,
    val voice: Speaker,
    val signals: VehicleSignals,
    /** 차 위치. 위치를 쓰지 않는 구성(계측 테스트)은 [Locator.None]. */
    val location: Locator = Locator.None,
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
    pairingClient: PairingClient = HttpPairingClient(BuildConfig.SERVER_URL),
    adapters: (
        post: (Event) -> Unit,
        onSpeaking: (Boolean) -> Unit,
        onDucking: (Boolean) -> Unit,
        onIgnitionSupport: (Boolean) -> Unit,
    ) -> Adapters =
        { post, onSpeaking, onDucking, onIgnitionSupport ->
            DebugHooks.wrap(
                Adapters(
                    navi = NaviAdapter(context, DebugHooks.naviSink(post)),
                    voice = VoiceAdapter(context, post, onSpeaking, onDucking),
                    signals = CarSignals(context, post, onIgnitionSupport),
                    location = LocationAdapter(context, DebugHooks.locationSink(post)),
                ),
                post,
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
        // 휴대폰과 연결 전에는 일정·집을 서버에서 받지 않는다(연결이 풀린 뒤 집 좌표가 되살아나지 않게).
        allowed = { store.paired },
    )
    // 앱 화면은 아직 앞에 오지 않았다(Application 범위로 먼저 만들어진다). 앞에 오면 [onActivityResumed]가 알린다.
    private val session = DriveSession(clock, source, store.load(), paired = store.paired, exitCardTimeout = DebugHooks::exitCardDuration, foreground = false)
    // 서버가 연결 해제를 확인하면(앱이 앞으로 올 때 [PairingController.verify]) 받아 둔 일정·집 좌표와 저장된 사본을 지운다.
    private val pairing = PairingController(pairingClient, store, ::post, onReleased = { source.clear() })
    private val refresher = ScheduleRefresher(source, ::post, ::dispatch)

    /** 이번 이벤트를 처리하는 중 세션이 일정 다시 받기를 요청했는가. 처리가 끝난 뒤 한 번만 받는다. */
    private var refreshRequested = false

    private val parts = adapters(::post, ::onSpeaking, ::onDucking, ::onIgnitionSupport)
    private val navi = parts.navi
    private val voice = parts.voice
    private val carSignals = parts.signals
    private val location = parts.location
    private val sources = SourceStarter(carSignals, location)

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

    /** Suspend 중인가(어댑터를 멈춘 동안). 연결 확인도 멈춘다. */
    private var suspended = false

    /** 연결 확인을 마지막으로 켰나 껐나. 연결 카드가 보일 수 있을 때(앱이 앞, 정차, Suspend 아님)만 켠다. */
    private var pairingActive = false

    // 시스템 종료 알림. Suspend로 가는 신호 중 서드파티 앱이 받을 수 있는 것(시동 OFF·LOCK과 함께 쓴다).
    private val shutdownReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = post(Event.SuspendRequested)
    }

    // 기기 시각·시간대가 바뀌면 칩 재판단 시각이 낡는다.
    private val clockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = post(Event.ClockChanged)
    }

    fun start() {
        navi.start()
        voice.start()
        // 기어·시동은 런타임 권한과 무관하다. 위치 권한을 묻는 중이거나 거부해도 늘 읽는다(위치만 [startPermissionGatedSources]가 권한 결정 뒤에 켠다).
        sources.startAtLaunch()
        registerShutdownReceiver()
        registerClockReceiver()
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

    private fun registerClockReceiver() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(clockReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(clockReceiver, filter)
        }
    }

    /**
     * 위치 권한 결정 뒤(또는 이미 받았을 때) 위치를 시작한다([PermissionGate.AFTER_PERMISSION]).
     * 어댑터가 권한을 다시 확인해 없으면(거부·대략 위치만 허용) 아무것도 하지 않아 위치 판정만 빠진다.
     */
    fun startPermissionGatedSources() {
        sources.startAfterPermission()
    }

    fun onActivityResumed() {
        main.post {
            resumed = true
            location.setForeground(true)
            updatePairing()
            // 다시 묻기는 앱이 앞에 있을 때만 한다. 뒤에서 미뤄 둔 다시 묻기는 이 이벤트에서 이어 간다.
            post(Event.ForegroundChanged(true))
            // 연결이 서버에서 풀렸는지 확인한다(운전자 교체·폰에서 해제). 서버에 닿지 못하면 해제로 보지 않는다.
            pairing.verify()
            // Suspend 중이었다면 어댑터를 다시 켠다. 포커스·재생은 되찾지 않는다.
            post(Event.Resumed)
            if (ignitionSupported == false) post(Event.AppEntered)
            // 받기 시작은 위 이벤트를 큐에 넣은 뒤에 한다. 받기가 바로 끝나도 완료가 그 이벤트들 뒤에 오므로 그 이벤트는 받는 동안 보류된다.
            if (source.snapshot().origin != ScheduleOrigin.FRESH && !source.refreshing) refreshSchedules()
        }
    }

    fun onActivityPaused() {
        main.post {
            resumed = false
            location.setForeground(false)
            updatePairing()
            post(Event.ForegroundChanged(false))
        }
    }

    private fun onIgnitionSupport(supported: Boolean) {
        main.post {
            ignitionSupported = supported
            if (!supported && resumed) post(Event.AppEntered)
        }
    }

    /** 이벤트를 메인 스레드에서 세션에 넣는다. SDK 콜백(바인더 스레드 등)은 모두 이 경로로 들어온다. */
    fun post(event: Event) {
        main.post {
            // P단에 넣는 순간 시스템이 아는 최근 위치를 먼저 세션에 넣는다(차곡이 뒤에 있어 주기 갱신을 못 받았어도 판정할 수 있게).
            // 이 위치가 낡았거나 이번 주행 전 것이면 세션이 쓰지 않고 내비에 현재 위치를 묻는다.
            // 탑승 판단 신호(앱 진입·시동 ON·앞으로 옴)와 보류한 탑승 판단을 잇는 신호(일정 받기 끝·폰 연결)에도 같은 읽기를 해
            // '이미 그곳'(일정 장소 300m 안)·'지금 집이면 집 빼기' 판정에 지금 위치가 쓰이게 한다(5장). 낡았거나 이번 주행 전 것이면 세션이 쓰지 않는다.
            // 위치 답을 기다리느라 브리핑을 늦추지는 않는다(읽기는 그 자리에서 끝난다).
            if (event is Event.GearChanged && event.gear == Gear.PARK || event.isBoardingSignal()) location.refreshNow(::dispatch)
            dispatch(event)
        }
    }

    private fun Event.isBoardingSignal() =
        this is Event.AppEntered || this is Event.Boarded || (this is Event.IgnitionChanged && ignition == com.chagok.car.domain.Ignition.ON) ||
            (this is Event.ForegroundChanged && foreground) || this is Event.ScheduleLoaded || (this is Event.Paired && brief)

    /** 데모 초기화. [at]을 주면 데모 시계를 그 시각으로 맞추고 일정 기준 시각도 그 시각으로 한다. */
    fun resetDemo(at: Instant? = null) {
        main.post {
            if (at != null) clock.offset = Duration.between(Instant.now(), at)
            store.setAnchor(clock.instant())
            refreshSchedules()
            dispatch(Event.Reset)
        }
    }

    /** 디버그·데모용: 휴대폰 연결 상태를 바꾼다. 같은 스레드에서 이어 넣는 이벤트보다 먼저 세션에 들어간다. */
    fun setPaired(paired: Boolean) {
        val wasPaired = store.paired
        pairing.setPaired(paired)
        // 연결이 풀리면 받아 둔 일정·집 좌표와 저장된 사본을 지운다. 연결 상태를 먼저 바꿔 그 순간부터 일정 받기가 막히게 하고(받는 중이던 응답도 버려진다),
        // 세션의 Unpaired 이벤트는 메인 큐에서 이 뒤에 처리되므로 다음 이벤트부터 집이 없다.
        if (!paired && wasPaired) source.clear()
    }

    fun advanceClock(by: Duration) {
        clock.offset += by
        post(Event.ClockChanged)
    }

    /** 메인 스레드에서 부른다. 순서는 [ScheduleRefresher]가 정한다. */
    private fun refreshSchedules() = refresher.refresh()

    private fun dispatch(event: Event) {
        val effects = session.handle(event)
        FlowLog.record(event, effects)
        effects.forEach(::execute)
        if (refreshRequested) {
            refreshRequested = false
            refreshSchedules()
        }
        if (ui.driving != session.isDriving) publish(ui.copy(driving = session.isDriving))
        // 위치를 쓸 일이 생기거나 없어지면 위치 갱신을 켜고 끄고, 권한 설명 카드를 띄울지도 화면이 다시 판단한다.
        if (ui.locationNeeded != session.needsLocation) {
            location.setNeeded(session.needsLocation)
            publish(ui.copy(locationNeeded = session.needsLocation))
        }
        updatePairing()
    }

    private fun updatePairing() {
        val active = resumed && !suspended && !session.isDriving
        if (active == pairingActive) return
        pairingActive = active
        pairing.setActive(active)
    }

    private fun execute(effect: Effect) {
        when (effect) {
            is Effect.ShowCard -> publish(ui.copy(card = effect.card, result = ""))
            is Effect.CollapseCard -> publish(ui.copy(card = null, collapseInstantly = effect.instant))
            is Effect.ShowResult -> publish(ui.copy(result = effect.text))
            is Effect.ShowNextChip -> publish(ui.copy(nextChip = effect.text))
            is Effect.Speak -> voice.speak(effect.text, effect.thenListen)
            Effect.StopVoice -> voice.stopAll()
            // 이 앞에 StopVoice(재생 중단·포커스 반납)와 Save(상태 저장)가 이미 실행됐다.
            // 시동 신호를 받는 carSignals는 그대로 둔다.
            Effect.EnterSuspend -> {
                navi.stop()
                voice.stop()
                location.stop()
                suspended = true
            }
            Effect.ExitSuspend -> {
                navi.start()
                voice.start()
                // 권한을 다시 확인하고 켠다(Suspend 중에 권한이 바뀌었을 수 있다). 권한이 없으면 아무것도 하지 않는다.
                location.start()
                suspended = false
            }
            is Effect.RequestTravelTime -> navi.requestTravelTime(effect.requestId, effect.place)
            is Effect.StartRoute -> post(Event.RouteRequestResult(navi.startRoute(effect.place)))
            Effect.RequestLocation -> navi.requestLocation()
            is Effect.Save -> store.save(effect.snapshot)
            Effect.RefreshSchedules -> refreshRequested = true
            is Effect.ScheduleResultTimeout ->
                main.postDelayed({ post(Event.ResultTimedOut(effect.timerId)) }, effect.delay.toMillis())
            is Effect.ScheduleChipRecheck -> {
                // 새로 예약하면 이전 것은 낡았으므로 지운다(쌓이지 않게).
                main.removeCallbacksAndMessages(CHIP_TOKEN)
                main.postAtTime({ post(Event.ChipRecheck(effect.timerId)) }, CHIP_TOKEN, SystemClock.uptimeMillis() + effect.delay.toMillis())
            }
            is Effect.ScheduleLocationTimeout ->
                main.postDelayed({ post(Event.LocationTimedOut(effect.timerId)) }, effect.delay.toMillis())
            is Effect.ScheduleCardTimeout ->
                main.postDelayed({ post(Event.CardTimedOut(effect.timerId)) }, effect.delay.toMillis())
        }
    }

    /** TTS 콜백·오디오 포커스 콜백은 어느 스레드에서든 올 수 있어 메인으로 넘겨 화면 상태에 반영한다. */
    private fun onSpeaking(speaking: Boolean) {
        main.post { if (ui.speaking != speaking) publish(ui.copy(speaking = speaking)) }
    }

    private fun onDucking(ducking: Boolean) {
        main.post { if (ui.ducking != ducking) publish(ui.copy(ducking = ducking)) }
    }

    private fun publish(state: UiState) {
        ui = state
        listener?.invoke(state)
    }

    private companion object {
        /** 칩 재판단 타이머를 한꺼번에 지우는 토큰. */
        val CHIP_TOKEN = Any()
    }
}
