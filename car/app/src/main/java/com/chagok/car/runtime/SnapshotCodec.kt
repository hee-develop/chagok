package com.chagok.car.runtime

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.flow.Snapshot
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate

/** [Snapshot]을 JSON 문자열로 바꾸고 되돌린다. 일정 ID에 `,`나 `:`가 있어도 깨지지 않는다. */
object SnapshotCodec {
    fun encode(snapshot: Snapshot): String {
        val statuses = JSONObject()
        snapshot.statuses.forEach { (id, status) -> statuses.put(id, status.name) }
        val log = JSONObject().apply {
            put("lastBoardedOn", snapshot.log.lastBoardedOn?.toString() ?: JSONObject.NULL)
            put("lastParkedAt", snapshot.log.lastParkedAt?.toEpochMilli() ?: JSONObject.NULL)
            put("parkedAfterDriveSinceBoarding", snapshot.log.parkedAfterDriveSinceBoarding)
        }
        return JSONObject()
            .put("date", snapshot.date.toString())
            .put("statuses", statuses)
            .put("log", log)
            .put("noticeDate", snapshot.noticeDate?.toString() ?: JSONObject.NULL)
            .put("exitTargetId", snapshot.exitTargetId ?: JSONObject.NULL)
            .put("exitArrivedAt", snapshot.exitArrivedAt?.toEpochMilli() ?: JSONObject.NULL)
            .put("homeItemsAnnounced", JSONArray(snapshot.homeItemsAnnounced.sorted()))
            .put("homeCardShown", snapshot.homeCardShown)
            .toString()
    }

    /** 깨졌거나 알 수 없는 형식이면 null. */
    fun decode(text: String): Snapshot? = runCatching {
        val root = JSONObject(text)
        val date = LocalDate.parse(root.getString("date"))
        val statusJson = root.getJSONObject("statuses")
        val statuses = buildMap {
            statusJson.keys().forEach { id ->
                runCatching { ScheduleStatus.valueOf(statusJson.getString(id)) }.getOrNull()?.let { put(id, it) }
            }
        }
        val logJson = root.getJSONObject("log")
        val log = BoardingLog(
            lastBoardedOn = if (logJson.isNull("lastBoardedOn")) null else LocalDate.parse(logJson.getString("lastBoardedOn")),
            lastParkedAt = if (logJson.isNull("lastParkedAt")) null else Instant.ofEpochMilli(logJson.getLong("lastParkedAt")),
            parkedAfterDriveSinceBoarding = logJson.optBoolean("parkedAfterDriveSinceBoarding", false),
        )
        val noticeDate = if (root.isNull("noticeDate")) null else LocalDate.parse(root.getString("noticeDate"))
        // 하차 카드 대기는 나중에 생긴 칸이라 이전 저장분에는 없다(없으면 null).
        // 이 칸만 손상돼도(타입이 다르거나 한쪽만 있음) 탑승 기록·일정 상태는 살리고 하차 대기만 버린다.
        // 문자열 타입일 때만 받는다(getString은 숫자도 문자열로 바꿔 주므로 쓰지 않는다).
        val exitTargetId = root.opt("exitTargetId") as? String
        val exitArrivedAt = runCatching { if (root.isNull("exitArrivedAt")) null else Instant.ofEpochMilli(root.getLong("exitArrivedAt")) }.getOrNull()
        // 집 하차 알림 기록도 나중에 생긴 칸이라 이전 저장분에는 없다(없으면 빈 집합·false). 이 칸이 손상돼도 나머지는 살린다.
        val announced = runCatching {
            root.optJSONArray("homeItemsAnnounced")?.let { array -> (0 until array.length()).map(array::getString).toSet() }.orEmpty()
        }.getOrDefault(emptySet())
        val cardShown = root.opt("homeCardShown") as? Boolean ?: false
        Snapshot(log, statuses, date, noticeDate, exitTargetId, exitArrivedAt, announced, cardShown)
    }.getOrNull()
}
