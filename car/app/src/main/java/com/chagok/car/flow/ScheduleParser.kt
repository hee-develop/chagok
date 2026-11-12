package com.chagok.car.flow

import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** 오늘 일정 응답 하나: 일정과 자주 가는 곳. */
data class DayResponse(val schedules: List<Schedule>, val favorites: List<Favorite> = emptyList())

/** 서버 `GET /schedules/today` 응답 본문을 읽는다. 형식이 어긋나면 예외를 던진다. */
object ScheduleParser {
    fun parse(body: String): List<Schedule> = parseDay(body).schedules

    /** favorites가 없는 본문(기능 전에 저장한 사본)은 자주 가는 곳이 없는 것으로 읽는다. */
    fun parseDay(body: String): DayResponse {
        val json = JSONObject(body)
        val items = json.getJSONArray("schedules")
        val favorites = json.optJSONArray("favorites")
        return DayResponse(
            schedules = List(items.length()) { parseSchedule(items.getJSONObject(it)) },
            favorites = favorites?.let { array -> List(array.length()) { parseFavorite(array.getJSONObject(it)) } }.orEmpty(),
        )
    }

    /** 모르는 kind는 집·회사가 아닌 자주 가는 곳으로 본다. */
    private fun parseFavorite(json: JSONObject) = Favorite(
        kind = when (json.getString("kind")) {
            "home" -> FavoriteKind.HOME
            "work" -> FavoriteKind.WORK
            else -> FavoriteKind.OTHER
        },
        place = parsePlace(json),
        address = json.optStringOrNull("address"),
    )

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
