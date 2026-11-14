package com.chagok.car.flow

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.time.Instant

/**
 * 차의 연결 상태. [known]이 false면 서버가 이 차 자체를 모른다(`404 unknown-car`: 서버를 다시 켜 메모리가 비었거나 자리 없는 차가 TTL로 지워짐) —
 * 연결이 풀렸다는 뜻이 아니다. 새 코드를 받으면 서버가 차를 다시 만든다. [known]이면 [paired]는 이 차에 연결된 자리가 하나라도 있는가이고,
 * [codeActive]가 false면 서버가 이 차의 살아 있는 코드를 모른다(만료·재발급 필요).
 */
data class PairingStatus(val paired: Boolean, val codeActive: Boolean, val known: Boolean = true)

/** 서버가 낸 연결 코드. [qr]은 차 화면 QR에 담을 글(`chagok://pair?code=…`), [code]는 숫자 6자리다. */
data class PairingCode(val code: String, val qr: String, val expiresAt: Instant)

/** [PairingVerifier.verify]의 판정. */
enum class PairingVerdict {
    /** 확인할 필요가 없다(연결 전이거나, 서버가 확인해 준 연결이 아니라 서버는 이 연결을 모른다 — debug 신호로 미리 연결한 경우). */
    SKIPPED,

    /** 서버에 이 차의 연결이 아직 있다. */
    STILL_PAIRED,

    /** 서버가 이 차를 알고(200) 연결(자리)이 0개라고 답했다(해제). */
    RELEASED,

    /**
     * 해제로 단정하지 않는다: 서버에 닿지 못했거나(타임아웃·5xx) 응답이 이상하거나, 서버가 이 차 자체를 모른다(404: 서버 재시작·TTL 삭제).
     * 받아 둔 사본·집은 그대로 둔다(정책서 5장: 서버 응답 실패면 오늘 사본으로 브리핑).
     */
    UNKNOWN,
}

/**
 * 앱이 앞으로 올 때 서버에 이 차의 연결이 아직 있는지 묻고 판정한다(운전자 교체·폰에서 해제를 차가 알아채는 경로).
 * 서버가 확인해 준 연결([paired]이고 [pairedByServer])일 때만 묻는다. **서버가 이 차를 알고(200) 자리가 0개라고 답했을 때만** [PairingVerdict.RELEASED]다.
 * 서버가 이 차를 모르면(404, 서버 재시작·TTL 삭제)·네트워크 실패·5xx·타임아웃·이상한 응답은 [PairingVerdict.UNKNOWN]이라 해제로 보지 않는다.
 */
object PairingVerifier {
    fun verify(client: PairingClient, carId: String, paired: Boolean, pairedByServer: Boolean): PairingVerdict {
        if (!paired || !pairedByServer) return PairingVerdict.SKIPPED
        val status = try {
            client.status(carId)
        } catch (e: Exception) {
            return PairingVerdict.UNKNOWN
        }
        return when {
            !status.known -> PairingVerdict.UNKNOWN
            status.paired -> PairingVerdict.STILL_PAIRED
            else -> PairingVerdict.RELEASED
        }
    }
}

/**
 * debug 신호(`paired=true|false`)로 연결 상태를 바꿀 때의 저장 규칙. 구현은 [com.chagok.car.runtime.ChagokStore].
 * 단위 테스트에서 안드로이드 없이 확인하려고 분리했다.
 */
interface PairingFlags {
    var paired: Boolean

    /** 지금 연결이 서버가 확인해 준 연결인가(폰이 코드를 보내 서버 상태가 paired가 됐을 때만 true). */
    var pairedByServer: Boolean
}

object PairingFlagRules {
    /**
     * debug 신호로 연결 상태를 [paired]로 맞춘다. 디버그로 맞춘 연결은 서버가 모르므로 **언제나** 서버가 확인한 연결이 아니다
     * (이미 연결된 상태에서 `paired=true`를 다시 넣어도 `pairedByServer`는 false가 된다 — 안 그러면 서버를 바꿔 돌릴 때 재진입 확인이 해제로 본다).
     * @return 연결 상태가 실제로 바뀌었는가(같은 값이면 false라 이벤트를 넣지 않는다).
     */
    fun setByDebug(flags: PairingFlags, paired: Boolean): Boolean {
        flags.pairedByServer = false
        if (flags.paired == paired) return false
        flags.paired = paired
        return true
    }
}

/**
 * 차–폰 연결 서버 호출. 차는 설치 때 만든 익명 차 id로 코드를 받아 보이고, 폰이 그 코드를 보내면 연결된다.
 * 호출은 메인 스레드가 아닌 곳에서 하고, 실패하면 예외를 던진다.
 */
interface PairingClient {
    fun issue(carId: String): PairingCode
    fun status(carId: String): PairingStatus

    /** 서버에서도 연결을 푼다(데모 초기화). */
    fun unpair(carId: String)
}

/** `POST /pairing/codes`, `GET`·`DELETE /pairing/cars/{carId}`를 HttpURLConnection으로 부른다(연결·읽기 각 3초). */
class HttpPairingClient(private val baseUrl: String) : PairingClient {
    override fun issue(carId: String): PairingCode {
        val body = JSONObject().put("carId", carId).toString()
        val json = JSONObject(request("POST", "/pairing/codes", body)!!)
        return PairingCode(json.getString("code"), json.getString("qr"), Instant.parse(json.getString("expiresAt")))
    }

    override fun status(carId: String): PairingStatus {
        // 404는 서버가 이 차를 모른다는 뜻이다(서버 재시작·TTL 삭제). 해제가 아니라 known=false로 알린다.
        val body = request("GET", carPath(carId), null, notFoundIsNull = true) ?: return PairingStatus(paired = false, codeActive = false, known = false)
        val json = JSONObject(body)
        return PairingStatus(json.getBoolean("paired"), json.optBoolean("codeActive", false))
    }

    override fun unpair(carId: String) {
        request("DELETE", carPath(carId), null)
    }

    private fun carPath(carId: String) = "/pairing/cars/${URLEncoder.encode(carId, "UTF-8")}"

    private fun request(method: String, path: String, body: String?, notFoundIsNull: Boolean = false): String? {
        val connection = URI.create(baseUrl.trimEnd('/') + path).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = TIMEOUT_MILLIS
            connection.readTimeout = TIMEOUT_MILLIS
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("content-type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (notFoundIsNull && status == HttpURLConnection.HTTP_NOT_FOUND) return null
            if (status != HttpURLConnection.HTTP_OK) throw IOException("연결 $method $path $status")
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MILLIS = 3_000
    }
}
