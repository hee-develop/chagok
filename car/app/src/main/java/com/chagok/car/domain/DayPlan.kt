package com.chagok.car.domain

import java.time.Instant

/** 오늘 일정과 일정별 상태. 3장 상태 전이와 5장 '대상 일정 고르기'를 맡는다. */
data class DayPlan(
    val schedules: List<Schedule>,
    val statuses: Map<String, ScheduleStatus> = emptyMap(),
) {
    fun statusOf(id: String): ScheduleStatus = statuses[id] ?: ScheduleStatus.PLANNED

    /** 도착·건너뜀이 아닌 일정을 시작 시각 순으로. 종일 일정은 길안내 대상이 아니므로 뺀다. */
    fun pending(): List<Schedule> =
        schedules.filterNot { it.allDay || statusOf(it.id).isFinal }.sortedBy { it.start }

    /** 탑승 인사에만 쓰는 종일 일정 제목. 여럿이면 먼저 시작하는 것 하나. */
    fun allDayTitle(): String? = schedules.filter { it.allDay }.minByOrNull { it.start }?.title

    fun target(): Schedule? = pending().firstOrNull()

    /** 끝나는 시각이 지났는데 도착 전인 일정은 건너뜀. */
    fun skipOverdue(now: Instant): DayPlan =
        pending().filter { !it.end.isAfter(now) }.fold(this) { plan, s -> plan.moveTo(s.id, ScheduleStatus.SKIPPED) }

    fun markLate(id: String): DayPlan =
        if (statusOf(id) == ScheduleStatus.PLANNED) moveTo(id, ScheduleStatus.LATE) else this

    fun markArrived(id: String): DayPlan = moveTo(id, ScheduleStatus.ARRIVED)

    private fun moveTo(id: String, status: ScheduleStatus): DayPlan {
        if (statusOf(id).isFinal || schedules.none { it.id == id }) return this
        return copy(statuses = statuses + (id to status))
    }
}
