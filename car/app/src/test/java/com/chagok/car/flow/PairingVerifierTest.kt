package com.chagok.car.flow

import java.io.IOException
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

/** 앱이 앞으로 올 때 서버에 연결이 아직 있는지 묻는 판정. 해제를 확인했을 때만 RELEASED이고 네트워크 실패는 해제로 단정하지 않는다. */
class PairingVerifierTest {
    private class FakeClient(private val status: () -> PairingStatus) : PairingClient {
        var asked = 0
        override fun issue(carId: String) = PairingCode("123456", "chagok://pair?code=123456", Instant.EPOCH)
        override fun status(carId: String): PairingStatus {
            asked++
            return status()
        }

        override fun unpair(carId: String) = Unit
    }

    @Test fun `서버가 연결 없음이라고 답하면 해제다`() {
        val client = FakeClient { PairingStatus(paired = false, codeActive = false) }
        assertEquals(PairingVerdict.RELEASED, PairingVerifier.verify(client, "car", paired = true, pairedByServer = true))
    }

    @Test fun `서버에 연결이 있으면 그대로다`() {
        val client = FakeClient { PairingStatus(paired = true, codeActive = false) }
        assertEquals(PairingVerdict.STILL_PAIRED, PairingVerifier.verify(client, "car", paired = true, pairedByServer = true))
    }

    @Test fun `네트워크 실패나 이상한 응답은 해제로 단정하지 않는다`() {
        assertEquals(PairingVerdict.UNKNOWN, PairingVerifier.verify(FakeClient { throw IOException("서버 꺼짐") }, "car", paired = true, pairedByServer = true))
        assertEquals(PairingVerdict.UNKNOWN, PairingVerifier.verify(FakeClient { error("응답이 이상함") }, "car", paired = true, pairedByServer = true))
    }

    @Test fun `연결 전이거나 서버가 확인해 준 연결이 아니면 묻지 않는다`() {
        val client = FakeClient { PairingStatus(paired = false, codeActive = false) }
        assertEquals(PairingVerdict.SKIPPED, PairingVerifier.verify(client, "car", paired = false, pairedByServer = false))
        assertEquals(PairingVerdict.SKIPPED, PairingVerifier.verify(client, "car", paired = false, pairedByServer = true))
        // debug 신호로 미리 연결한 차(서버는 이 연결을 모른다)는 서버에 물으면 늘 해제로 보이므로 묻지 않는다.
        assertEquals(PairingVerdict.SKIPPED, PairingVerifier.verify(client, "car", paired = true, pairedByServer = false))
        assertEquals(0, client.asked)
    }
}
