package com.chagok.car.domain

import java.time.Duration

/**
 * 정책서 12장 기준값. 차량 앱의 숫자 기준은 여기에만 둔다.
 * '가안' 값을 바꾸면 정책서 12장 표도 함께 고친다.
 */
object Rules {
    // 확정
    val QUICK_STOP: Duration = Duration.ofMinutes(10)
    val ASK_DESTINATION_LEAD: Duration = Duration.ofMinutes(60)
    val LATE_THRESHOLD: Duration = Duration.ofMinutes(5)
    val LISTEN_WINDOW: Duration = Duration.ofSeconds(8)
    val CARD_TIMEOUT: Duration = Duration.ofSeconds(30)
    val RESULT_VISIBLE: Duration = Duration.ofSeconds(10)
    const val MEMO_READ_MAX_CHARS = 30
    const val MAX_REPROMPTS = 1

    // 가안
    val DEPARTURE_BUFFER: Duration = Duration.ofMinutes(10)
    const val CHATTER_OVER_WORDS = 4

    /** '어디로 갈까요?' 카드의 후보 수(일정 장소 포함). 음성으로는 이름이나 '첫/두/세 번째'로 고른다. */
    const val MAX_DESTINATION_CANDIDATES = 3
}
