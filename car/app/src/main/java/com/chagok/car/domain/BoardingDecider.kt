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
        /** 후보에 함께 넣는 장소 있는 종일 일정(6장 종일 일정). 집 다음, 나머지 자주 가는 곳 앞에 오고 최대 한 자리다. */
        val allDay: List<Schedule> = emptyList(),
        val only: Int? = null,
    ) : Question {
        /**
         * 이 질문이 가진 모든 후보(지금 보이지 않는 것 포함). 순서가 후보 번호이고 정책서 5장대로 대상 일정 장소(여유 많음일 때만) → 집 → (종일 일정 장소) → 나머지 자주 가는 곳이다.
         * 장소 모름은 후보가 없다.
         */
        val all: List<DestinationOption>
            get() = when (reason) {
                AskReason.PLENTY_OF_TIME -> listOfNotNull(suggested?.takeIf { it.place != null }?.let { DestinationOption.OfSchedule(it) }) + rest()
                AskReason.NO_SCHEDULE -> rest()
                AskReason.PLACE_UNKNOWN -> emptyList()
            }

        /** 대상 일정 장소 뒤의 후보: 집 → 종일 일정 장소 → 나머지 자주 가는 곳. */
        private fun rest(): List<DestinationOption> =
            favorites.filter { it.kind == FavoriteKind.HOME }.map { DestinationOption.OfFavorite(it) } +
                allDay.map { DestinationOption.OfAllDay(it) } +
                favorites.filter { it.kind != FavoriteKind.HOME }.map { DestinationOption.OfFavorite(it) }

        /** 화면·음성에 보이는 후보. 대안으로 한 곳만 보일 때는 그 하나다. 순서가 후보 번호이고 1번이 주 버튼이며 "응"이 고르는 곳이다. */
        val options: List<DestinationOption>
            get() = only?.let { listOfNotNull(all.getOrNull(it)) } ?: all

        /** [options]의 장소. 길안내는 이 번호로 고른 곳으로 한다. */
        val candidates: List<Place> get() = options.map { it.place }

        /** 다음 후보 하나만 보이는 같은 질문. 더 보여 줄 후보가 없으면 null("다른 곳은 찾지 못했어요."). */
        fun nextAlternative(): AskDestination? = ((only ?: 0) + 1).takeIf { it < all.size }?.let { copy(only = it) }
    }

    /**
     * 일정 겹침(5장·6장): 이동 시간상 둘 다 갈 수 없는 두 일정. [first]가 먼저인 일정(주 버튼), [second]가 다음 일정(보조 버튼)이다.
     * 고른 일정으로 출발 제안·길안내를 이어 가고, 고르지 않은 일정은 그대로 둔다(건너뜀은 종료 시각 규칙을 따른다).
     */
    data class Overlap(val first: Schedule, val second: Schedule) : Question

    /**
     * 출발 제안. arrival은 지금 출발하면 도착할 시각(소요 시간을 알 때만).
     * lowEnergy는 에너지가 모자란데 충전·주유 후보를 얻지 못해(서버 실패·후보 없음) 원래 제안에 "배터리가 모자랄 수 있어요." 한 문장과 배터리·연료 타일(이유 한 줄)만 붙일 때의 판단 결과다(없으면 null).
     */
    data class Depart(val target: Schedule, val arrival: Instant? = null, val lowEnergy: EnergyShort? = null) : Question

    /**
     * 에너지 제안(정책서 5장·9장): 남은 일정과 귀가 거리가 주행 가능 거리보다 길어 출발 제안을 충전·주유를 넣은 제안 하나로 바꾼 것.
     * 큰 문구는 대상 일정 안내("다음은 5시 KIA 직관이에요.")이고 충전·주유 제안이 그 아래, 판단 결과([short])는 배터리·연료 타일의 이유 한 줄이다.
     * 수락하면 완속 충전소([EnergyStopKind.SLOW_CHARGER], 머무는 동안 충전)는 [stop]을 **목적지로** 길안내하고(대상 일정은 그대로 [target]이라 도착하면 그 일정 도착),
     * 경로상 급속·주유는 [stop]을 경유지로 넣고 [target]으로 길안내한다. 보조 버튼("그냥 {장소}로")은 충전 없이 [target]으로 길안내한다.
     * 대안("다른 데")은 다음 후보 하나만 바꿔 보인다([nextAlternative]).
     * [mealBundle]은 서버가 알린 '식사 + 급속 충전' 묶음으로, 맨 앞 후보(index 0)에만 뜻이 있다.
     */
    data class Energy(
        val target: Schedule,
        val short: EnergyShort,
        val stops: List<EnergyStop>,
        val index: Int = 0,
        val mealBundle: Boolean = false,
        val stale: Boolean = false,
    ) : Question {
        val stop: EnergyStop get() = stops[index]
        val kind: EnergyKind get() = short.kind
        val neededKm: Int get() = short.neededKm
        val goal: EnergyGoal get() = short.goal

        /** 이 후보를 목적지로 길안내하는가(머무는 동안 충전하는 완속 충전소). 아니면 경유지다. */
        val stopIsDestination: Boolean get() = stop.kind == EnergyStopKind.SLOW_CHARGER

        /** 다음 후보 하나만 보이는 같은 제안. 더 보여 줄 후보가 없으면 null("다른 곳은 찾지 못했어요."). */
        fun nextAlternative(): Energy? = (index + 1).takeIf { it < stops.size }?.let { copy(index = it) }
    }

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

    /** 장소가 있는 종일 일정의 장소. 길안내는 하지만 그 일정을 도착으로 기록하지는 않는다(종일 일정은 길안내 대상이 아니다). */
    data class OfAllDay(val schedule: Schedule) : DestinationOption {
        override val place: Place get() = checkNotNull(schedule.place)
    }

    /** 폰 앱에 등록한 집·회사·자주 가는 곳. */
    data class OfFavorite(val favorite: Favorite) : DestinationOption {
        override val place: Place get() = favorite.destination
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
 * 에너지 체크(9장)는 서버를 불러야 해서 이 판단 뒤 [com.chagok.car.flow.DriveSession]이 출발 제안을 바꾼다([Question.Energy]).
 */
object BoardingDecider {
    /**
     * @param plan 오늘 일정. 서버 응답도 오늘 사본도 없으면 null
     * @param travelTime `plan.skipOverdue(now).target()`까지 내비 예상 소요 시간. 모르면 null.
     *   모르면 0으로 보고 늦음의 하한만 판단한다(`now - start > LATE_THRESHOLD`면 늦게 탐).
     *   60분 여유 판단(PLENTY_OF_TIME)은 소요 시간을 알 때만 한다.
     * @param favorites 자주 가는 곳(집 → 회사 → 추가한 순서). 일정 없음·여유 많음의 목적지 묻기 후보로 붙인다.
     * @param forcedTarget 일정 겹침에서 사용자가 고른 일정. 있으면 이 일정을 대상으로 겹침 판단 없이 이어 간다(아직 도착·건너뜀이 아닐 때만).
     * @param here 지금 차 위치(믿을 만한 최근 측위가 있을 때만, 없으면 null). 일정 장소가 [Rules.ALREADY_THERE_RADIUS_METERS] 안이면 대상에서 빼고,
     *   지금 집이면([Rules.HOME_RADIUS_METERS]) 후보에서 집을 뺀다. null이면 두 판정을 건너뛴다.
     */
    fun decide(
        now: Instant,
        kind: BoardingKind,
        plan: DayPlan?,
        planIsFallback: Boolean,
        travelTime: Duration?,
        favorites: List<Favorite> = emptyList(),
        here: LatLng? = null,
        forcedTarget: Schedule? = null,
    ): BoardingDecision {
        if (kind == BoardingKind.QUICK_STOP) return BoardingDecision.StaySilent

        val current = plan?.skipOverdue(now)
        val candidates = current?.boardingCandidates(now, here).orEmpty()
        val forced = forcedTarget?.let { f -> current?.pending()?.firstOrNull { it.id == f.id } }
        val target = forced ?: candidates.firstOrNull()
        val briefing = Briefing(
            level = if (kind == BoardingKind.FIRST) Briefing.Level.FULL else Briefing.Level.ONE_LINE,
            target = target,
            remainingToday = current?.pending()?.size ?: 0,
            upcoming = current?.pending().orEmpty(),
            allDayTitle = if (kind == BoardingKind.FIRST) current?.allDayTitle() else null,
            memo = MemoNote.forBoarding(kind == BoardingKind.FIRST, current, target),
            fromFallback = plan != null && planIsFallback,
        )
        // 사용자가 겹침에서 고른 일정이면 다시 겹침을 묻지 않는다.
        val overlap = if (forced == null) findOverlap(candidates) else null
        return BoardingDecision.Card(briefing, question(now, target, travelTime, favorites, current?.allDayWithPlace(now).orEmpty(), here, overlap))
    }

    /**
     * 일정 겹침(정책서 5장 '이동 시간상 둘 다 갈 수 없는 일정'): 대상 일정(먼저인 일정)과 그 바로 다음 일정이 둘 다 장소가 있고,
     * A 종료 시각 + (A 장소↔B 장소 직선거리 ÷ [Rules.OVERLAP_SPEED_KMH]) > B 시작 시각이면 겹침이다(정확히 같으면 겹침이 아니다).
     * 두 장소가 [Rules.ARRIVAL_RADIUS_METERS] 안으로 같은 곳이면 옮겨 갈 일이 없어 겹침으로 보지 않는다(같은 경기장의 두 일정 등).
     * [candidates]는 [DayPlan.boardingCandidates]다(첫째가 대상 일정). 둘째가 장소를 모르면(질문 대상이 아님) 판정하지 않는다.
     */
    fun findOverlap(candidates: List<Schedule>): Pair<Schedule, Schedule>? {
        val a = candidates.getOrNull(0) ?: return null
        val b = candidates.getOrNull(1) ?: return null
        val pa = a.place ?: return null
        val pb = b.place ?: return null
        val distance = pa.position.distanceTo(pb.position)
        if (distance <= Rules.ARRIVAL_RADIUS_METERS) return null
        return if (a.end + Rules.overlapTravel(distance) > b.start) a to b else null
    }

    private fun question(
        now: Instant,
        target: Schedule?,
        travelTime: Duration?,
        allFavorites: List<Favorite>,
        allDay: List<Schedule>,
        here: LatLng?,
        overlap: Pair<Schedule, Schedule>?,
    ): Question {
        // 지금 집이면 집은 후보에서 뺀다(8장).
        val favorites = allFavorites.filterNot { it.kind == FavoriteKind.HOME && here != null && here.distanceTo(it.place.position) <= Rules.HOME_RADIUS_METERS }
        if (target == null) {
            val (days, favs) = destinationLists(null, allDay, favorites)
            return Question.AskDestination(AskReason.NO_SCHEDULE, favorites = favs, allDay = days)
        }
        if (overlap != null) return Question.Overlap(overlap.first, overlap.second)
        if (target.place == null) return Question.AskDestination(AskReason.PLACE_UNKNOWN, target)
        // 소요 시간을 모르면 0으로 보고 늦음의 하한만 본다. 여유(60분) 판단은 소요 시간을 알 때만 한다.
        if (travelTime != null) {
            val departBy = target.start - travelTime - Rules.DEPARTURE_BUFFER
            if (Duration.between(now, departBy) > Rules.ASK_DESTINATION_LEAD) {
                // 일정 장소와 같은 곳은 종일 일정·자주 가는 곳에서 빼고, 일정 장소 한 자리를 남겨 둔다.
                val (days, others) = destinationLists(target, allDay, favorites)
                return Question.AskDestination(AskReason.PLENTY_OF_TIME, target, departBy, others, days)
            }
        }
        val arrival = travelTime?.let { now + it }
        val lateBy = Duration.between(target.start, now + (travelTime ?: Duration.ZERO))
        if (lateBy > Rules.LATE_THRESHOLD) return Question.DepartLate(target, lateBy, arrival)
        return Question.Depart(target, arrival)
    }

    /**
     * 목적지 후보를 [Rules.MAX_DESTINATION_CANDIDATES]개 안으로 모은다. 순서는 정책서 5장대로 대상 일정 장소 → 집 → (장소 있는 종일 일정) → 나머지 자주 가는 곳이고
     * ([Question.AskDestination.all]이 같은 순서로 늘어놓는다), 종일 일정은 최대 한 자리다.
     * 앞에서 이미 고른 곳과 같은 장소(이름이나 좌표)는 뒤에서 뺀다. 대상 일정은 [suggested]가 있을 때 한 자리를 쓴다.
     */
    private fun destinationLists(suggested: Schedule?, allDay: List<Schedule>, favorites: List<Favorite>): Pair<List<Schedule>, List<Favorite>> {
        var room = Rules.MAX_DESTINATION_CANDIDATES - if (suggested != null) 1 else 0
        val taken = mutableListOf<Place>()
        suggested?.place?.let { taken += it }
        fun pick(candidates: List<Favorite>): List<Favorite> {
            val picked = mutableListOf<Favorite>()
            for (fav in candidates) {
                if (picked.size >= room || taken.any { samePlace(it, fav.place) }) continue
                picked += fav
                taken += fav.place
            }
            room -= picked.size
            return picked
        }
        val homes = pick(favorites.filter { it.kind == FavoriteKind.HOME })
        val day = if (room > 0) allDay.firstOrNull { s -> s.place?.let { place -> taken.none { samePlace(it, place) } } == true } else null
        if (day != null) {
            taken += checkNotNull(day.place)
            room--
        }
        val others = pick(favorites.filter { it.kind != FavoriteKind.HOME })
        return listOfNotNull(day) to (homes + others)
    }

    /** 이름이나 좌표가 같으면 같은 곳으로 본다(일정 장소와 자주 가는 곳은 출처가 달라 이름 표기가 다를 수 있다). */
    private fun samePlace(a: Place, b: Place) = a.name == b.name || a.position == b.position
}
