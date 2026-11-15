package com.chagok.car

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.EnergyKind
import com.chagok.car.domain.EnergyRequest
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.flow.Effect
import com.chagok.car.flow.Event
import com.chagok.car.flow.Phrases
import com.chagok.car.flow.Snapshot
import com.chagok.car.ui.CardContent
import com.chagok.car.ui.TileView
import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class FlowLogTest {
    private val day = LocalDate.of(2026, 11, 6)

    @Before fun setUp() = FlowLog.resetForTest()

    private fun save(statuses: Map<String, ScheduleStatus>) = Effect.Save(Snapshot(BoardingLog(), statuses, day))

    @Test fun `카드는 칩 voice sub 버튼을 한 줄로 적는다`() {
        val card = CardContent(
            status = "정차 중 · 출발 전",
            voice = "광주 직관 날이에요!\n1시 육전집 점심까지 3시간 40분이에요.",
            sub = "출발할까요?",
            primary = "응, 출발",
            secondary = "잠깐만",
        )
        assertEquals(
            "카드 칩=정차 중 · 출발 전 | voice=광주 직관 날이에요! / 1시 육전집 점심까지 3시간 40분이에요. | sub=출발할까요? | 버튼=응, 출발/잠깐만",
            FlowLog.lineOf(Effect.ShowCard(card)),
        )
    }

    @Test fun `에너지 제안 카드는 후보 타일과 배터리 타일 내용도 적는다`() {
        val card = CardContent(
            status = "정차 중 · 출발 전",
            voice = "다음은 5시 KIA 직관이에요.",
            sub = "챔필에서 걸어서 5분 거리에 빈 완속 충전기가 있어요. 경기 보는 동안 충전할까요?",
            tiles = listOf(
                TileView.EnergyStop("챔필 옆 충전소", "지금 비어 있음", "완속 2대", "경기장까지 걸어서 5분", "충전기 현황 · 환경부 충전소 정보"),
                TileView.EnergyLevel("배터리", "45%", "· 갈 수 있는 거리 150km", "집까지 300km라 한 번 충전이 필요해요"),
            ),
            primary = "응, 거기로",
            secondary = "그냥 챔필로",
        )
        assertEquals(
            "카드 칩=정차 중 · 출발 전 | voice=다음은 5시 KIA 직관이에요. | sub=챔필에서 걸어서 5분 거리에 빈 완속 충전기가 있어요. 경기 보는 동안 충전할까요? | " +
                "타일=[충전소 챔필 옆 충전소 · 지금 비어 있음 · 완속 2대 · 경기장까지 걸어서 5분 · 충전기 현황 · 환경부 충전소 정보] [배터리 45% · 갈 수 있는 거리 150km / 집까지 300km라 한 번 충전이 필요해요] | 버튼=응, 거기로/그냥 챔필로",
            FlowLog.lineOf(Effect.ShowCard(card)),
        )
    }

    @Test fun `하차 카드는 칩 문구와 챙길 것과 버튼을 한 줄로 적는다`() {
        val schedule = Schedule(
            id = "lunch", title = "육전집 점심",
            start = Instant.parse("2026-11-06T04:00:00Z"), end = Instant.parse("2026-11-06T05:00:00Z"),
            memo = "유니폼·응원봉·티켓",
        )
        val line = FlowLog.lineOf(Effect.ShowCard(Phrases.exitCard(schedule)))!!
        // scripts/demo-car.sh의 '정차(P): 하차 카드' 단계가 이 문구를 읽는다.
        assertTrue(line, line.startsWith("카드 칩=도착 · 내리기 전 | voice=유니폼·응원봉·티켓 챙기세요!"))
        assertTrue(line, line.contains("각주=‘육전집 점심’ 일정 메모: 유니폼·응원봉·티켓"))
        assertTrue(line, line.endsWith("버튼=챙겼어요"))
    }

    @Test fun `결과 한 줄과 말하기와 길안내 요청`() {
        assertEquals("결과 한 줄: 길안내를 시작할게요.", FlowLog.lineOf(Effect.ShowResult("길안내를 시작할게요.")))
        assertEquals("결과 한 줄 지움", FlowLog.lineOf(Effect.ShowResult("")))
        assertEquals("말함: 갈까요? (듣기)", FlowLog.lineOf(Effect.Speak("갈까요?", thenListen = true)))
        assertEquals("말함: 길안내를 시작할게요.", FlowLog.lineOf(Effect.Speak("길안내를 시작할게요.", thenListen = false)))
        assertEquals("길안내 요청: 광주 육전집", FlowLog.lineOf(Effect.StartRoute(Place("광주 육전집", LatLng(0.0, 0.0)))))
        assertNull(FlowLog.lineOf(Effect.StopVoice))
    }

    @Test fun `다음 일정 칩 표시와 숨김을 적는다`() {
        assertEquals("다음 일정 칩: 13:00 육전집 점심", FlowLog.lineOf(Effect.ShowNextChip("13:00 육전집 점심")))
        assertEquals("다음 일정 칩 숨김", FlowLog.lineOf(Effect.ShowNextChip("")))
    }

    @Test fun `저장은 첫 줄을 기준으로만 삼고 이후 바뀐 것만 적는다`() {
        // 프로세스 시작 뒤 첫 Save(복원된 상태)는 기준이라 적지 않는다
        assertNull(FlowLog.lineOf(save(mapOf("x" to ScheduleStatus.ARRIVED))))
        assertEquals("저장: x 도착→예정", FlowLog.lineOf(save(emptyMap())))
        assertEquals("저장: gwangju-lunch 예정→도착", FlowLog.lineOf(save(mapOf("gwangju-lunch" to ScheduleStatus.ARRIVED))))
        // 바뀐 것이 없으면 적지 않는다
        assertNull(FlowLog.lineOf(save(mapOf("gwangju-lunch" to ScheduleStatus.ARRIVED))))
    }

    @Test fun `초기화 중 저장 줄에는 초기화를 표시한다`() {
        FlowLog.lineOf(save(mapOf("gwangju-lunch" to ScheduleStatus.ARRIVED)))
        // record는 Log를 부르므로 표시 여부는 저장 줄 생성만 확인한다
        val field = FlowLog::class.java.getDeclaredField("resetting").apply { isAccessible = true }
        field.setBoolean(FlowLog, true)
        val line = try {
            FlowLog.lineOf(save(emptyMap()))
        } finally {
            field.setBoolean(FlowLog, false)
        }
        assertEquals("저장(초기화): gwangju-lunch 도착→예정", line)
    }

    @Test fun `이벤트 줄은 이름만 적고 연결 번호와 QR은 남기지 않는다`() {
        assertEquals("DestinationArrived", FlowLog.describe(Event.DestinationArrived))
        assertEquals("GearChanged(gear=PARK)", FlowLog.describe(Event.GearChanged(com.chagok.car.domain.Gear.PARK)))
        val issued = FlowLog.describe(Event.PairingCodeIssued("123456", "chagok://pair/secret"))
        assertEquals("PairingCodeIssued", issued)
        assertFalse(issued.contains("123456"))
    }

    @Test fun `들은 말은 원문 없이 길이만 적는다`() {
        assertEquals("Heard(len=4)", FlowLog.describe(Event.Heard("응 갈게")))
        assertEquals("Heard(len=0)", FlowLog.describe(Event.Heard("")))
        assertFalse(FlowLog.describe(Event.Heard("비밀 장소")).contains("비밀"))
    }

    @Test fun `에너지 판단은 필요 거리와 가능 거리와 결과를 한 줄로 적는다`() {
        assertEquals("에너지: 필요 312km, 가능 180km → 모자람", FlowLog.lineOf(Effect.EnergyJudged(312.4, 180.0, short = true)))
        assertEquals("에너지: 필요 40km, 가능 500km → 넉넉함", FlowLog.lineOf(Effect.EnergyJudged(40.0, 500.0, short = false)))
    }

    @Test fun `에너지 후보 요청과 경유 길안내 요청도 한 줄로 적는다`() {
        val request = EnergyRequest(
            EnergyKind.EV, LatLng(35.15, 126.91), LatLng(35.16, 126.88), null,
            java.time.ZonedDateTime.of(2026, 11, 6, 12, 0, 0, 0, java.time.ZoneOffset.ofHours(9)),
        )
        assertEquals("에너지 후보 요청: ev", FlowLog.lineOf(Effect.RequestEnergyOptions(3, request)))
        val place = Place("광주 육전집", LatLng(35.1595, 126.8526))
        assertEquals("길안내 요청: 광주 육전집", FlowLog.lineOf(Effect.StartRoute(place)))
        assertEquals("길안내 요청: 광주 육전집 (경유 예시 충전소)", FlowLog.lineOf(Effect.StartRoute(place, Place("예시 충전소", LatLng(35.17, 126.89)))))
    }
}
