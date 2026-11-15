package com.chagok.car.flow

import com.chagok.car.domain.EnergyOptions
import com.chagok.car.domain.EnergyRequest
import com.chagok.car.domain.EnergyStop
import com.chagok.car.domain.EnergyStopKind
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Rules
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.time.format.DateTimeFormatter
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference

/** 서버 `POST /energy/options` 응답 본문(JSON)을 받아 온다. 실패하면 예외를 던진다. 호출은 메인 스레드가 아닌 곳에서 한다. */
fun interface EnergyOptionsFetcher {
    fun fetch(request: EnergyRequest): String
}

/** 서버가 200이 아닌 상태로 답했다. 429면 [retryAfterSeconds]에 `Retry-After`가 있다(없으면 null). 본문은 담지 않는다. */
class EnergyHttpException(val status: Int, val retryAfterSeconds: Long? = null) : IOException("에너지 응답 $status")

/**
 * `POST {baseUrl}/energy/options`를 HttpURLConnection으로 부른다. 인증 헤더는 없다(`docs/energy.md`: 에너지 라우트는 아직 토큰으로 막지 않는다).
 * 연결·읽기에 각각 [Rules.ENERGY_ANSWER_TIMEOUT]를 두고 요청 전체에도 같은 데드라인을 둔다. 넘으면 연결을 끊고 [IOException]으로 끝난다
 * (DNS 조회 중인 스레드는 취소할 수 없어 운영체제 제한 시간까지 데몬 스레드로 남을 수 있다. 결과는 버려진다).
 */
class HttpEnergyFetcher(private val baseUrl: String) : EnergyOptionsFetcher {
    override fun fetch(request: EnergyRequest): String {
        val connection = AtomicReference<HttpURLConnection?>()
        val task = FutureTask { call(request, connection) }
        Thread(task, "energy-http").apply { isDaemon = true }.start()
        try {
            return task.get(Rules.ENERGY_ANSWER_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            task.cancel(true)
            connection.get()?.disconnect()
            throw IOException("에너지 후보 받기 데드라인 초과")
        } catch (e: ExecutionException) {
            throw e.cause ?: e
        }
    }

    private fun call(request: EnergyRequest, holder: AtomicReference<HttpURLConnection?>): String {
        val connection = URI.create(baseUrl.trimEnd('/') + "/energy/options").toURL().openConnection() as HttpURLConnection
        holder.set(connection)
        try {
            val timeout = Rules.ENERGY_ANSWER_TIMEOUT.toMillis().toInt()
            connection.requestMethod = "POST"
            connection.connectTimeout = timeout
            connection.readTimeout = timeout
            connection.doOutput = true
            connection.setRequestProperty("content-type", "application/json")
            connection.outputStream.use { it.write(EnergyWire.body(request).toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) {
                throw EnergyHttpException(status, connection.getHeaderField("Retry-After")?.trim()?.toLongOrNull())
            }
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }
}

/** 서버 요청·응답의 JSON 모양(`docs/energy.md`). */
object EnergyWire {
    /** 요청 본문. 전기차만 `stayMinutes`를 싣는다(서버 규칙은 전기차에만 쓴다). `at`은 초까지 있는 오프셋 ISO8601이다. */
    fun body(request: EnergyRequest): String {
        val json = JSONObject()
            .put("fuel", request.fuel.server)
            .put("origin", point(request.origin))
            .put("destination", point(request.destination))
            .put("at", DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(request.at))
        request.stay?.let { json.put("stayMinutes", it.toMinutes().coerceIn(0, MAX_STAY_MINUTES)) }
        return json.toString()
    }

    private fun point(p: LatLng) = JSONObject().put("lat", p.lat).put("lng", p.lng)

    /**
     * 응답 본문을 읽는다. 모양이 틀리면 예외를 던진다(호출한 쪽이 실패로 다룬다).
     * `source`가 `unavailable`이면 후보가 비어 있다(조회 실패이지 후보가 없다는 뜻이 아니다). 모르는 후보 종류는 건너뛴다.
     */
    fun parse(body: String): EnergyOptions {
        val json = JSONObject(body)
        val candidates = json.getJSONArray("candidates")
        val stops = buildList {
            for (i in 0 until candidates.length()) {
                val c = candidates.getJSONObject(i)
                val kind = when (c.getString("kind")) {
                    "slow_charger" -> EnergyStopKind.SLOW_CHARGER
                    "fast_charger" -> EnergyStopKind.FAST_CHARGER
                    "gas_station" -> EnergyStopKind.GAS_STATION
                    else -> continue
                }
                val charger = c.optJSONObject("charger")
                val price = c.optJSONObject("price")
                add(
                    EnergyStop(
                        id = c.getString("id"),
                        kind = kind,
                        place = Place(c.getString("name"), LatLng(c.getDouble("lat"), c.getDouble("lng"))),
                        availableCount = charger?.optIntOrNull("availableCount"),
                        totalCount = charger?.optIntOrNull("totalCount"),
                        powerKw = charger?.optIntOrNull("powerKw"),
                        priceWon = price?.optIntOrNull("won"),
                        priceFuel = price?.optString("fuel")?.takeIf { it.isNotEmpty() },
                    ),
                )
            }
        }
        return EnergyOptions(
            stops = stops,
            mealBundle = json.optBoolean("mealBundle", false),
            stale = json.optBoolean("stale", false),
            partial = json.optBoolean("partial", false),
        )
    }

    private fun JSONObject.optIntOrNull(name: String): Int? =
        if (!has(name) || isNull(name)) null else runCatching { getDouble(name).toInt() }.getOrNull()

    private const val MAX_STAY_MINUTES = 10_080L
}
