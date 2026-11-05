package com.chagok.car.runtime

import ai.pleos.playground.tts.TextToSpeech
import ai.pleos.playground.tts.listener.EventListener
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import ai.pleos.playground.tts.constant.ErrorType as TtsErrorType
import ai.pleos.playground.tts.constant.Mode as TtsMode
import ai.pleos.playground.tts.listener.OnInitializeListener as TtsInitializeListener

/**
 * 말하기(TTS, MAY_DUCK 포커스)를 세션 Effect대로 실행한다(7장).
 *
 * - 발화마다 토큰([SpeechTurns])을 둬서 이전 발화의 늦은 콜백을 걸러 낸다.
 * - 오디오 포커스를 잃으면(LOSS·LOSS_TRANSIENT) 말하기를 즉시 멈추고 포커스를 반납한다.
 * - TTS 초기화가 끝나기 전에 온 말하기는 [DeferredSpeech]에 붙들어 두었다가 준비되면 말한다(Suspend 해제 직후 포함).
 * - [stop] 뒤(Suspend 등)에는 [start]를 다시 부르기 전까지 말하지도 포커스를 요청하지도 않는다.
 */
class VoiceAdapter(
    context: Context,
    /** 말하는 동안만 true. 화면의 파형(VoiceIndicator)과 볼륨 낮춤 안내(DuckingPill)가 이 값을 따른다. */
    private val onSpeaking: (Boolean) -> Unit = {},
) : Speaker {
    private val appContext = context.applicationContext
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                // 가이드: 즉시 중단하고 필요하면 포커스를 반납. 카드와 버튼, 30초 타임아웃은 세션이 그대로 둔다.
                Log.i(TAG, "오디오 포커스 상실($change): 말하기 중단")
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

    @Volatile private var closed = true
    private val deferred = DeferredSpeech()

    private val speech = SpeechTurns()

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

    /** SDK를 새로 만들어 초기화한다. [stop] 뒤에 다시 부를 수 있다. 초기화가 실패하면 한 번 더 시도한다. */
    override fun start() {
        if (!closed) return
        closed = false
        deferred.reset()
        initialize(attempt = 0)
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
        } else {
            deferred.cancel()
        }
    }

    /**
     * 말한다. 닫혔으면 버리고(포커스도 잡지 않는다), TTS가 초기화되기 전이면 준비될 때까지 붙들어 둔다.
     * 포커스를 얻지 못해도 말하지 않는다. 화면 표시는 세션이 따로 한다.
     */
    override fun speak(text: String) {
        if (closed) {
            Log.i(TAG, "말하기 건너뜀: closed")
            return
        }
        if (!deferred.offer(text)) {
            Log.i(TAG, "TTS 준비 전: 준비되면 말함")
            return
        }
        speakNow(text)
    }

    private fun speakNow(text: String) {
        stopAll()
        val result = audioManager.requestAudioFocus(focusRequest)
        Log.i(TAG, "오디오 포커스(MAY_DUCK) 결과=$result")
        if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return

        val token = speech.begin()
        onSpeaking(true)
        // 상한 타이머: 끝 콜백이 없어도 일정 시간 뒤 발화를 끝내고 포커스를 반납한다.
        main.postDelayed({ finishSpeaking(speech.onCap(token)) }, CAP_TOKEN, SPEAK_CAP_MILLIS)
        try {
            textToSpeech?.speak(text)
        } catch (e: Exception) {
            Log.w(TAG, "speak 실패", e)
            finishSpeaking(speech.onCap(token))
        }
    }

    /** 말하기를 멈추고 포커스를 반납한다. */
    override fun stopAll() {
        deferred.cancel()
        speech.cancel()
        onSpeaking(false)
        main.removeCallbacksAndMessages(CAP_TOKEN)
        runCatching { textToSpeech?.stop() }
        audioManager.abandonAudioFocusRequest(focusRequest)
    }

    /** 중단 → 포커스 반납 → SDK 해제. 다시 [start]하기 전까지 말하지 않는다. */
    override fun stop() {
        closed = true
        main.removeCallbacksAndMessages(RETRY_TOKEN)
        stopAll()
        runCatching { textToSpeech?.removeEventListener(ttsListener) }
        runCatching { textToSpeech?.release() }
        textToSpeech = null
        deferred.reset()
    }

    private fun finishSpeaking(finished: Boolean) {
        if (!finished) return
        onSpeaking(false)
        main.removeCallbacksAndMessages(CAP_TOKEN)
        audioManager.abandonAudioFocusRequest(focusRequest)
    }

    private companion object {
        const val TAG = "ChagokVoice"
        const val SPEAK_CAP_MILLIS = 15_000L
        const val MAX_INIT_RETRIES = 1
        const val INIT_RETRY_DELAY_MILLIS = 2_000L
        val CAP_TOKEN = Any()
        val RETRY_TOKEN = Any()
    }
}
