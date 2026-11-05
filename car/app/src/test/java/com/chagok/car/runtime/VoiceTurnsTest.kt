package com.chagok.car.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceTurnsTest {
    private val speech = SpeechTurns()

    @Test fun `시작을 본 뒤의 끝 콜백이 현재 발화의 끝이다`() {
        speech.begin()
        speech.onStart()
        assertTrue(speech.onEnd())
        assertFalse(speech.onEnd())
    }

    @Test fun `이전 발화의 늦은 끝 콜백은 새 발화를 끝내지 않는다`() {
        speech.begin()
        speech.onStart()
        // 새 발화가 이전 발화를 끊고 시작했지만 아직 시작 콜백은 못 봤다
        speech.begin()
        assertFalse(speech.onEnd()) // 이전 발화의 늦은 onDone·onError
        assertTrue(speech.isActive)
        speech.onStart()
        assertTrue(speech.onEnd())
    }

    @Test fun `멈추면 진행 중이던 발화의 콜백을 모두 무시한다`() {
        speech.begin()
        speech.onStart()
        speech.cancel()
        assertFalse(speech.onEnd())
        assertFalse(speech.isActive)
    }

    @Test fun `끝 콜백이 안 와도 상한 타이머가 그 발화를 끝낸다`() {
        val token = speech.begin()
        assertTrue(speech.onCap(token))
        assertFalse(speech.onCap(token))
    }

    @Test fun `이전 발화의 상한 타이머는 새 발화를 끝내지 않는다`() {
        val old = speech.begin()
        val current = speech.begin()
        assertFalse(speech.onCap(old))
        assertTrue(speech.isActive)
        assertTrue(speech.onCap(current))
    }
}

class DeferredSpeechTest {
    private val deferred = DeferredSpeech()

    @Test fun `준비 전 말하기는 붙들었다가 준비되면 내보낸다`() {
        assertFalse(deferred.offer("안녕하세요"))
        assertEquals("안녕하세요", deferred.markReady())
        assertNull(deferred.markReady())
    }

    @Test fun `준비된 뒤에는 바로 말한다`() {
        deferred.markReady()
        assertTrue(deferred.offer("안녕하세요"))
    }

    @Test fun `준비 전에는 가장 최근 말하기만 남긴다`() {
        deferred.offer("첫째")
        deferred.offer("둘째")
        assertEquals("둘째", deferred.markReady())
    }

    @Test fun `멈추거나 다시 초기화하면 붙든 말을 버린다`() {
        deferred.offer("첫째")
        deferred.cancel()
        assertNull(deferred.markReady())

        deferred.reset()
        deferred.offer("둘째")
        deferred.reset()
        assertNull(deferred.markReady())
    }

    @Test fun `다시 초기화하면 준비 안 됨으로 돌아간다`() {
        deferred.markReady()
        deferred.reset()
        assertFalse(deferred.offer("셋째"))
    }
}
