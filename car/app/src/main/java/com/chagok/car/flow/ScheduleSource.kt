package com.chagok.car.flow

import com.chagok.car.domain.Favorite
import com.chagok.car.domain.Schedule

/** [ScheduleSource.schedules]가 어떤 데이터인지. */
enum class ScheduleOrigin {
    /** 받은 적도 없고 저장된 오늘 사본도 없다. 일정이 없다는 뜻이 아니다. */
    NONE,

    /** 이번 받기는 실패했고 이전에 받아 둔 오늘 사본을 쓴다. */
    STORED,

    /** 마지막 받기가 성공했다. */
    FRESH,
}

/** 어느 한 순간의 오늘 일정과 그 출처, 같은 응답에 실려 온 자주 가는 곳. 모두 같은 순간의 값이다. */
data class ScheduleSnapshot(
    val schedules: List<Schedule>,
    val origin: ScheduleOrigin = ScheduleOrigin.FRESH,
    val favorites: List<Favorite> = emptyList(),
)

/** 오늘 일정을 주는 곳. */
fun interface ScheduleSource {
    /** 일정과 출처를 한 번에 읽는다. */
    fun snapshot(): ScheduleSnapshot
}
