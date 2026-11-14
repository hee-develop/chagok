package com.chagok.car.domain

import java.time.Instant

/** 집 하차 카드에 올리는 물건 하나와 그것을 정한 일정. */
data class PickupItem(val name: String, val schedule: Schedule)

/**
 * 집 하차(정책서 4·6·9장): 그날 제목 **끝**에 '픽업·찾기·사기·수령'이 있는 일정의 물건을 챙기라고 알린다.
 * 물건은 제목에서 그 끝 단어를 뺀 말이다(예: '콩물 픽업' → '콩물', '세탁물 찾기' → '세탁물', '우유 사기' → '우유', '택배 수령' → '택배').
 *
 * 단어가 제목 가운데 있으면 물건이 아니다('사기 예방 교육'·'찾기 쉬운 길 안내'·'택배 수령 장소 확인'·'아이 픽업 후 학원'). 제목 끝 뒤에 붙은 괄호 덩어리(닫히지 않은 괄호 포함)·구두점·이모지·공백은 먼저 정리한다
 * ('콩물 픽업 (2개)'·'콩물 픽업 (2개'·'콩물 픽업 🥛' → '콩물').
 * 끝 단어 뒤에 한글이 이어지면 다른 낱말이라 끝이 아니다('사기꾼'). 다만 '픽업하기'·'수령하기'는 같은 뜻이라 센다('콩물 픽업하기' → '콩물'). '사기'·'찾기'는 앞에도 한글이 붙으면 다른 낱말일 가능성이 커서(예: '치사기') 앞이 한글이 아닐 때만 센다.
 * '픽업'·'수령'은 '콩물픽업'처럼 붙여 써도 센다. 단어를 빼고 남는 말이 없으면(제목이 '픽업'뿐) 물건을 알 수 없어 올리지 않는다.
 * 사람을 가리키는 말('아이 픽업'·'엄마 픽업'·'큰애 픽업'·'남편 픽업'…)은 물건이 아니라 올리지 않는다("아이 챙기세요!" 방지). 이름('지수 픽업')은 가려낼 수 없다.
 */
object HomePickup {
    private val END_WORD = Regex("(?:(픽업|수령)(?:하기)?|(?<![가-힣])(사기|찾기))$")
    private val TRAILING_GROUP = Regex("\\s*[(\\[（][^)\\]）]*[)\\]）]\\s*$")

    /** 닫히지 않은 끝 괄호('콩물 픽업 (2개'). */
    private val OPEN_GROUP = Regex("\\s*[(\\[（][^)\\]）]*$")
    private val TAIL_PUNCT = Regex("[\\s·,/:;\\-–!.~\\p{So}\\p{Sk}\\u200D\\uFE0F]+$")
    private val EDGE = Regex("^[\\s·,/:;()\\[\\]\\-–!.\\p{So}\\p{Sk}\\u200D\\uFE0F]+|[\\s·,/:;()\\[\\]\\-–!.\\p{So}\\p{Sk}\\u200D\\uFE0F]+$")

    /** 사람을 가리키는 흔한 말. 물건 이름의 마지막 낱말이 이것이면 사람 픽업이라 물건으로 뽑지 않는다. */
    private val PERSON_WORDS = setOf(
        "아이", "애", "아기", "딸", "아들", "자녀", "애기", "엄마", "아빠", "어머니", "아버지", "어머님", "아버님", "부모님", "부모",
        "남편", "아내", "와이프", "신랑", "여친", "남친", "친구", "할머니", "할아버지", "동생", "언니", "누나", "오빠", "조카", "손주", "손자", "손녀",
    )
    private val PERSON_COMPOUND = Regex("^(큰|작은|막내|첫째|둘째|셋째|우리|울|내)(애|아이|딸|아들)$")
    private val SPACES = Regex("\\s+")

    /** 제목에서 물건 이름을 뽑는다. 제목 끝에 픽업류 단어가 없거나 물건이 남지 않으면 null. */
    fun itemName(title: String): String? {
        var core = title
        // 끝의 괄호 덩어리·구두점을 번갈아 벗긴다('콩물 픽업 (2개) !').
        while (true) {
            val next = core.replace(TRAILING_GROUP, "").replace(OPEN_GROUP, "").replace(TAIL_PUNCT, "")
            if (next == core) break
            core = next
        }
        val word = END_WORD.find(core) ?: return null
        val name = core.substring(0, word.range.first).replace(SPACES, " ").replace(EDGE, "")
        if (name.isEmpty()) return null
        val last = name.substringAfterLast(' ')
        if (last in PERSON_WORDS || PERSON_COMPOUND.matches(last)) return null
        return name
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
