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
    val CARD_TIMEOUT: Duration = Duration.ofSeconds(30)
    const val MEMO_READ_MAX_CHARS = 30

    // 가안
    val DEPARTURE_BUFFER: Duration = Duration.ofMinutes(10)
}
