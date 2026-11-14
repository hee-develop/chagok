package com.chagok.car

import com.chagok.car.ui.CardAlign
import org.junit.Assert.assertEquals
import org.junit.Test

/** 디버그 스텁: 가짜 내비가 켜져 있을 때만 카드 열이 왼쪽 위(시안)다. 릴리스 스텁은 늘 [CardAlign.CENTER]다. */
class FakeNaviAlignTest {
    @Test fun `켜져 있으면 왼쪽 위 꺼져 있으면 가운데`() {
        assertEquals(CardAlign.START, FakeNavi.alignFor(true))
        assertEquals(CardAlign.CENTER, FakeNavi.alignFor(false))
    }
}
