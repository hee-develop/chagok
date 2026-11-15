package com.chagok.car.runtime

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.PendingReask
import com.chagok.car.domain.ReaskKind
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
        )
        assertEquals(snapshot, SnapshotCodec.decode(SnapshotCodec.encode(snapshot)))
    }

    @Test fun `이전 저장분의 안내 날짜 칸은 무시하고 나머지를 복원한다`() {
        val old = """{"date":"2026-12-03","statuses":{},"log":{"lastBoardedOn":null,"lastParkedAt":null,"parkedAfterDriveSinceBoarding":false}}"""
        assertEquals(Snapshot(BoardingLog(), emptyMap(), LocalDate.of(2026, 12, 3)), SnapshotCodec.decode(old))
        // 일정 안내 카드를 없앤 뒤에도 그 전에 저장한 noticeDate 칸이 있어도 깨지지 않는다.
        assertEquals(
            Snapshot(BoardingLog(), emptyMap(), LocalDate.of(2026, 12, 3)),
            SnapshotCodec.decode(old.dropLast(1) + ""","noticeDate":"2026-12-03"}"""),
        )
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

    @Test fun `위치로 정한 하차 대기인지도 저장하고 복원하며 이전 저장분은 false다`() {
        val snapshot = Snapshot(
            BoardingLog(), mapOf("a" to ScheduleStatus.ARRIVED), LocalDate.of(2026, 12, 3),
            exitTargetId = "a", exitArrivedAt = Instant.parse("2026-12-03T01:00:00Z"), exitByLocation = true,
        )
        val decoded = SnapshotCodec.decode(SnapshotCodec.encode(snapshot))
        assertEquals(snapshot, decoded)
        assertEquals(true, decoded?.exitByLocation)

        val old = """{"date":"2026-12-03","statuses":{"a":"ARRIVED"},"log":{"lastBoardedOn":null,"lastParkedAt":null,"parkedAfterDriveSinceBoarding":false},"noticeDate":null,"exitTargetId":"a","exitArrivedAt":5}"""
        val oldDecoded = SnapshotCodec.decode(old)!!
        assertEquals("a", oldDecoded.exitTargetId)
        assertEquals(false, oldDecoded.exitByLocation)

        // 칸이 손상돼도 나머지는 살린다.
        val broken = old.dropLast(1) + ""","exitByLocation":"yes"}"""
        val brokenDecoded = SnapshotCodec.decode(broken)!!
        assertEquals("a", brokenDecoded.exitTargetId)
        assertEquals(false, brokenDecoded.exitByLocation)
    }

    @Test fun `다시 물을 질문도 저장하고 복원하며 이전 저장분은 없음이다`() {
        val withId = Snapshot(BoardingLog(), emptyMap(), LocalDate.of(2026, 12, 3), reask = PendingReask(ReaskKind.DEPART_LATE, "cal:1,2"))
        assertEquals(withId, SnapshotCodec.decode(SnapshotCodec.encode(withId)))
        val noId = Snapshot(BoardingLog(), emptyMap(), LocalDate.of(2026, 12, 3), reask = PendingReask(ReaskKind.ASK_DESTINATION, null))
        assertEquals(noId, SnapshotCodec.decode(SnapshotCodec.encode(noId)))
        assertNull(SnapshotCodec.decode(SnapshotCodec.encode(Snapshot(BoardingLog(), emptyMap(), LocalDate.of(2026, 12, 3))))!!.reask)

        // 이 칸이 생기기 전 저장분
        val old = """{"date":"2026-12-03","statuses":{"a":"ARRIVED"},"log":{"lastBoardedOn":null,"lastParkedAt":null,"parkedAfterDriveSinceBoarding":false},"noticeDate":null,"exitTargetId":"a","exitArrivedAt":5,"exitByLocation":true}"""
        val decoded = SnapshotCodec.decode(old)!!
        assertNull(decoded.reask)
        assertEquals("a", decoded.exitTargetId)
    }

    @Test fun `다시 물을 질문 칸만 손상되거나 모르는 갈래여도 나머지 상태는 살린다`() {
        val base = """"date":"2026-12-03","statuses":{"a":"ARRIVED"},"log":{"lastBoardedOn":"2026-12-03","lastParkedAt":null,"parkedAfterDriveSinceBoarding":true},"exitTargetId":"a","exitArrivedAt":5"""
        for (broken in listOf(
            """"reask":"depart"""",
            """"reask":{"kind":"NO_SUCH_KIND","scheduleId":"a"}""",
            """"reask":{"scheduleId":"a"}""",
            """"reask":[1]""",
        )) {
            val decoded = SnapshotCodec.decode("{$base,$broken}")!!
            assertNull(broken, decoded.reask)
            assertEquals(mapOf("a" to ScheduleStatus.ARRIVED), decoded.statuses)
            assertEquals("a", decoded.exitTargetId)
        }
        // 일정 ID가 문자열도 null도 아니면(숫자·객체) 일정 없는 질문으로 잘못 읽지 않고 칸 전체를 버린다.
        for (badId in listOf("123", "true", """{"a":1}""", "[1]")) {
            assertNull(badId, SnapshotCodec.decode("""{$base,"reask":{"kind":"DEPART","scheduleId":$badId}}""")!!.reask)
        }
        // 일정 ID가 null이거나 없으면 일정 없는 질문(후보 묻기)이다.
        assertEquals(PendingReask(ReaskKind.ASK_DESTINATION, null), SnapshotCodec.decode("""{$base,"reask":{"kind":"ASK_DESTINATION","scheduleId":null}}""")!!.reask)
        assertEquals(PendingReask(ReaskKind.ASK_DESTINATION, null), SnapshotCodec.decode("""{$base,"reask":{"kind":"ASK_DESTINATION"}}""")!!.reask)
    }
}
