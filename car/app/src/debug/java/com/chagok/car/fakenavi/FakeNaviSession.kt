package com.chagok.car.fakenavi

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.chagok.car.DebugInjection
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import java.time.Duration
import java.time.Instant

/** 틱 예약. 기본은 메인 Handler([HandlerTickScheduler])이고 JVM 테스트는 가짜를 넣는다. */
interface TickScheduler {
    fun postDelayed(task: Runnable, delayMs: Long)
    fun cancel(task: Runnable)
}

class HandlerTickScheduler : TickScheduler {
    private val handler = Handler(Looper.getMainLooper())
    override fun postDelayed(task: Runnable, delayMs: Long) {
        handler.postDelayed(task, delayMs)
    }

    override fun cancel(task: Runnable) = handler.removeCallbacks(task)
}

/**
 * 가짜 길안내의 현재 상태. 경로 하나와 차를 앞으로 보내는 시계를 맡는다. 모든 메서드는 메인 스레드에서 부른다.
 * 앱에서는 프로세스 범위의 [shared] 하나를 쓴다. 켜짐 여부는 [DebugInjection.fakeNavi]가 갖는다.
 *
 * 차는 주행 중이고 화면이 떠 있을 때만 간다. 정차([setDriving] false)나 Activity onPause([onPause])에서는 시계를 멈추고
 * (백그라운드 애니메이션 정리), 다시 조건이 갖춰지면 멈춘 자리에서 이어 간다. 틱이 필요 없는 상태에서는 예약된 틱이 없다.
 *
 * 세션이 내비 어댑터를 멈춘 동안(Suspend, [setStopped])에는 실제 내비처럼 가짜 내비도 멈춘다: 시계가 서고 위치·도착 이벤트를 세션에 넣지 않으며,
 * 다시 켜지면 멈춘 자리에서 이어 가고 그사이 닿았을 도착은 그때 한 번 알린다.
 */
class FakeNaviSession(
    private val scheduler: TickScheduler,
    private val elapsedMillis: () -> Long,
    private val arrivalSink: (FakeTrip) -> Unit = ::logArrival,
) {
    var trip: FakeTrip? = null
        private set

    val enabled: Boolean get() = DebugInjection.fakeNavi

    /** 경로나 차 위치가 바뀔 때마다 불린다. 지도 층이 쥔다. */
    var onChanged: (() -> Unit)? = null

    /** 도착을 알릴 때 불린다([arrivalSink] 뒤). [DebugHooks]가 세션에 [com.chagok.car.flow.Event.DestinationArrived]를 넣는다. */
    var onArrived: ((FakeTrip) -> Unit)? = null

    /**
     * 차의 위치(가짜 경로 위 위경도)를 알릴 때 불린다. 달리는 동안 [LOCATION_INTERVAL_MS]마다, 경로를 시작할 때와 도착할 때(끝점 = 목적지 좌표)에도 한 번씩.
     * [DebugHooks]가 세션에 [com.chagok.car.flow.Event.LocationChanged]를 넣는다. 가짜 내비를 켰을 때만 경로가 있으므로 실제 내비 모드에서는 불리지 않는다.
     */
    var onLocation: ((LatLng) -> Unit)? = null

    /** 켜짐 여부가 바뀔 때 불린다. 디버그 줄의 버튼이 쥔다. */
    var onModeChanged: ((Boolean) -> Unit)? = null

    private var driving = false
    private var paused = false

    /** 세션이 내비 어댑터를 멈춘 동안(Suspend)인가. true면 틱도, 위치·도착 알림도 없다. */
    private var stopped = false
    private var ticking = false
    private var lastTickAt = 0L
    private var lastLocationAt = Long.MIN_VALUE

    fun setEnabled(on: Boolean) {
        if (on != enabled) {
            DebugInjection.fakeNavi = on
            trip = null
            reschedule()
            onModeChanged?.invoke(on)
        }
        onChanged?.invoke()
    }

    /**
     * 새 가짜 경로를 시작한다. 이전 경로는 대체된다. [departedAt]은 데모 시계의 지금으로, 패널의 도착 예정 시각(출발 시각 + 소요 시간)이 된다.
     * 실제 경과 시간([elapsedMillis])이 아니라 데모 시계를 쓰므로 [시간 +10분]·`now`·`advance`와 같은 시간축이다.
     */
    fun start(place: Place, departedAt: Instant, via: Place? = null) {
        // trip 주입값(양수)이 있으면 패널의 남은 시간·도착 예정을 그 값으로 맞춘다. 애니메이션 길이는 driveMillis다.
        val travelTime = DebugInjection.tripSeconds?.takeIf { it > 0 }?.let(Duration::ofSeconds)
        val next = FakeTrip(FakeRoute.to(place), DebugInjection.driveMillis, departedAt, travelTime, via)
        trip = next
        // 멈춘 동안에는 알리지 않는다. 길이 0인 경로의 도착은 다시 켜질 때 알린다([setStopped]).
        if (!stopped) {
            emitLocation(next, force = true)
            judgeArrival(next)
        }
        reschedule()
        onChanged?.invoke()
    }

    /** 가짜 경로를 지운다(데모 초기화). */
    fun clear() {
        if (trip == null) return
        trip = null
        reschedule()
        onChanged?.invoke()
    }

    /** 진행률(0~1)로 바로 옮긴다. 정차 중에도 동작한다. 경로가 없거나 내비가 멈춘 동안([setStopped])이면 무시한다. */
    fun setProgress(ratio: Double) {
        val current = trip ?: return
        if (stopped) return
        val reached = current.seek(ratio)
        emitLocation(current, force = true)
        judgeArrival(current, reached)
        reschedule()
        onChanged?.invoke()
    }

    fun setDriving(value: Boolean) {
        if (driving == value) return
        driving = value
        reschedule()
    }

    /**
     * 세션이 내비 어댑터를 멈추거나([InjectedNavigator.stop], Suspend) 다시 켤 때([InjectedNavigator.start]) 부른다.
     * 멈추면 예약된 틱을 걷고, 다시 켜면 멈춘 자리에서 이어 가며 멈춘 사이 닿았을 도착을 한 번 알린다.
     */
    fun setStopped(value: Boolean) {
        if (stopped == value) return
        stopped = value
        reschedule()
        if (!value) trip?.let { judgeArrival(it) }
    }

    fun onPause() {
        paused = true
        reschedule()
    }

    fun onResume() {
        paused = false
        reschedule()
    }

    private val tick = Runnable {
        val now = elapsedMillis()
        val current = trip
        if (current != null && !stopped) {
            val delta = now - lastTickAt
            lastTickAt = now
            val reached = current.advance(delta, driving)
            emitLocation(current, force = reached)
            judgeArrival(current, reached)
            onChanged?.invoke()
        }
        reschedule()
    }

    /** 차의 지금 위치를 알린다. [force]가 아니면 마지막으로 알린 뒤 [LOCATION_INTERVAL_MS]가 지났을 때만. 도착 알림보다 먼저 불러 세션이 위치를 먼저 안다. */
    private fun emitLocation(current: FakeTrip, force: Boolean) {
        if (stopped) return
        val sink = onLocation ?: return
        val now = elapsedMillis()
        if (!force && lastLocationAt != Long.MIN_VALUE && now - lastLocationAt < LOCATION_INTERVAL_MS) return
        lastLocationAt = now
        sink(if (current.arrived) current.route.destination.position else current.position.position)
    }

    private fun reschedule() {
        scheduler.cancel(tick)
        val current = trip
        val shouldTick = current != null && !paused && !stopped && driving && !current.arrived
        if (shouldTick && !ticking) lastTickAt = elapsedMillis()
        ticking = shouldTick
        if (shouldTick) scheduler.postDelayed(tick, TICK_MS)
    }

    /**
     * 도착을 알리는 유일한 곳. [reached]는 [FakeTrip.advance]·[FakeTrip.seek]·[FakeTrip.consumeArrival]이 돌려준 값으로,
     * 도착 뒤 한 번만 true라서 경로마다 알림이 정확히 한 번 간다(길이 0인 경로, 진행률로 건너뛴 도착도 포함).
     * 로그([arrivalSink])를 남기고 [onArrived]로 세션에 도착을 알린다. 일정 상태 변경은 세션이 한다.
     */
    private fun judgeArrival(current: FakeTrip, reached: Boolean = current.consumeArrival()) {
        if (!reached) return
        arrivalSink(current)
        onArrived?.invoke(current)
    }

    companion object {
        const val TICK_MS = 33L

        /** 가짜 경로 위 위치를 알리는 간격(실제 시간). 시연이 짧아 실제 갱신 주기보다 촘촘하다. */
        const val LOCATION_INTERVAL_MS = 1_000L

        val shared: FakeNaviSession by lazy { FakeNaviSession(HandlerTickScheduler(), SystemClock::elapsedRealtime) }

        private fun logArrival(arrived: FakeTrip) {
            Log.i("ChagokFakeNavi", "도착: ${arrived.route.destination.name}")
        }
    }
}
