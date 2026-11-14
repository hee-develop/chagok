package com.chagok.car

import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 픽스처(fixtures/schedules 아래 JSON)로 서버의 `GET /schedules/today` 응답 본문을 만든다.
 * 서버 라우트와 같은 규칙을 쓴다: 시각 = at + 오프셋(픽스처에 고정 기준 시각 `anchor`가 있으면 at 대신 그 시각), 일정은 저장된 선택이 없을 때의
 * 기본 선택(fixtures/calendars/mock-device.json의 defaultSelected) 캘린더 것만 담는다. 또 anchor와 같은 서울 날짜에 시작하는 일정,
 * 전날 시작해 anchor 시각에 아직 안 끝난 일정만 담는다. 이동 없는 일정(server/src/noTravel.ts)은 핵심 규칙만 따라 뺀다:
 * 장소 칸에 화상 회의 주소·'온라인'·'zoom'·'회의실'이 있으면 차로 가지 않는 일정이다.
 */
object FixtureResponses {
    /** JVM 단위 테스트에서는 테스트 리소스에서 읽는다. 계측 테스트는 assets에서 읽어 직접 넘긴다. */
    fun defaultCalendarsJson(): String =
        checkNotNull(FixtureResponses::class.java.classLoader?.getResourceAsStream("calendars/mock-device.json")) {
            "목 캘린더 픽스처 없음: calendars/mock-device.json"
        }.bufferedReader().use { it.readText() }

    /** @param favorites 서버 favorites와 같은 형식의 자주 가는 곳. 기본은 저장한 곳이 없는 빈 목록 */
    fun response(
        fixtureJson: String,
        anchor: Instant,
        calendarsJson: String = defaultCalendarsJson(),
        favorites: JSONArray = JSONArray(),
    ): String {
        val fixture = JSONObject(fixtureJson)
        @Suppress("NAME_SHADOWING")
        val anchor = fixture.optString("anchor").takeIf { it.isNotEmpty() }
            ?.let { java.time.OffsetDateTime.parse(it).toInstant() } ?: anchor
        val calendars = JSONObject(calendarsJson).getJSONArray("calendars")
        val selected = (0 until calendars.length()).map { calendars.getJSONObject(it) }
            .filter { it.getBoolean("defaultSelected") }.map { it.getString("id") }.toSet()
        val items = fixture.getJSONArray("schedules")
        val schedules = JSONArray()
        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
            if (item.getString("calendarId") !in selected) continue
            if (!isToday(anchor, item.getLong("startOffsetMinutes"), item.getLong("endOffsetMinutes"))) continue
            if (isNoTravel(item.optString("locationText"))) continue
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
                    .put("care", JSONObject.NULL)
                    .put("attendees", item.getJSONArray("attendees")),
            )
        }
        return JSONObject().put("anchor", iso(anchor, 0)).put("schedules", schedules).put("favorites", favorites).toString()
    }

    private val seoul = ZoneId.of("Asia/Seoul")

    private val noTravelPhrases = listOf(
        "zoom.us", "meet.google.com", "teams.microsoft.com", "webex.com", "온라인", "화상회의", "화상 회의", "zoom", "회의실", "meeting room",
    )

    private fun isNoTravel(locationText: String): Boolean = locationText.lowercase().let { text -> noTravelPhrases.any { it in text } }

    private fun isToday(anchor: Instant, startOffsetMinutes: Long, endOffsetMinutes: Long): Boolean {
        val today = anchor.atZone(seoul).toLocalDate()
        val start = anchor + Duration.ofMinutes(startOffsetMinutes)
        val startDate = start.atZone(seoul).toLocalDate()
        return startDate == today || (startDate.isBefore(today) && (anchor + Duration.ofMinutes(endOffsetMinutes)).isAfter(anchor))
    }

    private fun iso(anchor: Instant, offsetMinutes: Long): String =
        DateTimeFormatter.ISO_INSTANT.format(anchor + Duration.ofMinutes(offsetMinutes))
}
