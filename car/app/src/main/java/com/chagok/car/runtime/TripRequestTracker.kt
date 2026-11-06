package com.chagok.car.runtime

import com.chagok.car.domain.Place
import java.time.Duration

/**
 * 소요 시간 요청의 요청 ID·연결 대기·타임아웃 상태. Handler와 SDK에 의존하지 않아 JVM에서 테스트한다.
 * 연결(onConnected) 전에 온 요청은 버리지 않고 대기시키고, 연결되면 보낸다.
 * 타임아웃은 요청을 받은 시점부터 센다(연결 대기 시간 포함).
 * 연결·실패 상태는 helper 하나의 생명 동안만 유효하며 [reset]으로 지운다.
 */
class TripRequestTracker(val timeout: Duration) {
    enum class Step { SEND_NOW, WAIT_FOR_CONNECTION, FAIL }

    class Pending(val id: Int, val place: Place, var sent: Boolean = false)

    private val lock = Any()
    private var connected = false
    private var failed = false
    private var pending: Pending? = null

    /** 내비에 연결돼 있고 연결이 실패하지 않았는가. 길안내 요청은 이때만 보낸다. */
    val ready: Boolean get() = synchronized(lock) { connected && !failed }

    /** 새 요청을 등록한다. 이전 요청이 남아 있으면 덮어쓴다(세션은 마지막 ID만 기다린다). */
    fun request(id: Int, place: Place): Step = synchronized(lock) {
        when {
            failed -> Step.FAIL
            connected -> {
                pending = Pending(id, place, sent = true)
                Step.SEND_NOW
            }
            else -> {
                pending = Pending(id, place)
                Step.WAIT_FOR_CONNECTION
            }
        }
    }

    /** 연결됐다. 대기 중이던 요청이 있으면 보낼 것으로 돌려준다. */
    fun connected(): Pending? = synchronized(lock) {
        connected = true
        pending?.takeIf { !it.sent }?.also { it.sent = true }
    }

    /** 연결 실패. 대기 중이던 요청의 ID를 돌려준다(null로 알려야 함). 이후 요청은 바로 실패한다. */
    fun connectionFailed(): Int? = synchronized(lock) {
        failed = true
        takePending()
    }

    /** 연결 상태와 대기 중인 요청을 지운다. 내비 helper를 새로 만들 때(start)와 해제할 때(stop) 부른다. */
    fun reset() = synchronized(lock) {
        connected = false
        failed = false
        pending = null
    }

    /** 응답(성공·오류)이 왔다. 기다리던 요청 ID를 돌려준다. */
    fun resolve(): Int? = synchronized(lock) { takePending() }

    /** 타임아웃 타이머가 울렸다. 그 ID가 아직 기다리는 중이면 true. */
    fun expire(id: Int): Boolean = synchronized(lock) {
        if (pending?.id != id) return false
        pending = null
        true
    }

    private fun takePending(): Int? = pending?.id.also { pending = null }
}

/** 내비 SDK가 주는 시간 값을 초로 가정해 [Duration]으로 바꾼다. */
object NaviDuration {
    private const val DAY_SECONDS = 24 * 60 * 60

    /**
     * 단위가 문서에 없다(docs/sdk-check.md). 0 이하이거나 24시간(초 기준) 이상이면 모르는 값으로 본다.
     * eta가 소요 시간이 아니라 도착 '시각'(epoch 등)일 수도 있어, 그런 큰 값을 시간으로 믿지 않으려는 방어다.
     */
    fun of(value: Int): Duration? = if (value in 1 until DAY_SECONDS) Duration.ofSeconds(value.toLong()) else null
}
