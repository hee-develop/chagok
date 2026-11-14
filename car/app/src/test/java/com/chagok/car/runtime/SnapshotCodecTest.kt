package com.chagok.car.runtime

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.flow.Snapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class SnapshotCodecTest {
    @Test fun `저장하고 복원하면 같은 상태가 된다`() {
        val snapshot = Snapshot(
            log = BoardingLog(
                lastBoardedOn = LocalDate.of(2026, 12, 3),
                lastParkedAt = Instant.parse("2026-12-03T01:23:45Z"),
                parkedAfterDriveSinceBoarding = true,
            ),
            statuses = mapOf("a" to ScheduleStatus.ARRIVED, "b" to ScheduleStatus.SKIPPED, "c" to ScheduleStatus.LATE),
            date = LocalDate.of(2026, 12, 3),
            noticeDate = LocalDate.of(2026, 12, 3),
        )
        assertEquals(snapshot, SnapshotCodec.decode(SnapshotCodec.encode(snapshot)))
    }

    @Test fun `안내 날짜가 없는 이전 저장분도 복원한다`() {
        val old = """{"date":"2026-12-03","statuses":{},"log":{"lastBoardedOn":null,"lastParkedAt":null,"parkedAfterDriveSinceBoarding":false}}"""
        assertEquals(Snapshot(BoardingLog(), emptyMap(), LocalDate.of(2026, 12, 3), null), SnapshotCodec.decode(old))
    }

    @Test fun `하차 카드 대기도 저장하고 복원한다`() {
        val snapshot = Snapshot(
            BoardingLog(), mapOf("a" to ScheduleStatus.ARRIVED), LocalDate.of(2026, 12, 3),
            exitTargetId = "a", exitArrivedAt = Instant.parse("2026-12-03T01:00:00Z"),
        )
        val decoded = SnapshotCodec.decode(SnapshotCodec.encode(snapshot))
        assertEquals(snapshot, decoded)
        assertEquals("a", decoded?.exitTargetId)
    }

    @Test fun `하차 카드 칸이 없는 이전 저장분은 대기 없음으로 복원한다`() {
        val old = """{"date":"2026-12-03","statuses":{"a":"ARRIVED"},"log":{"lastBoardedOn":null,"lastParkedAt":null,"parkedAfterDriveSinceBoarding":false},"noticeDate":null}"""
        val decoded = SnapshotCodec.decode(old)
        assertNull(decoded?.exitTargetId)
        assertNull(decoded?.exitArrivedAt)
        assertEquals(mapOf("a" to ScheduleStatus.ARRIVED), decoded?.statuses)
    }

    @Test fun `하차 대기 칸이 손상돼도 나머지 상태는 살리고 대기만 버린다`() {
        val base = """"date":"2026-12-03","statuses":{"a":"ARRIVED"},"log":{"lastBoardedOn":"2026-12-03","lastParkedAt":null,"parkedAfterDriveSinceBoarding":true},"noticeDate":null"""
        listOf(
            """{$base,"exitTargetId":123,"exitArrivedAt":"x"}""",
            """{$base,"exitTargetId":"a","exitArrivedAt":"not-a-number"}""",
            """{$base,"exitTargetId":{"k":1},"exitArrivedAt":5}""",
        ).forEach { text ->
            val decoded = SnapshotCodec.decode(text)!!
            assertEquals(mapOf("a" to ScheduleStatus.ARRIVED), decoded.statuses)
            assertEquals(LocalDate.of(2026, 12, 3), decoded.log.lastBoardedOn)
        }
        assertNull(SnapshotCodec.decode("""{$base,"exitTargetId":{"k":1},"exitArrivedAt":5}""")!!.exitTargetId)
        // 숫자·불리언은 문자열로 바꿔 받지 않는다.
        assertNull(SnapshotCodec.decode("""{$base,"exitTargetId":123,"exitArrivedAt":5}""")!!.exitTargetId)
        assertNull(SnapshotCodec.decode("""{$base,"exitTargetId":true,"exitArrivedAt":5}""")!!.exitTargetId)
        assertEquals("a", SnapshotCodec.decode("""{$base,"exitTargetId":"a","exitArrivedAt":5}""")!!.exitTargetId)
    }

    @Test fun `기록이 비어 있어도 왕복한다`() {
        val snapshot = Snapshot(BoardingLog(), emptyMap(), LocalDate.of(2026, 12, 3))
        assertEquals(snapshot, SnapshotCodec.decode(SnapshotCodec.encode(snapshot)))
    }

    @Test fun `일정 ID에 쉼표나 콜론이 있어도 깨지지 않는다`() {
        val snapshot = Snapshot(
            BoardingLog(),
            mapOf("cal:123,456" to ScheduleStatus.ARRIVED, "a\"b\\c" to ScheduleStatus.SKIPPED, "한글:id," to ScheduleStatus.LATE),
            LocalDate.of(2026, 12, 3),
        )
        assertEquals(snapshot, SnapshotCodec.decode(SnapshotCodec.encode(snapshot)))
    }

    @Test fun `깨진 문자열은 null`() {
        assertNull(SnapshotCodec.decode("not json"))
        assertNull(SnapshotCodec.decode("{}"))
        assertNull(SnapshotCodec.decode("""{"date":"2026-12-03"}"""))
    }

    @Test fun `집 하차 알림 기록도 저장하고 복원한다`() {
        val snapshot = Snapshot(
            BoardingLog(), emptyMap(), LocalDate.of(2026, 12, 3),
            homeItemsAnnounced = setOf("k", "a,b:c"), homeCardShown = true,
        )
        assertEquals(snapshot, SnapshotCodec.decode(SnapshotCodec.encode(snapshot)))
    }

    @Test fun `집 하차 알림 기록이 없는 이전 저장분은 빈 기록으로 복원한다`() {
        val old = """{"date":"2026-12-03","statuses":{},"log":{"lastBoardedOn":null,"lastParkedAt":null,"parkedAfterDriveSinceBoarding":false},"exitTargetId":"a","exitArrivedAt":5}"""
        val decoded = SnapshotCodec.decode(old)!!
        assertEquals(emptySet<String>(), decoded.homeItemsAnnounced)
        assertEquals(false, decoded.homeCardShown)
        assertEquals("a", decoded.exitTargetId)
    }

    @Test fun `집 하차 알림 칸만 손상돼도 나머지 상태는 살린다`() {
        val base = """"date":"2026-12-03","statuses":{"a":"ARRIVED"},"log":{"lastBoardedOn":null,"lastParkedAt":null,"parkedAfterDriveSinceBoarding":false}"""
        for (broken in listOf(
            """"homeItemsAnnounced":{"k":1},"homeCardShown":"yes"""",
            """"homeItemsAnnounced":[{"k":1}],"homeCardShown":1""",
            """"homeItemsAnnounced":"k","homeCardShown":null""",
        )) {
            val decoded = SnapshotCodec.decode("{$base,$broken}")!!
            assertEquals(mapOf("a" to ScheduleStatus.ARRIVED), decoded.statuses)
            assertEquals(emptySet<String>(), decoded.homeItemsAnnounced)
            assertEquals(false, decoded.homeCardShown)
        }
    }
}
