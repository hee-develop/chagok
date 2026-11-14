package com.chagok.car.flow

import java.io.IOException
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 앱이 앞으로 올 때 서버에 연결이 아직 있는지 묻는 판정. **서버가 이 차를 알고(200) 자리가 0개라고 답했을 때만** RELEASED다.
 * 서버가 이 차를 모르거나(404: 서버 재시작·TTL 삭제)·네트워크 실패·5xx·타임아웃이면 해제로 단정하지 않는다.
 */
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

    @Test fun `서버가 이 차를 모르면(404) paired가 false여도 해제로 보지 않는다`() {
        // 서버를 다시 켜 메모리가 비었거나 자리 없는 차가 TTL로 지워졌다: HttpPairingClient가 404를 known=false로 돌려준다.
        val client = FakeClient { PairingStatus(paired = false, codeActive = false, known = false) }
        assertEquals(PairingVerdict.UNKNOWN, PairingVerifier.verify(client, "car", paired = true, pairedByServer = true))
    }

    @Test fun `서버에 연결이 있으면 그대로다`() {
        val client = FakeClient { PairingStatus(paired = true, codeActive = false) }
        assertEquals(PairingVerdict.STILL_PAIRED, PairingVerifier.verify(client, "car", paired = true, pairedByServer = true))
    }

    @Test fun `네트워크 실패나 이상한 응답은 해제로 단정하지 않는다`() {
        assertEquals(PairingVerdict.UNKNOWN, PairingVerifier.verify(FakeClient { throw IOException("서버 꺼짐") }, "car", paired = true, pairedByServer = true))
        assertEquals(PairingVerdict.UNKNOWN, PairingVerifier.verify(FakeClient { error("응답이 이상함") }, "car", paired = true, pairedByServer = true))
        // 5xx·타임아웃은 HttpPairingClient가 IOException으로 던진다.
        assertEquals(PairingVerdict.UNKNOWN, PairingVerifier.verify(FakeClient { throw IOException("연결 GET /pairing/cars/x 500") }, "car", paired = true, pairedByServer = true))
    }

    @Test fun `연결 전이거나 서버가 확인해 준 연결이 아니면 묻지 않는다`() {
        val client = FakeClient { PairingStatus(paired = false, codeActive = false) }
        assertEquals(PairingVerdict.SKIPPED, PairingVerifier.verify(client, "car", paired = false, pairedByServer = false))
        assertEquals(PairingVerdict.SKIPPED, PairingVerifier.verify(client, "car", paired = false, pairedByServer = true))
        // debug 신호로 미리 연결한 차(서버는 이 연결을 모른다)는 서버에 물으면 늘 해제로 보이므로 묻지 않는다.
        assertEquals(PairingVerdict.SKIPPED, PairingVerifier.verify(client, "car", paired = true, pairedByServer = false))
        assertEquals(0, client.asked)
    }

    private class FakeFlags(override var paired: Boolean, override var pairedByServer: Boolean) : PairingFlags

    @Test fun `debug 신호로 연결하면 이미 연결된 상태여도 서버가 확인한 연결이 아니라 재진입 확인을 하지 않는다`() {
        // 서버가 확인한 연결(폰이 코드를 보냄)을 debug paired=true가 덮는다: 같은 값이라 상태는 안 바뀌어도 pairedByServer는 false여야 한다.
        val flags = FakeFlags(paired = true, pairedByServer = true)
        assertEquals(false, PairingFlagRules.setByDebug(flags, true))
        assertEquals(false, flags.pairedByServer)
        val client = FakeClient { PairingStatus(paired = false, codeActive = false) }
        assertEquals(PairingVerdict.SKIPPED, PairingVerifier.verify(client, "car", flags.paired, flags.pairedByServer))
        assertEquals(0, client.asked)
    }

    @Test fun `debug 신호로 연결 상태가 바뀌면 true를 돌려주고 늘 서버 확인 연결이 아니다`() {
        val flags = FakeFlags(paired = false, pairedByServer = true)
        assertEquals(true, PairingFlagRules.setByDebug(flags, true))
        assertEquals(true, flags.paired)
        assertEquals(false, flags.pairedByServer)
        assertEquals(true, PairingFlagRules.setByDebug(flags, false))
        assertEquals(false, flags.paired)
        assertEquals(false, flags.pairedByServer)
        assertEquals(false, PairingFlagRules.setByDebug(flags, false))
    }
}
