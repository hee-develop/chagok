package com.chagok.car

import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeFormatter

/** 픽스처(fixtures/schedules 아래 JSON)로 서버의 `GET /schedules/today` 응답 본문을 만든다. 서버 라우트와 같은 규칙(시각 = at + 오프셋). */
object FixtureResponses {
    fun response(fixtureJson: String, anchor: Instant): String {
        val fixture = JSONObject(fixtureJson)
        val items = fixture.getJSONArray("schedules")
        val schedules = JSONArray()
        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
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
