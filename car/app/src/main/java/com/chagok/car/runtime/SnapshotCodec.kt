package com.chagok.car.runtime

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.PendingReask
import com.chagok.car.domain.ReaskKind
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
            .put("exitTargetId", snapshot.exitTargetId ?: JSONObject.NULL)
            .put("exitArrivedAt", snapshot.exitArrivedAt?.toEpochMilli() ?: JSONObject.NULL)
            .put("homeItemsAnnounced", JSONArray(snapshot.homeItemsAnnounced.sorted()))
            .put("homeCardShown", snapshot.homeCardShown)
            .put("exitByLocation", snapshot.exitByLocation)
            .put("energyOffered", snapshot.energyOffered)
            .put("reask", snapshot.reask?.let { JSONObject().put("kind", it.kind.name).put("scheduleId", it.scheduleId ?: JSONObject.NULL) } ?: JSONObject.NULL)
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
        // 위치로 정한 하차 대기인지도 나중에 생긴 칸이라 없으면 false(내비 도착 대기로 본다).
        val exitByLocation = root.opt("exitByLocation") as? Boolean ?: false
        // 다시 물을 질문도 나중에 생긴 칸이라 없으면 null. 이 칸만 손상됐거나 모르는 갈래면 그 질문만 버린다.
        // scheduleId는 문자열이거나 null(일정 없음·후보 묻기)이어야 한다. 그 밖의 타입이면 일정 없는 질문으로 잘못 읽히지 않게 칸 전체를 버린다.
        val reask = runCatching {
            root.optJSONObject("reask")?.let { json ->
                val scheduleId = when (val raw = json.opt("scheduleId")) {
                    null, JSONObject.NULL -> null
                    is String -> raw
                    else -> error("scheduleId 타입이 문자열이 아님")
                }
                PendingReask(ReaskKind.valueOf(json.getString("kind")), scheduleId)
            }
        }.getOrNull()
        // 에너지 제안을 오늘 이미 띄웠는지도 나중에 생긴 칸이라 없으면 false(타입이 다르면 이 칸만 버린다).
        val energyOffered = root.opt("energyOffered") as? Boolean ?: false
        Snapshot(log, statuses, date, exitTargetId, exitArrivedAt, announced, cardShown, exitByLocation, reask, energyOffered)
    }.getOrNull()
}
