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
}
