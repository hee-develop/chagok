package com.chagok.car.domain

import java.time.Instant

/** 집 하차 카드에 올리는 물건 하나와 그것을 정한 일정. */
data class PickupItem(val name: String, val schedule: Schedule)

/**
 * 집 하차(정책서 4·6·9장): 그날 제목에 '픽업·찾기·사기·수령'이 들어간 일정의 물건을 챙기라고 알린다.
 * 물건은 제목에서 그 단어를 뺀 말이다(예: '콩물 픽업' → '콩물', '세탁물 찾기' → '세탁물').
 *
 * 단어는 낱말 끝에서만 센다(뒤에 한글이 이어지면 다른 낱말이다: '픽업하기'·'사기꾼'은 아님).
 * '사기'·'찾기'는 앞에도 한글이 붙으면 다른 낱말일 가능성이 커서(예: '치사기') 앞이 한글이 아닐 때만 센다. '픽업'·'수령'은 '콩물픽업'처럼 붙여 써도 센다.
 * 단어를 빼고 남는 말이 없으면(제목이 '픽업'뿐) 물건을 알 수 없어 올리지 않는다.
 */
object HomePickup {
    private val LONG_WORDS = Regex("(픽업|수령)(?![가-힣])")
    private val SHORT_WORDS = Regex("(?<![가-힣])(사기|찾기)(?![가-힣])")
    private val EDGE = Regex("^[\\s·,/:;()\\[\\]\\-–!.]+|[\\s·,/:;()\\[\\]\\-–!.]+$")
    private val SPACES = Regex("\\s+")

    /** 제목에서 물건 이름을 뽑는다. 픽업류 단어가 없거나 물건이 남지 않으면 null. */
    fun itemName(title: String): String? {
        if (!LONG_WORDS.containsMatchIn(title) && !SHORT_WORDS.containsMatchIn(title)) return null
        val name = title.replace(LONG_WORDS, " ").replace(SHORT_WORDS, " ")
            .replace(SPACES, " ").replace(EDGE, "")
        return name.ifEmpty { null }
    }

    /**
     * 지금 집에서 챙길 물건. 종일 일정은 뺀다. 이미 알린 일정([announced])도 뺀다.
     * 픽업했을 일정만 센다: 도착으로 기록됐거나, 시작 시각이 지났고 '장소가 있는데 건너뜀'이 아닌 것. 시작 전이면 아직 받지 않았다.
     * 장소가 있는데 건너뜀(끝나도록 도착 기록이 없음)이면 가지 않은 것으로 보고 뺀다. 장소가 없는 일정은 도착 기록을 할 수 없어 건너뜀이어도 센다. 시작 시각 순이다.
     * 카드에 올릴 때 같은 이름을 합치고 [Rules.HOME_ITEMS_MAX]개로 줄이는 일은 [dedupedForCard]가 한다(알림 기록은 모두 센다).
     */
    fun items(plan: DayPlan, now: Instant, announced: Set<String> = emptySet()): List<PickupItem> =
        plan.schedules
            .asSequence()
            .filter { !it.allDay && it.id !in announced }
            .filter {
                val status = plan.statusOf(it.id)
                status == ScheduleStatus.ARRIVED ||
                    (!it.start.isAfter(now) && !(status == ScheduleStatus.SKIPPED && it.place != null))
            }
            .sortedBy { it.start }
            .mapNotNull { s -> itemName(s.title)?.let { PickupItem(it, s) } }
            .toList()

    /** 카드에 올릴 물건: 같은 이름은 한 번만, 최대 [Rules.HOME_ITEMS_MAX]개. */
    fun dedupedForCard(items: List<PickupItem>): List<PickupItem> = items.distinctBy { it.name }.take(Rules.HOME_ITEMS_MAX)
}
