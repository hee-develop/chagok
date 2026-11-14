package com.chagok.car.fakenavi

import com.chagok.car.flow.Phrases
import com.chagok.car.ui.CardContent

/**
 * 가짜 내비 지도 위 덮개(scrim)의 알파 규칙. 카드가 뜨면 기본 덮개(검정 50%)를 깔고,
 * 하차 카드(도착 · 내리기 전)일 때만 시안 Arrive처럼 72%로 더 어둡게 한다. 순수 함수라 JVM 단위 테스트로 확인한다.
 */
object FakeNaviScrim {
    /** 하차 카드 덮개 알파 72%(0.72 × 255 = 183.6 → 184). */
    const val EXIT_ALPHA = 184

    /** 떠 있는 카드가 하차 카드인가. main에는 카드 종류 필드가 없어 상태 칩 문구([Phrases.STATUS_BEFORE_EXIT])로 가른다. */
    fun isExitCard(card: CardContent?): Boolean = card?.status == Phrases.STATUS_BEFORE_EXIT

    /** 덮개 색: 기본 [base]의 색은 그대로 두고 하차 카드일 때만 알파를 [EXIT_ALPHA]로 올린다. */
    fun color(base: Int, exit: Boolean): Int = if (exit) (base and 0x00FFFFFF) or (EXIT_ALPHA shl 24) else base
}
