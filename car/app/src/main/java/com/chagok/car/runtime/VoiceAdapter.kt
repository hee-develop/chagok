package com.chagok.car.runtime

import ai.pleos.playground.stt.SpeechToText
import ai.pleos.playground.stt.listener.ResultListener
import ai.pleos.playground.tts.TextToSpeech
import ai.pleos.playground.tts.listener.EventListener
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.chagok.car.domain.Rules
import com.chagok.car.flow.Event
import ai.pleos.playground.stt.constant.ErrorType as SttErrorType
import ai.pleos.playground.stt.constant.Mode as SttMode
import ai.pleos.playground.stt.listener.OnInitializeListener as SttInitializeListener
import ai.pleos.playground.tts.constant.ErrorType as TtsErrorType
import ai.pleos.playground.tts.constant.Mode as TtsMode
import ai.pleos.playground.tts.listener.OnInitializeListener as TtsInitializeListener

/**
 * 말하기(TTS, MAY_DUCK 포커스)와 듣기(STT, 앱 타이머로 [Rules.LISTEN_WINDOW] 뒤 종료)를 세션 Effect대로 실행한다(7장).
 * 듣기는 말이 끝난 뒤에만 열고, 결과는 [Event.Heard]로 한 번만 알린다. 못 들었으면 빈 문자열.
 *
 * - 발화마다 토큰([SpeechTurns])을 둬서 이전 발화의 늦은 콜백을 거른다. 듣기([ListenTurns])는 STT 콜백에 듣기 ID가 없어
 *   현재 듣기가 열려 있는 동안 온 콜백을 그 듣기의 것으로 본다(멈춘 듣기와 이미 끝난 듣기의 콜백만 거른다).
 * - 듣는 동안에도 말할 때 잡은 오디오 포커스(MAY_DUCK)를 쥔다. 포커스는 듣기가 끝나 결과를 알릴 때, 듣기를 시작하지 못할 때,
 *   [stopAll]·[stop]에서 반납한다.
 * - 오디오 포커스를 잃으면(LOSS·LOSS_TRANSIENT) 말하기와 듣기를 즉시 멈추고 포커스를 반납한다. 멈춘 듣기는 결과를 알리지 않는다.
 * - TTS·STT 초기화가 실패하면 한 번 더 시도한다. STT가 준비되지 않았을 때 듣기는 빈 결과로 끝난다.
 * - TTS 초기화가 끝나기 전에 온 말하기는 [DeferredSpeech]에 붙들어 두었다가 준비되면 말한다(Suspend 해제 직후 포함).
 * - [stop] 뒤(Suspend 등)에는 [start]를 다시 부르기 전까지 말하지도 듣지도 포커스를 요청하지도 않는다.
 */
class VoiceAdapter(
    context: Context,
    private val sink: (Event) -> Unit,
    /** 말하는 동안만 true. 카드 머리의 파형(VoiceIndicator)이 이 값을 따른다. */
    private val onSpeaking: (Boolean) -> Unit = {},
    /** 오디오 포커스를 쥐고 있는 동안(말하기와 듣기)만 true. 볼륨 낮춤 안내(DuckingPill)가 이 값을 따른다. */
    private val onDucking: (Boolean) -> Unit = {},
) : Speaker {
    private val appContext = context.applicationContext
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                // 가이드: 즉시 중단하고 필요하면 포커스를 반납. 카드와 버튼, 30초 타임아웃은 세션이 그대로 둔다.
                Log.i(TAG, "오디오 포커스 상실($change): 말하기·듣기 중단")
                stopAll()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
                // 우리 TTS는 볼륨을 직접 조절할 수 없고 setWillPauseWhenDucked(false)라 시스템이 감쇄한다.
                Log.i(TAG, "오디오 포커스 CAN_DUCK: 시스템 감쇄에 맡김")
            AudioManager.AUDIOFOCUS_GAIN -> Log.i(TAG, "오디오 포커스 GAIN: 자동 재개하지 않음")
        }
    }

    private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        .setWillPauseWhenDucked(false)
        .setOnAudioFocusChangeListener(focusListener, main)
        .build()

    @Volatile private var textToSpeech: TextToSpeech? = null
    @Volatile private var speechToText: SpeechToText? = null

    @Volatile private var closed = true
    @Volatile private var sttReady = false
    private val deferred = DeferredSpeech()

    private val speech = SpeechTurns()
    private val stopGate = StopGate()
    private val listening = ListenTurns()

    private val ttsListener = object : EventListener {
        override fun onReady() = Unit
        override fun onStart() = speech.onStart()
        override fun onUpdatedRms(rms: Double) = Unit
        override fun onDone() = finishSpeaking(speech.onEnd())
        override fun onStop() = Unit
        override fun onError(errorType: TtsErrorType) {
            Log.w(TAG, "TTS 오류 $errorType")
            finishSpeaking(speech.onEnd())
        }
    }

    private val sttListener = object : ResultListener {
        override fun onReady() = Unit
        override fun onStartedRecognition() = Unit
        override fun onUpdated(stt: String, completed: Boolean) {
            listening.onPartial(stt)
            if (completed) deliver(listening.finish(stt))
        }

        override fun onUpdatedEpdData(on: Long, off: Long) = Unit
        override fun onUpdatedRms(rms: Double) = Unit
        override fun onEndedRecognition() = deliver(listening.finish(null))
        override fun onError(errorType: SttErrorType) {
            Log.w(TAG, "STT 오류 $errorType")
            deliver(listening.finish(""))
        }
    }

    /** SDK를 새로 만들어 초기화한다. [stop] 뒤에 다시 부를 수 있다. TTS 초기화가 실패하면 한 번 더 시도한다. */
    override fun start() {
        if (!closed) return
        closed = false
        sttReady = false
        deferred.reset()
        initialize(attempt = 0)
        initializeStt(attempt = 0)
    }

    private fun initializeStt(attempt: Int) {
        val stt = try {
            SpeechToText(appContext, SttMode.ON_DEVICE)
        } catch (e: Exception) {
            Log.w(TAG, "STT 생성 예외", e)
            retryInitializeStt(attempt)
            return
        }
        speechToText = stt
        try {
            stt.initialize(object : SttInitializeListener {
                override fun onSuccess() {
                    main.post {
                        if (closed || speechToText !== stt) return@post
                        stt.addListener(sttListener)
                        sttReady = true
                    }
                }

                override fun onFailure(errorType: SttErrorType) {
                    Log.w(TAG, "STT 초기화 실패 $errorType")
                    main.post { onInitializeSttFailed(stt, attempt) }
                }
            })
        } catch (e: Exception) {
            Log.w(TAG, "STT 초기화 예외", e)
            main.post { onInitializeSttFailed(stt, attempt) }
        }
    }

    private fun onInitializeSttFailed(stt: SpeechToText, attempt: Int) {
        if (closed || speechToText !== stt) return
        runCatching { stt.release() }
        speechToText = null
        retryInitializeStt(attempt)
    }

    private fun retryInitializeStt(attempt: Int) {
        if (attempt < MAX_INIT_RETRIES) {
            main.postDelayed({ if (!closed && speechToText == null) initializeStt(attempt + 1) }, RETRY_TOKEN, INIT_RETRY_DELAY_MILLIS)
        }
    }

    private fun initialize(attempt: Int) {
        val tts = try {
            TextToSpeech(appContext, TtsMode.ON_DEVICE)
        } catch (e: Exception) {
            Log.w(TAG, "TTS 생성 예외", e)
            retryInitialize(attempt)
            return
        }
        textToSpeech = tts
        try {
            tts.initialize(object : TtsInitializeListener {
                override fun onSuccess() {
                    // 해제됐거나 새 인스턴스로 바뀐 뒤에 늦게 온 성공 콜백은 무시한다.
                    main.post {
                        if (closed || textToSpeech !== tts) return@post
                        tts.addEventListener(ttsListener)
                        deferred.markReady()?.let(::speakNow)
                    }
                }

                override fun onFailure(errorType: TtsErrorType) {
                    Log.w(TAG, "TTS 초기화 실패 $errorType")
                    main.post { onInitializeFailed(tts, attempt) }
                }
            })
        } catch (e: Exception) {
            Log.w(TAG, "TTS 초기화 예외", e)
            main.post { onInitializeFailed(tts, attempt) }
        }
    }

    /** 초기화 실패: 인스턴스를 해제하고 [INIT_RETRY_DELAY_MILLIS] 뒤 한 번 다시 시도한다. 그래도 실패하면 붙들어 둔 말을 버린다. */
    private fun onInitializeFailed(tts: TextToSpeech, attempt: Int) {
        if (closed || textToSpeech !== tts) return
        runCatching { tts.release() }
        textToSpeech = null
        retryInitialize(attempt)
    }

    private fun retryInitialize(attempt: Int) {
        if (attempt < MAX_INIT_RETRIES) {
            main.postDelayed({ if (!closed && textToSpeech == null) initialize(attempt + 1) }, RETRY_TOKEN, INIT_RETRY_DELAY_MILLIS)
        } else if (deferred.cancel()) {
            // 초기화에 끝내 실패해 붙들어 둔 말을 버렸다: 말하지 못한 것이다.
            sink(Event.SpeechUnavailable)
        }
    }

    /**
     * 말한다. 닫혔으면 버리고(포커스도 잡지 않는다), TTS가 초기화되기 전이면 준비될 때까지 붙들어 둔다.
     * 포커스를 얻지 못해도 말하지 않는다(세션에는 [Event.SpeechUnavailable]로 알린다). 화면 표시는 세션이 따로 한다.
     */
    override fun speak(text: String, thenListen: Boolean) {
        if (closed) {
            Log.i(TAG, "말하기 건너뜀: closed")
            return
        }
        val utterance = Utterance(text, thenListen)
        if (!deferred.offer(utterance)) {
            Log.i(TAG, "TTS 준비 전: 준비되면 말함")
            return
        }
        speakNow(utterance)
    }

    private fun speakNow(utterance: Utterance) {
        stopAll()
        val result = audioManager.requestAudioFocus(focusRequest)
        Log.i(TAG, "오디오 포커스(MAY_DUCK) 결과=$result")
        if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            // 말하지 못했다고 세션에 알린다. 다시 묻는 카드였다면 그 '한 번'의 기회를 쓴 것으로 치지 않는다.
            sink(Event.SpeechUnavailable)
            return
        }

        val token = speech.begin(utterance.thenListen)
        onSpeaking(true)
        onDucking(true)
        // 상한 타이머: 끝 콜백이 없어도 일정 시간 뒤 TTS를 멈추고 발화를 끝낸다. 이어서 듣는 발화면 TTS를 멈춘 뒤 듣는다.
        main.postDelayed(
            {
                val finished = speech.onCap(token)
                if (finished != null) runCatching { textToSpeech?.stop() }
                finishSpeaking(finished)
            },
            CAP_TOKEN,
            SPEAK_CAP_MILLIS,
        )
        try {
            textToSpeech?.speak(utterance.text)
        } catch (e: Exception) {
            Log.w(TAG, "speak 실패", e)
            finishSpeaking(speech.onCap(token))
        }
    }

    /** 말하기와 듣기를 모두 멈추고 포커스를 반납한다. 멈춘 듣기는 결과를 알리지 않는다. */
    override fun stopAll() {
        stopGate.stopped()
        deferred.cancel()
        speech.cancel()
        onSpeaking(false)
        listening.cancel()
        main.removeCallbacksAndMessages(CAP_TOKEN)
        main.removeCallbacksAndMessages(LISTEN_TOKEN)
        runCatching { textToSpeech?.stop() }
        runCatching { speechToText?.stop() }
        releaseFocus()
    }

    private fun releaseFocus() {
        audioManager.abandonAudioFocusRequest(focusRequest)
        onDucking(false)
    }

    /** 중단 → 포커스 반납 → SDK 해제. 다시 [start]하기 전까지 말하지 않는다. */
    override fun stop() {
        closed = true
        main.removeCallbacksAndMessages(RETRY_TOKEN)
        stopAll()
        runCatching { textToSpeech?.removeEventListener(ttsListener) }
        runCatching { textToSpeech?.release() }
        runCatching { speechToText?.removeListener(sttListener) }
        runCatching { speechToText?.release() }
        textToSpeech = null
        speechToText = null
        sttReady = false
        deferred.reset()
    }

    private fun finishSpeaking(finished: SpeechTurns.Finished?) {
        if (finished == null) return
        onSpeaking(false)
        main.removeCallbacksAndMessages(CAP_TOKEN)
        if (!finished.listenAfter || closed) {
            releaseFocus()
            return
        }
        // 포커스를 쥔 채 듣는다. 예약한 뒤 멈춤(stopAll)이나 새 말하기가 있었다면 듣지 않는다(그쪽이 포커스를 정리한다).
        val ticket = stopGate.ticket()
        main.post { if (!closed && stopGate.valid(ticket) && !speech.isActive && !listening.isActive) listen() }
    }

    private fun listen() {
        val token = listening.begin()
        val stt = speechToText
        try {
            if (!sttReady || stt == null) error("STT 준비 전")
            stt.request()
        } catch (e: Exception) {
            Log.w(TAG, "STT request 실패", e)
            deliver(listening.finish(""))
            return
        }
        main.postDelayed({ runCatching { speechToText?.stop() } }, LISTEN_TOKEN, Rules.LISTEN_WINDOW.toMillis())
        // stop() 뒤 종료 콜백이 오지 않아도 세션이 멈추지 않게 한다.
        main.postDelayed(
            { deliver(listening.cap(token)) },
            LISTEN_TOKEN,
            Rules.LISTEN_WINDOW.toMillis() + FALLBACK_MILLIS,
        )
    }

    /** 결과가 null이면 이미 끝났거나 멈춘 듣기이므로 알리지 않는다. */
    private fun deliver(result: String?) {
        if (result == null) return
        main.removeCallbacksAndMessages(LISTEN_TOKEN)
        releaseFocus()
        sink(Event.Heard(result))
    }

    private companion object {
        const val TAG = "ChagokVoice"
        const val FALLBACK_MILLIS = 1_500L
        const val SPEAK_CAP_MILLIS = 15_000L
        const val MAX_INIT_RETRIES = 1
        const val INIT_RETRY_DELAY_MILLIS = 2_000L
        val CAP_TOKEN = Any()
        val RETRY_TOKEN = Any()
        val LISTEN_TOKEN = Any()
    }
}
