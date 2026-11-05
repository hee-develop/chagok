package com.chagok.car.runtime

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.flow.Snapshot
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
        Snapshot(log, statuses, date, noticeDate)
    }.getOrNull()
}
