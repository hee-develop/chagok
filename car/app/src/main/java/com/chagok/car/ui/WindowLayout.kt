package com.chagok.car.ui

/**
 * 창 크기에서 디자인 배율을 정하는 규칙. 단위는 모두 px(또는 dp)로 같기만 하면 된다.
 *
 * - 세로 창(너비 ≤ 높이, window 한 칸): 배율 = min(창 너비 / 기준 너비, 창 높이 / 기준 높이). 카드는 창 너비를 채운다.
 * - 가로 창(너비 > 높이, window 두 칸): 한 칸 폭을 창 너비의 절반으로 보고 세로 창과 같은 규칙을 적용한다.
 *   배율 = min((창 너비 / 2) / 기준 너비, 창 높이 / 기준 높이). 카드는 세로 창과 같은 크기로 가로 가운데에 놓이고 양옆이 빈다.
 *
 * 어느 쪽이든 카드(기준 너비 × 기준 높이)가 창 안에 완전히 들어온다.
 */
object WindowLayout {
    fun isLandscape(windowW: Float, windowH: Float) = windowW > windowH

    fun scale(windowW: Float, windowH: Float, refW: Float, refH: Float): Float {
        val slotW = if (isLandscape(windowW, windowH)) windowW / 2 else windowW
        return minOf(slotW / refW, windowH / refH)
    }
}
