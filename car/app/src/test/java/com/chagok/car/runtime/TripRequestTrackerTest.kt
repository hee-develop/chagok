package com.chagok.car.runtime

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration

class TripRequestTrackerTest {
    private val place = Place("강남역", LatLng(37.4979, 127.0276))
    private val tracker = TripRequestTracker(Duration.ofSeconds(3))

    @Test fun `연결되기 전과 재시작 직후와 연결 실패 뒤에는 길안내 요청을 보낼 수 없다`() {
        assertEquals(false, tracker.ready)
        tracker.connected()
        assertEquals(true, tracker.ready)
        // 내비를 끄고 다시 켠 직후(reset)에는 다시 연결될 때까지 준비 안 됨
        tracker.reset()
        assertEquals(false, tracker.ready)
        tracker.connected()
        tracker.connectionFailed()
        assertEquals(false, tracker.ready)
    }

    @Test fun `연결된 뒤의 요청은 바로 보낸다`() {
        tracker.connected()
        assertEquals(TripRequestTracker.Step.SEND_NOW, tracker.request(1, place))
        assertEquals(1, tracker.resolve())
        assertNull(tracker.resolve())
    }

    @Test fun `연결 전의 요청은 버리지 않고 대기시켰다가 연결되면 보낸다`() {
        assertEquals(TripRequestTracker.Step.WAIT_FOR_CONNECTION, tracker.request(7, place))
        val toSend = tracker.connected()
        assertEquals(7, toSend?.id)
        assertEquals(place, toSend?.place)
        // 한 번만 보낸다
        assertNull(tracker.connected())
        assertEquals(7, tracker.resolve())
    }

    @Test fun `타임아웃은 연결을 기다린 시간을 포함해 요청 시점부터 센다`() {
        assertEquals(Duration.ofSeconds(3), tracker.timeout)
        tracker.request(2, place)
        // 연결이 안 와서 타이머가 울리면 그 요청은 끝난다
        assertTrue(tracker.expire(2))
        assertNull(tracker.connected())
    }

    @Test fun `이전 요청의 타이머는 새 요청을 끝내지 못한다`() {
        tracker.connected()
        tracker.request(1, place)
        tracker.request(2, place)
        assertFalse(tracker.expire(1))
        assertTrue(tracker.expire(2))
        assertFalse(tracker.expire(2))
    }

    @Test fun `응답이 온 뒤 타이머가 울려도 무시한다`() {
        tracker.connected()
        tracker.request(3, place)
        assertEquals(3, tracker.resolve())
        assertFalse(tracker.expire(3))
    }

    @Test fun `연결 실패면 대기 중인 요청을 실패로 알리고 이후 요청도 바로 실패한다`() {
        tracker.request(4, place)
        assertEquals(4, tracker.connectionFailed())
        assertEquals(TripRequestTracker.Step.FAIL, tracker.request(5, place))
    }

    @Test fun `이동 시간 단위 방어 - 0 이하나 24시간 이상은 모르는 값`() {
        assertEquals(Duration.ofSeconds(1), NaviDuration.of(1))
        assertEquals(Duration.ofSeconds(86_399), NaviDuration.of(86_399))
        assertNull(NaviDuration.of(0))
        assertNull(NaviDuration.of(-5))
        assertNull(NaviDuration.of(86_400))
        // 도착 시각(epoch 초)일 수도 있는 큰 값
        assertNull(NaviDuration.of(1_800_000_000))
    }

    @Test fun `해제 뒤 다시 시작하면 이전 연결 상태를 이어받지 않는다`() {
        tracker.connected()
        tracker.reset()
        // 새 helper가 아직 연결되지 않았으니 바로 보내지 않고 연결을 기다린다.
        assertEquals(TripRequestTracker.Step.WAIT_FOR_CONNECTION, tracker.request(5, place))
        assertEquals(5, tracker.connected()?.id)
    }

    @Test fun `연결 실패는 재시작 뒤에 이어지지 않는다`() {
        tracker.connectionFailed()
        assertEquals(TripRequestTracker.Step.FAIL, tracker.request(1, place))
        tracker.reset()
        assertEquals(TripRequestTracker.Step.WAIT_FOR_CONNECTION, tracker.request(2, place))
    }

    @Test fun `재시작하면 대기 중이던 요청은 지워진다`() {
        tracker.request(3, place)
        tracker.reset()
        assertNull(tracker.connected())
        assertNull(tracker.resolve())
    }
}
