package com.chagok.car.flow

import com.chagok.car.domain.EnergyKind
import com.chagok.car.domain.EnergyRequest
import com.chagok.car.domain.EnergyStopKind
import com.chagok.car.domain.LatLng
import com.chagok.car.runtime.EnergyRequester
import java.time.Duration
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.util.concurrent.Executor
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 서버 `POST /energy/options`의 요청 본문·응답 읽기와 요청 실행(실패·429). 계약은 docs/energy.md. */
class EnergyClientTest {
    private val request = EnergyRequest(
        fuel = EnergyKind.EV,
        origin = LatLng(35.1595, 126.8526),
        destination = LatLng(35.1681, 126.8888),
        stay = Duration.ofMinutes(180),
        at = ZonedDateTime.of(2026, 11, 6, 12, 0, 0, 0, ZoneOffset.ofHours(9)),
    )

    private val evBody = """
        {"fuel":"ev","source":"fixture","stage":"destination","mealBundle":false,"partial":false,"stale":true,"asOf":"2026-11-06T02:55:00.000Z",
         "candidates":[
          {"id":"EX-GJ-001","kind":"slow_charger","name":"예시 챔필 주차장 충전소","address":"가상시","lat":35.1692,"lng":126.887,"detourMeters":204,"routeProgress":null,
           "charger":{"stationName":"예시 챔필 주차장 충전소","status":"available","availableCount":2,"totalCount":3,"powerKw":7,"parkingFree":true},"price":null,"brand":null,"hasFood":null},
          {"id":"EX-X","kind":"fast_charger","name":"예시 백양 휴게소","address":null,"lat":35.4,"lng":126.866,"detourMeters":100,"routeProgress":0.2,
           "charger":{"status":"busy","availableCount":0,"totalCount":2,"powerKw":null,"parkingFree":null},"price":null,"brand":null,"hasFood":true},
          {"id":"EX-Y","kind":"teleporter","name":"모르는 종류","lat":1,"lng":2}
         ]}
    """.trimIndent()

    @Test fun `요청 본문은 fuel origin destination stayMinutes at을 싣는다`() {
        val json = JSONObject(EnergyWire.body(request))
        assertEquals("ev", json.getString("fuel"))
        assertEquals(35.1595, json.getJSONObject("origin").getDouble("lat"), 0.0)
        assertEquals(126.8888, json.getJSONObject("destination").getDouble("lng"), 0.0)
        assertEquals(180, json.getInt("stayMinutes"))
        // 초까지 있는 오프셋 ISO8601(서버가 요구)
        assertEquals("2026-11-06T12:00:00+09:00", json.getString("at"))
    }

    @Test fun `머무는 시간을 모르면 stayMinutes를 싣지 않는다`() {
        val json = JSONObject(EnergyWire.body(request.copy(fuel = EnergyKind.GASOLINE, stay = null)))
        assertEquals("gasoline", json.getString("fuel"))
        assertFalse(json.has("stayMinutes"))
    }

    @Test fun `응답에서 후보와 충전기 상태를 읽고 모르는 종류는 건너뛴다`() {
        val options = EnergyWire.parse(evBody)
        assertEquals(2, options.stops.size)
        assertTrue(options.stale)
        assertFalse(options.mealBundle)
        val first = options.stops[0]
        assertEquals("EX-GJ-001", first.id)
        assertEquals(EnergyStopKind.SLOW_CHARGER, first.kind)
        assertEquals("예시 챔필 주차장 충전소", first.place.name)
        assertEquals(LatLng(35.1692, 126.887), first.place.position)
        assertEquals(2, first.availableCount)
        assertEquals(3, first.totalCount)
        assertEquals(7, first.powerKw)
        val second = options.stops[1]
        assertEquals(EnergyStopKind.FAST_CHARGER, second.kind)
        assertEquals(0, second.availableCount)
        assertNull(second.powerKw)
    }

    @Test fun `주유소 후보의 가격을 읽는다`() {
        val body = """{"fuel":"gasoline","source":"fixture","stage":"route","mealBundle":false,"partial":true,"stale":false,"asOf":null,
            "candidates":[{"id":"EX-FS-002","kind":"gas_station","name":"예시 서구 알뜰주유소","address":null,"lat":35.165,"lng":126.87,"detourMeters":50,"routeProgress":0.4,
            "charger":null,"price":{"fuel":"gasoline","won":1639},"brand":"RTE","hasFood":null}]}"""
        val options = EnergyWire.parse(body)
        val stop = options.stops.single()
        assertEquals(EnergyStopKind.GAS_STATION, stop.kind)
        assertEquals(1639, stop.priceWon)
        assertEquals("gasoline", stop.priceFuel)
        assertTrue(options.partial)
    }

    @Test fun `unavailable 응답은 후보가 비어 있다`() {
        val options = EnergyWire.parse("""{"fuel":"ev","source":"unavailable","stage":"none","mealBundle":false,"partial":false,"stale":false,"asOf":null,"candidates":[]}""")
        assertTrue(options.stops.isEmpty())
    }

    private class Inline : Executor {
        override fun execute(command: Runnable) = command.run()
    }

    @Test fun `요청 실행은 답을 요청 번호로 한 번 알린다`() {
        val posted = mutableListOf<Event>()
        EnergyRequester({ evBody }, { posted += it }, Inline()).request(7, request)
        val result = posted.single() as Event.EnergyOptionsResult
        assertEquals(7, result.requestId)
        assertEquals(2, result.options!!.stops.size)
    }

    @Test fun `연결 실패와 잘못된 응답은 null로 알린다`() {
        val posted = mutableListOf<Event>()
        EnergyRequester({ throw java.io.IOException("끊김") }, { posted += it }, Inline()).request(1, request)
        EnergyRequester({ "이건 JSON이 아님" }, { posted += it }, Inline()).request(2, request)
        EnergyRequester({ throw EnergyHttpException(500) }, { posted += it }, Inline()).request(3, request)
        assertEquals(listOf(1, 2, 3), posted.map { (it as Event.EnergyOptionsResult).requestId })
        assertTrue(posted.all { (it as Event.EnergyOptionsResult).options == null })
    }

    @Test fun `429를 받으면 Retry-After가 지나기 전에는 서버를 다시 부르지 않는다`() {
        val posted = mutableListOf<Event>()
        var now = 1_000_000L
        var calls = 0
        val requester = EnergyRequester(
            { calls++; if (calls == 1) throw EnergyHttpException(429, retryAfterSeconds = 30) else evBody },
            { posted += it },
            Inline(),
            nowMillis = { now },
        )
        requester.request(1, request)
        assertNull((posted.last() as Event.EnergyOptionsResult).options)
        now += 10_000
        requester.request(2, request)
        assertEquals("쉬는 동안은 서버를 부르지 않는다", 1, calls)
        assertNull((posted.last() as Event.EnergyOptionsResult).options)
        now += 21_000
        requester.request(3, request)
        assertEquals(2, calls)
        assertEquals(2, (posted.last() as Event.EnergyOptionsResult).options!!.stops.size)
    }

    @Test fun `Retry-After가 없는 429는 60초 쉰다`() {
        val posted = mutableListOf<Event>()
        var now = 0L
        var calls = 0
        val requester = EnergyRequester({ calls++; throw EnergyHttpException(429) }, { posted += it }, Inline(), nowMillis = { now })
        requester.request(1, request)
        now += 59_000
        requester.request(2, request)
        assertEquals(1, calls)
        now += 2_000
        requester.request(3, request)
        assertEquals(2, calls)
    }
}
