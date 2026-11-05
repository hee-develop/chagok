package com.chagok.car.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceTurnsTest {
    private val speech = SpeechTurns()

    @Test fun `시작을 본 뒤의 끝 콜백이 현재 발화의 끝이다`() {
        speech.begin(thenListen = true)
        speech.onStart()
        assertTrue(speech.onEnd()!!.listenAfter)
        assertNull(speech.onEnd())
    }

    @Test fun `이전 발화의 늦은 끝 콜백은 새 발화를 끝내지 않는다`() {
        speech.begin(thenListen = true)
        speech.onStart()
        // 새 발화가 이전 발화를 끊고 시작했지만 아직 시작 콜백은 못 봤다
        speech.begin(thenListen = false)
        assertNull(speech.onEnd()) // 이전 발화의 늦은 onDone·onError
        assertTrue(speech.isActive)
        speech.onStart()
        assertFalse(speech.onEnd()!!.listenAfter)
    }

    @Test fun `멈추면 진행 중이던 발화의 콜백을 모두 무시한다`() {
        speech.begin(thenListen = true)
        speech.onStart()
        speech.cancel()
        assertNull(speech.onEnd())
        assertFalse(speech.isActive)
    }

    @Test fun `끝 콜백이 안 와도 상한 타이머가 그 발화를 끝낸다`() {
        val token = speech.begin(thenListen = true)
        assertNotNull(speech.onCap(token))
        assertNull(speech.onCap(token))
    }

    @Test fun `이전 발화의 상한 타이머는 새 발화를 끝내지 않는다`() {
        val old = speech.begin(thenListen = true)
        val current = speech.begin(thenListen = true)
        assertNull(speech.onCap(old))
        assertTrue(speech.isActive)
        assertNotNull(speech.onCap(current))
    }

    @Test fun `듣기 - 부분 결과는 종료 때 쓰고 끝난 듣기의 콜백은 무시한다`() {
        val listening = ListenTurns()
        listening.begin()
        listening.onPartial("응")
        assertEquals("응", listening.finish(null))
        assertNull(listening.finish("늦은 결과"))
        assertFalse(listening.isActive)
    }

    @Test fun `듣기 - 멈춘 듣기와 이전 듣기의 상한 타이머는 새 듣기를 닫지 못한다`() {
        val listening = ListenTurns()
        val old = listening.begin()
        listening.cancel()
        assertNull(listening.finish("멈춘 뒤 결과"))
        val current = listening.begin()
        assertNull(listening.cap(old))
        assertTrue(listening.isActive)
        assertEquals("", listening.cap(current))
    }

    @Test fun `듣기 - 완료 결과가 먼저 오면 뒤따르는 종료 콜백은 무시한다`() {
        val listening = ListenTurns()
        listening.begin()
        assertEquals("응", listening.finish("응"))
        assertNull(listening.finish(null))
    }
}

class StopGateTest {
    private val gate = StopGate()

    @Test fun `예약한 뒤 멈춤이 없으면 듣기를 열 수 있다`() {
        val ticket = gate.ticket()
        assertTrue(gate.valid(ticket))
    }

    @Test fun `예약한 뒤 멈춘 적이 있으면 듣기를 열 수 없다`() {
        val ticket = gate.ticket()
        gate.stopped()
        assertFalse(gate.valid(ticket))
        // 멈춘 뒤 새로 예약한 것은 유효하다.
        assertTrue(gate.valid(gate.ticket()))
    }

    @Test fun `멈춤이 여러 번이어도 이전 예약은 모두 무효다`() {
        val old = gate.ticket()
        gate.stopped()
        val mid = gate.ticket()
        gate.stopped()
        assertFalse(gate.valid(old))
        assertFalse(gate.valid(mid))
    }
}

class DeferredSpeechTest {
    private val deferred = DeferredSpeech()

    @Test fun `준비 전 말하기는 붙들었다가 준비되면 내보낸다`() {
        assertFalse(deferred.offer(Utterance("안녕하세요", thenListen = true)))
        assertEquals(Utterance("안녕하세요", thenListen = true), deferred.markReady())
        assertNull(deferred.markReady())
    }

    @Test fun `준비된 뒤에는 바로 말한다`() {
        deferred.markReady()
        assertTrue(deferred.offer(Utterance("안녕하세요", thenListen = false)))
    }

    @Test fun `준비 전에는 가장 최근 말하기만 남긴다`() {
        deferred.offer(Utterance("첫째", thenListen = true))
        deferred.offer(Utterance("둘째", thenListen = false))
        assertEquals(Utterance("둘째", thenListen = false), deferred.markReady())
    }

    @Test fun `멈추거나 다시 초기화하면 붙든 말을 버린다`() {
        deferred.offer(Utterance("첫째", thenListen = true))
        deferred.cancel()
        assertNull(deferred.markReady())

        deferred.reset()
        deferred.offer(Utterance("둘째", thenListen = true))
        deferred.reset()
        assertNull(deferred.markReady())
    }

    @Test fun `다시 초기화하면 준비 안 됨으로 돌아간다`() {
        deferred.markReady()
        deferred.reset()
        assertFalse(deferred.offer(Utterance("셋째", thenListen = true)))
    }
}
