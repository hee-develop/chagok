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

    /**
     * 탑승 판단의 대상 일정 후보(5장 '대상 일정 고르기'): 도착·건너뜀이 아닌 일정을 시작 순으로 보되
     * - 장소 칸이 빈 일정은 시작 [Rules.PLACE_BLANK_LEAD] 전부터만 대상이다(그 전에는 건너뛰고 다음 일정을 본다).
     * - 일정 장소가 지금 차 위치 [here]에서 [Rules.ALREADY_THERE_RADIUS_METERS] 안이면(이미 그곳) 뺀다. [here]를 모르면 이 판정은 건너뛴다.
     */
    fun boardingCandidates(now: Instant, here: LatLng?): List<Schedule> = pending().filter { schedule ->
        val place = schedule.place
        when {
            place == null -> !now.isBefore(schedule.start - Rules.PLACE_BLANK_LEAD)
            here != null -> here.distanceTo(place.position) > Rules.ALREADY_THERE_RADIUS_METERS
            else -> true
        }
    }

    /** 탑승 판단의 대상 일정. 주행 중 칩·하차 판단은 [target]을 쓰고, 탑승 판단은 이것을 쓴다. */
    fun boardingTarget(now: Instant, here: LatLng?): Schedule? = boardingCandidates(now, here).firstOrNull()

    /** 장소가 있는 종일 일정(끝나지 않은 것, 시작 순). '어디로 갈까요?' 후보에 넣는다(6장 종일 일정). */
    fun allDayWithPlace(now: Instant): List<Schedule> =
        schedules.filter { it.allDay && it.place != null && it.end.isAfter(now) && !statusOf(it.id).isFinal }.sortedBy { it.start }

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
