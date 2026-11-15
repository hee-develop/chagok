package com.chagok.car.domain

import java.time.ZoneId

/**
 * 차곡의 '오늘'과 일정 시각을 읽는 시간대. 서버가 '오늘'을 Asia/Seoul 날짜로 정하듯 차도 기기 시간대가 아니라 늘 서울로 읽는다.
 * 날짜 판단(탑승 기록·하차 대기·건너뜀 정리)·말하는 시각·카드·칩·가짜 길안내 패널의 시각 표기가 모두 [DemoClock][com.chagok.car.runtime.DemoClock]의 zone을 거치므로 여기 한 곳만 고치면 된다.
 * 에뮬레이터가 UTC로 떠 있어도(Pleos 에뮬레이터는 시간대를 바꾸지 못하는 경우가 있다) 서울 09:00가 '새벽 0시'로 읽히지 않는다.
 */
object ServiceZone {
    val SEOUL: ZoneId = ZoneId.of("Asia/Seoul")
}
