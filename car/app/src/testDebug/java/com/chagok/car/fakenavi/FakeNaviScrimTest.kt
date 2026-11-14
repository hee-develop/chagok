package com.chagok.car.fakenavi

import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.flow.Phrases
import com.chagok.car.ui.CardContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 가짜 내비 지도 덮개: 카드가 떠 있으면 검정 50%, 하차 카드(도착 · 내리기 전)일 때만 72%. */
class FakeNaviScrimTest {
    private val baseScrim = 0x80000000.toInt() // main/res/values/colors.xml의 scrim(검정 50%)

    @Test fun `하차 카드가 아니면 기본 덮개 색 그대로`() {
        assertEquals(baseScrim, FakeNaviScrim.color(baseScrim, exit = false))
    }

    @Test fun `하차 카드면 색은 그대로 두고 알파만 72퍼센트`() {
        val color = FakeNaviScrim.color(baseScrim, exit = true)
        assertEquals(0xB8, color ushr 24)
        assertEquals(0x000000, color and 0x00FFFFFF)
        // 0.72 × 255 = 183.6 → 184. 반올림 오차 한 칸 안이어야 한다.
        assertEquals(0.72, (color ushr 24) / 255.0, 0.005)
    }

    @Test fun `덮개 색의 RGB는 기본 색을 따른다`() {
        val color = FakeNaviScrim.color(0x80102030.toInt(), exit = true)
        assertEquals(0x102030, color and 0x00FFFFFF)
    }

    @Test fun `하차 카드 판별은 상태 칩 문구로 한다`() {
        val schedule = Schedule(
            id = "s1", title = "육전집 점심", start = java.time.Instant.parse("2026-12-03T04:00:00Z"), end = java.time.Instant.parse("2026-12-03T05:00:00Z"),
        )
        assertTrue(FakeNaviScrim.isExitCard(Phrases.exitCard(schedule, Rules.EXIT_CARD)))
        assertFalse(FakeNaviScrim.isExitCard(CardContent(status = "정차 중 · 출발 전", voice = "다음은 5시 KIA 직관이에요.")))
        assertFalse(FakeNaviScrim.isExitCard(null))
    }

    @Test fun `집 하차 카드도 같은 상태 칩이라 덮개가 72퍼센트다`() {
        // 인사 카드(물건 없음)와 챙길 물건 카드 모두 하차 카드 전체에 같은 덮개를 쓴다(시안 Arrive).
        val pickup = Schedule(
            id = "k", title = "콩물 픽업", start = java.time.Instant.parse("2026-12-03T04:00:00Z"), end = java.time.Instant.parse("2026-12-03T05:00:00Z"),
        )
        val greeting = Phrases.homeExitCard(emptyList(), Rules.EXIT_CARD)
        val items = Phrases.homeExitCard(listOf(com.chagok.car.domain.PickupItem("콩물", pickup)), Rules.EXIT_CARD)
        assertEquals(Phrases.HOME_GREETING, greeting.voice)
        assertEquals("콩물 챙기세요!", items.voice)
        assertTrue(FakeNaviScrim.isExitCard(greeting))
        assertTrue(FakeNaviScrim.isExitCard(items))
    }
}
