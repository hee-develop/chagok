package com.chagok.car.runtime

/**
 * 말하기 한 번(발화)의 생명 주기. TTS 콜백(onDone·onError)에는 발화 ID가 없으므로,
 * 발화마다 토큰을 두고 '현재 발화의 onStart를 본 뒤에 온 끝 콜백'만 현재 발화의 것으로 본다.
 * 이전 발화의 늦은 onDone·onError가 새 발화의 포커스 반납을 일으키지 않게 한다.
 * Handler와 SDK에 의존하지 않아 JVM에서 테스트한다.
 */
class SpeechTurns {
    private val lock = Any()
    private var token = 0
    private var active = false
    private var started = false

    /** 새 발화를 시작한다. 이전 발화는 무효가 된다. 돌려주는 값이 이 발화의 토큰이다. */
    fun begin(): Int = synchronized(lock) {
        token++
        active = true
        started = false
        token
    }

    /** SDK onStart. 현재 발화가 시작됐다. */
    fun onStart() = synchronized(lock) {
        if (active) started = true
    }

    /** SDK onDone·onError. 현재 발화의 끝이면 true, 이전 발화의 늦은 콜백이면 false. */
    fun onEnd(): Boolean = synchronized(lock) {
        if (!active || !started) false else end()
    }

    /** 상한 타이머. [forToken]이 아직 현재 발화이고 안 끝났으면 끝내고 true. */
    fun onCap(forToken: Int): Boolean = synchronized(lock) {
        if (!active || token != forToken) false else end()
    }

    /** 멈춤. 진행 중이던 발화를 무효로 만든다. */
    fun cancel() = synchronized(lock) {
        token++
        active = false
        started = false
    }

    val isActive: Boolean get() = synchronized(lock) { active }

    private fun end(): Boolean {
        active = false
        return true
    }
}

/**
 * TTS 초기화가 끝나기 전에 온 말하기를 한 건만 붙들어 두었다가 준비되면 내보낸다.
 * 가장 최근 말하기만 남긴다. [cancel]과 [reset]은 붙든 말을 버린다.
 */
class DeferredSpeech {
    private val lock = Any()
    private var ready = false
    private var waiting: String? = null

    /** 준비돼 있으면 true를 돌려 바로 말하게 하고, 아니면 붙들어 두고 false. */
    fun offer(text: String): Boolean = synchronized(lock) {
        if (ready) {
            true
        } else {
            waiting = text
            false
        }
    }

    /** 준비가 끝났다. 붙들어 둔 말이 있으면 돌려준다. */
    fun markReady(): String? = synchronized(lock) {
        ready = true
        waiting.also { waiting = null }
    }

    /** 말하기를 멈췄다. 붙든 말을 버린다. */
    fun cancel() = synchronized(lock) { waiting = null }

    /** TTS를 새로 초기화하거나 해제한다. 준비 안 됨으로 돌리고 붙든 말을 버린다. */
    fun reset() = synchronized(lock) {
        ready = false
        waiting = null
    }
}
