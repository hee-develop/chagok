package com.chagok.car.flow

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** 서버 `GET /schedules/today` 응답 본문을 [Schedule] 목록으로 바꾼다. 형식이 어긋나면 예외를 던진다. */
object ScheduleParser {
    fun parse(body: String): List<Schedule> {
        val items = JSONObject(body).getJSONArray("schedules")
        return List(items.length()) { parseSchedule(items.getJSONObject(it)) }
    }

    private fun parseSchedule(json: JSONObject) = Schedule(
        id = json.getString("id"),
        title = json.getString("title"),
        start = Instant.parse(json.getString("start")),
        end = Instant.parse(json.getString("end")),
        allDay = json.getBoolean("allDay"),
        locationText = json.optStringOrNull("locationText"),
        place = if (json.isNull("place")) null else parsePlace(json.getJSONObject("place")),
        memo = json.optStringOrNull("memo"),
        attendees = json.optJSONArray("attendees")?.let { names(it) }.orEmpty(),
    )

    private fun parsePlace(json: JSONObject) =
        Place(json.getString("name"), LatLng(json.getDouble("lat"), json.getDouble("lng")))

    private fun names(array: JSONArray) = List(array.length()) { array.getString(it) }

    private fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key)) null else getString(key)
}
