package com.chagok.car.ui

/**
 * 카드 열(카드·알약을 담는 카드 너비의 열)을 창 안에서 어디에 두는가.
 * 기본은 가로 가운데([CENTER]). 디버그 빌드의 가짜 내비가 켜져 있을 때만 시안처럼 왼쪽 위 모서리([START])다.
 * 정렬은 `FakeNavi.cardAlign()`이 정하고(릴리스는 늘 [CENTER]), MainActivity는 그 값을 배치에 옮기기만 한다.
 */
enum class CardAlign {
    CENTER,
    START;

    /**
     * 열 왼쪽에 둘 여백(실제 px). [CENTER]는 0이다.
     * [START]는 시안처럼 모서리에서 [margin]만큼 띄우되, 카드가 창 너비를 거의 채우는 세로 창에서는
     * 카드가 잘리지 않게 남는 폭([windowWidth] - [cardWidth])까지만 둔다. 세로 창(한 칸)에서는 0이라 가운데 정렬과 같다.
     */
    fun inset(windowWidth: Int, cardWidth: Int, margin: Int): Int = when (this) {
        CENTER -> 0
        START -> margin.coerceAtMost((windowWidth - cardWidth).coerceAtLeast(0)).coerceAtLeast(0)
    }
}
