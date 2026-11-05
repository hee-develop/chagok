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
     */
    data class AskDestination(
        val reason: AskReason,
        val suggested: Schedule? = null,
        val departBy: Instant? = null,
    ) : Question

    /** 출발 제안. arrival은 지금 출발하면 도착할 시각(소요 시간을 알 때만). */
    data class Depart(val target: Schedule, val arrival: Instant? = null) : Question

    /**
     * 늦게 탐: 출발을 묻지 않고 늦는다는 사실을 알린다.
     * arrival은 지금 출발하면 도착할 시각이고, 소요 시간을 모르면 null(이때 lateBy는 시작 시각이 지난 시간이다).
     */
    data class DepartLate(val target: Schedule, val lateBy: Duration, val arrival: Instant? = null) : Question
}

enum class AskReason { NO_SCHEDULE, PLENTY_OF_TIME, PLACE_UNKNOWN }

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

sealed interface MemoNote {
    data object None : MemoNote
    data class ReadAloud(val text: String) : MemoNote

    /** 길어서 "{일정} 메모가 있어요."만 말함 */
    data object HasMemo : MemoNote

    companion object {
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
     */
    fun decide(
        now: Instant,
        kind: BoardingKind,
        plan: DayPlan?,
        planIsFallback: Boolean,
        travelTime: Duration?,
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
            memo = if (kind == BoardingKind.FIRST) MemoNote.of(target?.memo) else MemoNote.None,
            fromFallback = plan != null && planIsFallback,
        )
        return BoardingDecision.Card(briefing, question(now, target, travelTime))
    }

    private fun question(now: Instant, target: Schedule?, travelTime: Duration?): Question {
        if (target == null) return Question.AskDestination(AskReason.NO_SCHEDULE)
        if (target.place == null) return Question.AskDestination(AskReason.PLACE_UNKNOWN, target)
        // 소요 시간을 모르면 0으로 보고 늦음의 하한만 본다. 여유(60분) 판단은 소요 시간을 알 때만 한다.
        if (travelTime != null) {
            val departBy = target.start - travelTime - Rules.DEPARTURE_BUFFER
            if (Duration.between(now, departBy) > Rules.ASK_DESTINATION_LEAD) {
                return Question.AskDestination(AskReason.PLENTY_OF_TIME, target, departBy)
            }
        }
        val arrival = travelTime?.let { now + it }
        val lateBy = Duration.between(target.start, now + (travelTime ?: Duration.ZERO))
        if (lateBy > Rules.LATE_THRESHOLD) return Question.DepartLate(target, lateBy, arrival)
        return Question.Depart(target, arrival)
    }
}
