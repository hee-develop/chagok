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

    /** 하차 카드가 자동으로 닫히기까지(12장 '하차 카드 5초', 확정). [챙겼어요]를 누르면 그 전에 닫힌다. */
    val EXIT_CARD: Duration = Duration.ofSeconds(5)
    const val MEMO_READ_MAX_CHARS = 30
    const val MAX_REPROMPTS = 1

    /** 도착 판정 거리(기획서 '위치 (300m 판정)'): P단에 넣은 곳이 대상 일정 장소에서 이 거리 안이면 도착이다. */
    const val ARRIVAL_RADIUS_METERS = 300.0

    // 가안
    /**
     * 내비 도착 알림 뒤 하차 카드를 기다리는 최대 시간(가안). 이 안에 실제로 달린 뒤 넣은 P단에서만 하차 카드를 띄우고, 지나면 대기를 버린다.
     * 정책서 12장에 가안으로 추가할 값이다(아직 표에 없다).
     */
    val EXIT_PENDING_MAX: Duration = Duration.ofMinutes(15)

    val DEPARTURE_BUFFER: Duration = Duration.ofMinutes(10)
    const val CHATTER_OVER_WORDS = 4

    /** '어디로 갈까요?' 카드의 후보 수(일정 장소 포함). 음성으로는 이름이나 '첫/두/세 번째'로 고른다. */
    const val MAX_DESTINATION_CANDIDATES = 3
}
