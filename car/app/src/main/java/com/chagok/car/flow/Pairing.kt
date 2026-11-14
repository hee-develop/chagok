package com.chagok.car.flow

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.time.Instant

/** 차의 연결 상태. [codeActive]가 false면 서버가 이 차의 코드를 모른다(서버 재시작·만료) — 새 코드를 받아야 한다. */
data class PairingStatus(val paired: Boolean, val codeActive: Boolean)

/** 서버가 낸 연결 코드. [qr]은 차 화면 QR에 담을 글(`chagok://pair?code=…`), [code]는 숫자 6자리다. */
data class PairingCode(val code: String, val qr: String, val expiresAt: Instant)

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
        val json = JSONObject(request("POST", "/pairing/codes", body))
        return PairingCode(json.getString("code"), json.getString("qr"), Instant.parse(json.getString("expiresAt")))
    }

    override fun status(carId: String): PairingStatus {
        val json = JSONObject(request("GET", carPath(carId), null))
        return PairingStatus(json.getBoolean("paired"), json.optBoolean("codeActive", false))
    }

    override fun unpair(carId: String) {
        request("DELETE", carPath(carId), null)
    }

    private fun carPath(carId: String) = "/pairing/cars/${URLEncoder.encode(carId, "UTF-8")}"

    private fun request(method: String, path: String, body: String?): String {
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
