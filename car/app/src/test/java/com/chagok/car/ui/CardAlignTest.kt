package com.chagok.car.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class CardAlignTest {
    @Test fun `가운데 정렬은 왼쪽 여백이 없다`() {
        assertEquals(0, CardAlign.CENTER.inset(1682, 841, 25))
        assertEquals(0, CardAlign.CENTER.inset(848, 848, 25))
    }

    @Test fun `가로 창에서 왼쪽 정렬은 시안의 여백만큼 안으로 들어온다`() {
        // Pleos 두 칸 창 1682, 배율 1.05 → 카드 841, 여백 24 × 1.05 ≈ 25
        assertEquals(25, CardAlign.START.inset(1682, 841, 25))
    }

    @Test fun `세로 창에서는 카드가 창 너비와 같아 가운데 정렬과 차이가 없다`() {
        assertEquals(0, CardAlign.START.inset(848, 848, 25))
        assertEquals(0, CardAlign.START.inset(800, 800, 24))
    }

    @Test fun `남는 폭이 여백보다 작으면 남는 폭까지만`() {
        assertEquals(10, CardAlign.START.inset(850, 840, 25))
        // 카드가 창보다 넓게 계산돼도 음수가 되지 않는다
        assertEquals(0, CardAlign.START.inset(800, 810, 25))
    }
}
