package com.chagok.car

import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * 픽스처(fixtures/schedules 아래 JSON)로 서버의 `GET /schedules/today` 응답 본문을 만든다.
 * 서버 라우트와 같은 규칙을 쓴다: 시각 = at + 오프셋, 일정은 저장된 선택이 없을 때의 기본 선택(fixtures/calendars/mock-device.json의
 * defaultSelected) 캘린더 것만 담는다.
 */
object FixtureResponses {
    /** JVM 단위 테스트에서는 테스트 리소스에서 읽는다. 계측 테스트는 assets에서 읽어 직접 넘긴다. */
    fun defaultCalendarsJson(): String =
        checkNotNull(FixtureResponses::class.java.classLoader?.getResourceAsStream("calendars/mock-device.json")) {
            "목 캘린더 픽스처 없음: calendars/mock-device.json"
        }.bufferedReader().use { it.readText() }

    fun response(fixtureJson: String, anchor: Instant, calendarsJson: String = defaultCalendarsJson()): String {
        val fixture = JSONObject(fixtureJson)
        val calendars = JSONObject(calendarsJson).getJSONArray("calendars")
        val selected = (0 until calendars.length()).map { calendars.getJSONObject(it) }
            .filter { it.getBoolean("defaultSelected") }.map { it.getString("id") }.toSet()
        val items = fixture.getJSONArray("schedules")
        val schedules = JSONArray()
        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
            if (item.getString("calendarId") !in selected) continue
            schedules.put(
                JSONObject()
                    .put("id", item.getString("id"))
                    .put("title", item.getString("title"))
                    .put("start", iso(anchor, item.getLong("startOffsetMinutes")))
                    .put("end", iso(anchor, item.getLong("endOffsetMinutes")))
                    .put("allDay", item.getBoolean("allDay"))
                    .put("locationText", item.get("locationText"))
                    .put("place", item.get("place"))
                    .put("memo", item.get("memo"))
                    .put("attendees", item.getJSONArray("attendees")),
            )
        }
        return JSONObject().put("anchor", iso(anchor, 0)).put("schedules", schedules).toString()
    }

    private fun iso(anchor: Instant, offsetMinutes: Long): String =
        DateTimeFormatter.ISO_INSTANT.format(anchor + Duration.ofMinutes(offsetMinutes))
}
