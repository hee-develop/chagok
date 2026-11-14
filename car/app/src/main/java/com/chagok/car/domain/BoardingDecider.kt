package com.chagok.car.domain

import java.time.Duration
import java.time.Instant

sealed interface BoardingDecision {
    /** 잠깐 정차: 아무 말 없이 가던 길안내를 잇는다. */
    data object StaySilent : BoardingDecision

    /** 카드 하나에 질문 하나(5장 끝). */
    data class Card(val briefing: Briefing, val question: Question) : BoardingDecision
}

sealed interface Question {
    /**
     * "어디로 갈까요?" suggested는 후보에 올릴 대상 일정(여유 많음·장소 없음일 때).
     * departBy는 여유 많음일 때 "{출발 시각}에 출발하면 돼요"에 쓰는 출발해야 할 시각.
     * favorites는 후보로 함께 보일 자주 가는 곳(일정 없음·여유 많음일 때만, 개수는 이미 줄여 둠).
     * only는 대안("다른 데", 7장)으로 후보를 하나씩 바꿔 볼 때 지금 보이는 한 곳의 번호([all] 기준). null이면 후보가 모두 보인다.
     */
    data class AskDestination(
        val reason: AskReason,
        val suggested: Schedule? = null,
        val departBy: Instant? = null,
        val favorites: List<Favorite> = emptyList(),
        val only: Int? = null,
    ) : Question {
        /**
         * 이 질문이 가진 모든 후보(지금 보이지 않는 것 포함). 순서가 후보 번호다. 여유 많음이면 대상 일정 장소가 1번이고 자주 가는 곳이 뒤에 붙는다.
         * 장소 모름은 후보가 없다.
         */
        val all: List<DestinationOption>
            get() = when (reason) {
                AskReason.PLENTY_OF_TIME -> listOfNotNull(suggested?.takeIf { it.place != null }?.let { DestinationOption.OfSchedule(it) }) +
                    favorites.map { DestinationOption.OfFavorite(it) }
                AskReason.NO_SCHEDULE -> favorites.map { DestinationOption.OfFavorite(it) }
                AskReason.PLACE_UNKNOWN -> emptyList()
            }

        /** 화면·음성에 보이는 후보. 대안으로 한 곳만 보일 때는 그 하나다. 순서가 후보 번호이고 1번이 주 버튼이며 "응"이 고르는 곳이다. */
        val options: List<DestinationOption>
            get() = only?.let { listOfNotNull(all.getOrNull(it)) } ?: all

        /** [options]의 장소. 길안내는 이 번호로 고른 곳으로 한다. */
        val candidates: List<Place> get() = options.map { it.place }

        /** 다음 후보 하나만 보이는 같은 질문. 더 보여 줄 후보가 없으면 null("다른 곳은 찾지 못했어요."). */
        fun nextAlternative(): AskDestination? = ((only ?: 0) + 1).takeIf { it < all.size }?.let { copy(only = it) }
    }

    /** 출발 제안. arrival은 지금 출발하면 도착할 시각(소요 시간을 알 때만). */
    data class Depart(val target: Schedule, val arrival: Instant? = null) : Question

    /**
     * 늦게 탐: 늦는다는 사실을 알린 뒤 출발 제안과 같이 출발을 묻는다(수락하면 길안내).
     * arrival은 지금 출발하면 도착할 시각이고, 소요 시간을 모르면 null(이때 lateBy는 시작 시각이 지난 시간이다).
     */
    data class DepartLate(val target: Schedule, val lateBy: Duration, val arrival: Instant? = null) : Question
}

enum class AskReason { NO_SCHEDULE, PLENTY_OF_TIME, PLACE_UNKNOWN }

/** 목적지 후보 한 곳. 화면 줄·음성 이름·길안내 장소가 모두 이것에서 나온다. */
sealed interface DestinationOption {
    val place: Place

    /** 대상 일정의 장소(여유 많음의 1번 후보). */
    data class OfSchedule(val schedule: Schedule) : DestinationOption {
        override val place: Place get() = checkNotNull(schedule.place)
    }

    /** 폰 앱에 등록한 집·회사·자주 가는 곳. */
    data class OfFavorite(val favorite: Favorite) : DestinationOption {
        override val place: Place get() = favorite.place
    }
}

/** 5장 '말할 양': 첫 탑승은 오늘 일정 수·대상 일정·챙길 것, 재탑승은 대상 일정 한 줄. */
data class Briefing(
    val level: Level,
    val target: Schedule?,
    val remainingToday: Int,
    /** 아직 도착·건너뜀이 아닌 오늘 일정(종일 제외, 시작 순). 오늘 일정 타일에 쓴다. */
    val upcoming: List<Schedule>,
    /** 첫 탑승 인사 첫 문장에 쓰는 종일 일정 제목. 없으면 null */
    val allDayTitle: String?,
    val memo: MemoNote,
    /** 서버 응답 실패로 오늘 받아 둔 사본을 씀 → "아침에 받은 일정 기준" 한 줄 */
    val fromFallback: Boolean,
) {
    enum class Level { FULL, ONE_LINE }
}

/** 앱에서 적은 채비 한 줄과 그 일정 제목. */
data class CareItem(val title: String, val text: String)

/** 하차 카드가 읽을 글과 그 출처(앱 채비인가 캘린더 메모인가). */
data class ExitNote(val note: MemoNote, val fromCare: Boolean)

sealed interface MemoNote {
    data object None : MemoNote
    data class ReadAloud(val text: String) : MemoNote

    /** 길어서 "{일정} 메모가 있어요."만 알림(질문은 카드의 출발 질문 하나) */
    data object HasMemo : MemoNote

    /**
     * 폰 앱에서 적은 채비. 첫 탑승에는 오늘 일정들의 채비를 모으고(대상 일정이 먼저), 재탑승에는 대상 일정 것만 둔다.
     * 앱 채비가 하나라도 있으면 메모 대신 이것을 읽는다.
     */
    data class Care(val items: List<CareItem>) : MemoNote

    companion object {
        /**
         * 챙길 것. 첫 탑승([first])이면 대상 일정과 오늘의 다른 일정(종일 포함, 도착·건너뜀 제외)의 앱 채비를 모으고,
         * 하나도 없으면 지금처럼 대상 일정의 메모를 읽는다. 다른 일정의 메모는 채비인지 알 수 없어 읽지 않는다.
         * 재탑승이면 대상 일정의 앱 채비만 본다.
         */
        fun forBoarding(first: Boolean, plan: DayPlan?, target: Schedule?): MemoNote {
            val targetCare = target?.careItem()
            if (!first) return targetCare?.let { Care(listOf(it)) } ?: None
            val day = plan?.let { p -> p.schedules.filter { it.allDay } + p.pending() }.orEmpty()
            val others = day.filter { it.id != target?.id }.sortedBy { it.start }.mapNotNull { it.careItem() }
            val items = listOfNotNull(targetCare) + others
            return if (items.isEmpty()) of(target?.memo) else Care(items)
        }

        /**
         * 하차 카드가 읽을 것. 일정에 앱 채비가 있으면 메모 대신 채비를, 없으면 메모를 같은 규칙([of])에 넣는다
         * (탑승 브리핑이 앱 채비를 메모보다 먼저 읽는 것과 같은 우선순위). 채비는 [Care] 묶음이 아니라 글 하나로 본다.
         * [ExitNote.fromCare]는 문구가 "메모"가 아니라 "채비"로 나가게 하려는 표시다.
         */
        fun forExit(schedule: Schedule): ExitNote {
            val care = schedule.care?.trim()?.takeIf { it.isNotEmpty() }
            return if (care != null) ExitNote(of(care), fromCare = true) else ExitNote(of(schedule.memo), fromCare = false)
        }

        private fun Schedule.careItem(): CareItem? = care?.trim()?.takeIf { it.isNotEmpty() }?.let { CareItem(title, it) }

        /** 9장 챙기기: 메모가 한 줄이고 30자 이하면 그대로 읽는다. */
        fun of(memo: String?): MemoNote {
            val text = memo?.trim().orEmpty()
            return when {
                text.isEmpty() -> None
                '\n' !in text && text.length <= Rules.MEMO_READ_MAX_CHARS -> ReadAloud(text)
                else -> HasMemo
            }
        }
    }
}

/**
 * 정책서 5장 '탑승했을 때 판단 순서'. 차량 신호와 SDK 없이 입력만으로 판단한다.
 * MVP 범위 밖인 일정 겹침, 장소 해석(8장), 에너지 체크(9장)는 아직 넣지 않았다.
 */
object BoardingDecider {
    /**
     * @param plan 오늘 일정. 서버 응답도 오늘 사본도 없으면 null
     * @param travelTime `plan.skipOverdue(now).target()`까지 내비 예상 소요 시간. 모르면 null.
     *   모르면 0으로 보고 늦음의 하한만 판단한다(`now - start > LATE_THRESHOLD`면 늦게 탐).
     *   60분 여유 판단(PLENTY_OF_TIME)은 소요 시간을 알 때만 한다.
     * @param favorites 자주 가는 곳(집 → 회사 → 추가한 순서). 일정 없음·여유 많음의 목적지 묻기 후보로 붙인다.
     */
    fun decide(
        now: Instant,
        kind: BoardingKind,
        plan: DayPlan?,
        planIsFallback: Boolean,
        travelTime: Duration?,
        favorites: List<Favorite> = emptyList(),
    ): BoardingDecision {
        if (kind == BoardingKind.QUICK_STOP) return BoardingDecision.StaySilent

        val current = plan?.skipOverdue(now)
        val target = current?.target()
        val briefing = Briefing(
            level = if (kind == BoardingKind.FIRST) Briefing.Level.FULL else Briefing.Level.ONE_LINE,
            target = target,
            remainingToday = current?.pending()?.size ?: 0,
            upcoming = current?.pending().orEmpty(),
            allDayTitle = if (kind == BoardingKind.FIRST) current?.allDayTitle() else null,
            memo = MemoNote.forBoarding(kind == BoardingKind.FIRST, current, target),
            fromFallback = plan != null && planIsFallback,
        )
        return BoardingDecision.Card(briefing, question(now, target, travelTime, favorites))
    }

    private fun question(now: Instant, target: Schedule?, travelTime: Duration?, favorites: List<Favorite>): Question {
        if (target == null) {
            return Question.AskDestination(AskReason.NO_SCHEDULE, favorites = favorites.take(Rules.MAX_DESTINATION_CANDIDATES))
        }
        if (target.place == null) return Question.AskDestination(AskReason.PLACE_UNKNOWN, target)
        // 소요 시간을 모르면 0으로 보고 늦음의 하한만 본다. 여유(60분) 판단은 소요 시간을 알 때만 한다.
        if (travelTime != null) {
            val departBy = target.start - travelTime - Rules.DEPARTURE_BUFFER
            if (Duration.between(now, departBy) > Rules.ASK_DESTINATION_LEAD) {
                // 일정 장소와 같은 곳은 자주 가는 곳에서 빼고, 일정 장소 한 자리를 남겨 둔다.
                val others = favorites.filterNot { samePlace(it.place, target.place) }.take(Rules.MAX_DESTINATION_CANDIDATES - 1)
                return Question.AskDestination(AskReason.PLENTY_OF_TIME, target, departBy, others)
            }
        }
        val arrival = travelTime?.let { now + it }
        val lateBy = Duration.between(target.start, now + (travelTime ?: Duration.ZERO))
        if (lateBy > Rules.LATE_THRESHOLD) return Question.DepartLate(target, lateBy, arrival)
        return Question.Depart(target, arrival)
    }

    /** 이름이나 좌표가 같으면 같은 곳으로 본다(일정 장소와 자주 가는 곳은 출처가 달라 이름 표기가 다를 수 있다). */
    private fun samePlace(a: Place, b: Place) = a.name == b.name || a.position == b.position
}
