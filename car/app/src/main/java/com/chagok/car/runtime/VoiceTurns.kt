package com.chagok.car.runtime

/**
 * 말하기 한 번(발화)의 생명 주기. TTS 콜백(onDone·onError)에는 발화 ID가 없으므로,
 * 발화마다 토큰을 두고 '현재 발화의 onStart를 본 뒤에 온 끝 콜백'만 현재 발화의 것으로 본다.
 * 이전 발화의 늦은 onDone·onError가 새 발화의 포커스 반납을 일으키지 않게 한다.
 * Handler와 SDK에 의존하지 않아 JVM에서 테스트한다.
 */
class SpeechTurns {
    /** 끝난 발화. [listenAfter]이면 이어서 듣는다. */
    class Finished(val listenAfter: Boolean)

    private val lock = Any()
    private var token = 0
    private var active = false
    private var started = false
    private var listenAfter = false

    /** 새 발화를 시작한다. 이전 발화는 무효가 된다. 돌려주는 값이 이 발화의 토큰이다. */
    fun begin(thenListen: Boolean): Int = synchronized(lock) {
        token++
        active = true
        started = false
        listenAfter = thenListen
        token
    }

    /** SDK onStart. 현재 발화가 시작됐다. */
    fun onStart() = synchronized(lock) {
        if (active) started = true
    }

    /** SDK onDone·onError. 현재 발화의 끝이면 결과를, 이전 발화의 늦은 콜백이면 null. */
    fun onEnd(): Finished? = synchronized(lock) {
        if (!active || !started) null else end()
    }

    /** 상한 타이머. [forToken]이 아직 현재 발화이고 안 끝났으면 끝낸다. */
    fun onCap(forToken: Int): Finished? = synchronized(lock) {
        if (!active || token != forToken) null else end()
    }

    /** 멈춤. 진행 중이던 발화를 무효로 만든다. */
    fun cancel() = synchronized(lock) {
        token++
        active = false
        started = false
        listenAfter = false
    }

    val isActive: Boolean get() = synchronized(lock) { active }

    private fun end(): Finished {
        active = false
        return Finished(listenAfter).also { listenAfter = false }
    }
}

/**
 * 듣기 한 번의 생명 주기. 상한 타이머([cap])는 듣기마다 토큰을 보고 이전 듣기의 타이머가 새 듣기를 닫지 않게 한다.
 * STT 콜백([finish])에는 듣기 ID가 없어 토큰을 보지 않는다. 멈춘([cancel]) 듣기와 이미 끝난 듣기의 콜백만 무시하고,
 * 새 듣기가 열려 있는 동안 온 콜백은 그 듣기의 것으로 본다.
 */
class ListenTurns {
    private val lock = Any()
    private var token = 0
    private var active = false
    private var partial = ""

    fun begin(): Int = synchronized(lock) {
        token++
        active = true
        partial = ""
        token
    }

    fun onPartial(text: String) = synchronized(lock) {
        if (active) partial = text
    }

    /**
     * 결과를 알린다. [text]가 null이면 지금까지 들은 부분 결과를 쓴다.
     * 멈췄거나 이미 끝난 듣기면 null.
     */
    fun finish(text: String?): String? = synchronized(lock) {
        if (!active) return null
        active = false
        text ?: partial
    }

    /** 상한 타이머. 그 듣기가 아직 현재 듣기일 때만 끝낸다. */
    fun cap(forToken: Int): String? = synchronized(lock) {
        if (!active || token != forToken) return null
        active = false
        partial
    }

    fun cancel() = synchronized(lock) {
        token++
        active = false
    }

    val isActive: Boolean get() = synchronized(lock) { active }
}

/**
 * 멈춤 세대. [stopAll]처럼 말하기·듣기를 멈출 때마다 [stopped]로 세대를 올리고, 나중에 실행할 일([listen])은
 * 예약할 때 받은 [ticket]이 실행 시점에도 [valid]일 때만 한다. 예약한 뒤 멈춤이 있었다면 듣기를 열지 않는다.
 */
class StopGate {
    private val generation = java.util.concurrent.atomic.AtomicInteger()

    fun stopped() {
        generation.incrementAndGet()
    }

    fun ticket(): Int = generation.get()

    fun valid(ticket: Int): Boolean = generation.get() == ticket
}

/** 말할 문장과 말이 끝난 뒤 들을지 여부. */
data class Utterance(val text: String, val thenListen: Boolean)

/**
 * TTS 초기화가 끝나기 전에 온 말하기를 한 건만 붙들어 두었다가 준비되면 내보낸다.
 * 가장 최근 말하기만 남긴다. [cancel]과 [reset]은 붙든 말을 버린다.
 */
class DeferredSpeech {
    private val lock = Any()
    private var ready = false
    private var waiting: Utterance? = null

    /** 준비돼 있으면 true를 돌려 바로 말하게 하고, 아니면 붙들어 두고 false. */
    fun offer(utterance: Utterance): Boolean = synchronized(lock) {
        if (ready) {
            true
        } else {
            waiting = utterance
            false
        }
    }

    /** 준비가 끝났다. 붙들어 둔 말이 있으면 돌려준다. */
    fun markReady(): Utterance? = synchronized(lock) {
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
