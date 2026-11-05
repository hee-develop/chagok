package com.chagok.car.flow

import com.chagok.car.domain.AskReason
import com.chagok.car.domain.Briefing
import com.chagok.car.domain.BoardingDecision
import com.chagok.car.domain.MemoNote
import com.chagok.car.domain.Question
import com.chagok.car.domain.Schedule
import com.chagok.car.ui.CardContent
import com.chagok.car.ui.TileRow
import com.chagok.car.ui.TileView
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 카드와 음성 대사 전부. 디자인 가이드 voice.md의 장면별 대사 틀에 일정 데이터를 채운다.
 * 화면 문장과 TTS 문장은 같다([spoken]). 문장은 이 틀에서만 만들고 생성형 AI로 짓지 않는다.
 *
 * 시각 표기: 말(t-voice·TTS)은 12시간제 "1시", "2시 40분"(오전·오후 없음), 타일은 24시간제 "13:00".
 */
object Phrases {
    const val ASK_DEPART = "출발할까요?"
    const val ASK_AGAIN = "다시 말해 줄래요? '응'이나 '아니'로요."
    const val USE_SCREEN = "화면에서 눌러 주세요."
    const val NO_ALTERNATIVE = "다른 곳은 찾지 못했어요."
    const val ROUTE_STARTED = "길안내를 시작할게요."
    const val ROUTE_FAILED = "길안내를 시작하지 못했어요."
    const val STALE_SCHEDULE = "서버에 연결하지 못해 마지막으로 받은 일정 기준이에요."

    // 카드 머리 상태 칩(StatusChip). 다른 문구를 만들지 않는다.
    const val STATUS_BEFORE_DEPARTURE = "정차 중 · 출발 전"

    // 버튼 라벨은 운전자가 소리 내 말할 문장 그대로
    const val ACCEPT_DEPART = "응, 출발"
    const val HOLD = "잠깐만"
    const val JUST_GO = "그냥 갈게"

    /** 일정 안내 카드의 버튼 */
    const val CLOSE = "닫기"

    // 버튼 줄 오른쪽 끝 음성 힌트 두 줄
    const val HINT_SAY_YES = "“응”이라고 말해도 돼요"
    const val HINT_SAY_JUST_GO = "“그냥 갈게”라고 말해도 돼요"
    const val HINT_AUTO_FOLD = "출발하면 자동으로 접혀요"

    const val ASK_DESTINATION = "어디로 갈까요?"
    const val DUCKING = "차곡 안내 중 · 볼륨을 잠깐 낮췄어요"

    // 권한 설명 카드
    const val PERMISSION_VOICE = "기어와 시동 상태를 쓸게요."
    const val PERMISSION_SUB = "차가 멈췄는지, 시동이 켜졌는지 알려면 필요해요."
    const val PERMISSION_CONFIRM = "계속할게요"
    const val PERMISSION_DENIED = "권한이 없어 정차·탑승 판단을 쓸 수 없어요. 설정에서 허용하면 쓸 수 있어요."

    // 일정 안내 카드
    const val SCHEDULE_UNAVAILABLE = "일정을 불러오지 못했어요. 연결을 확인해 주세요."

    private const val RIEUL = 8

    /** 한국어로 읽을 때 받침이 있는 숫자: 영·일·삼·육·칠·팔 */
    private val BATCHIM_DIGITS = setOf('0', '1', '3', '6', '7', '8')

    /** 읽을 때 ㄹ 받침으로 끝나는 숫자: 일·칠·팔 */
    private val RIEUL_DIGITS = setOf('1', '7', '8')
    private val TIME = DateTimeFormatter.ofPattern("HH:mm")

    /** 타일의 24시간제 시각 "13:00" */
    fun time(schedule: Schedule, zone: ZoneId): String = TIME.format(schedule.start.atZone(zone))

    /** 말하는 12시간제 시각. 오전·오후 없이 "1시", "2시 40분". 0시와 12시는 "12시". */
    fun spokenTime(instant: Instant, zone: ZoneId): String {
        val t = instant.atZone(zone)
        val hour = if (t.hour % 12 == 0) 12 else t.hour % 12
        return if (t.minute == 0) "${hour}시" else "${hour}시 ${t.minute}분"
    }

    /** 남은 시간 "3시간 40분", "1시간", "45분". 초는 반올림한다. 0 이하는 "0분". */
    fun remaining(duration: Duration): String {
        val minutes = ((duration.seconds + 30) / 60).coerceAtLeast(0)
        val h = minutes / 60
        val m = minutes % 60
        return when {
            h == 0L -> "${m}분"
            m == 0L -> "${h}시간"
            else -> "${h}시간 ${m}분"
        }
    }

    // ---- 조사 ----

    /** "{제목}이에요/예요": 받침이 있으면 "이에요", 없으면 "예요". */
    fun iEyo(title: String): String = if (hasBatchim(title)) "${title}이에요" else "${title}예요"

    /** "{말}이/가": 받침이 있으면 "이", 없으면 "가". */
    fun iGa(word: String): String = word + iGaJosa(word)

    /** "{말}은/는": 받침이 있으면 "은", 없으면 "는". */
    fun eunNeun(word: String): String = word + if (hasBatchim(word)) "은" else "는"

    private fun iGaJosa(word: String) = if (hasBatchim(word)) "이" else "가"

    /** "{장소}로/으로": 받침이 있으면(ㄹ 제외) "으로". */
    fun ro(word: String): String {
        val josa = if (hasBatchim(word) && !endsWithRieul(word)) "으로" else "로"
        return "$word$josa"
    }

    private fun lastReadable(word: String): Char? = word.lastOrNull { it.isLetterOrDigit() }

    private fun finalConsonantOf(c: Char): Int? {
        val code = c.code
        return if (code in 0xAC00..0xD7A3) (code - 0xAC00) % 28 else null
    }

    // 한글 ㄹ 받침, 숫자 1(일)·7(칠)·8(팔)
    private fun endsWithRieul(word: String): Boolean =
        lastReadable(word)?.let { finalConsonantOf(it) == RIEUL || it in RIEUL_DIGITS } ?: false

    /** 마지막 글자의 받침 여부. 한글은 받침을 보고, 숫자는 한국어 읽기(일·삼·육·칠·팔은 받침 있음), 그 밖의 글자는 없음으로 본다. */
    fun hasBatchim(word: String): Boolean {
        val last = lastReadable(word) ?: return false
        finalConsonantOf(last)?.let { return it != 0 }
        return last in BATCHIM_DIGITS
    }

    // ---- 장면별 대사 ----

    fun askPlace(title: String) = "'$title' 어디로 가면 될까요?"

    /** 탑승 인사 둘째 문장 "{시각} {일정}까지 {남은 시간}이에요." */
    fun untilStart(target: Schedule, now: Instant, zone: ZoneId): String =
        "${spokenTime(target.start, zone)} ${target.title}까지 ${iEyo(remaining(Duration.between(now, target.start)))}."

    /** 탑승 인사 첫 문장. 종일 일정이 없으면 쓰지 않는다. */
    fun allDayGreeting(allDayTitle: String) = "$allDayTitle 날이에요!"

    /**
     * 첫 탑승 t-voice와 t-voice-sub. 틀대로 "{종일 일정} 날이에요!"와 "{시각} {일정}까지 …"을 t-voice에 두 줄로 쓰되,
     * 일정 제목이 길어 t-voice가 두 줄을 넘을 것 같으면(대략 계산, [voiceLines]) 남은 시간 문장을 t-voice-sub 앞으로 내린다.
     * 말하는 순서는 어느 쪽이든 같다.
     */
    fun greeting(
        allDayTitle: String?,
        target: Schedule,
        memo: MemoNote,
        now: Instant,
        zone: ZoneId,
    ): Pair<String, String> {
        val until = untilStart(target, now, zone)
        val sub = greetingSub(target, memo)
        if (allDayTitle == null) return until to sub
        val full = "${allDayGreeting(allDayTitle)}\n$until"
        return if (voiceLines(full) <= 2) full to sub else allDayGreeting(allDayTitle) to "$until $sub"
    }

    // t-voice(38px) 한 줄에 들어가는 너비를 한글 한 글자 = 1.0으로 센 값. 실측으로 약 21.8이라 여유를 두고 20으로 본다.
    private const val VOICE_LINE_UNITS = 20.0

    /** t-voice에서 차지할 줄 수를 대략 센다. 줄바꿈("\n")은 새 줄, 한 줄이 넘치면 다음 줄로 본다. */
    fun voiceLines(text: String): Int = text.split('\n').sumOf { line ->
        val units = line.sumOf { c ->
            when {
                c == ' ' -> 0.3
                c.isDigit() -> 0.6
                c in ".,!?:·‘’'" -> 0.35
                c.code < 128 -> 0.65
                else -> 1.0
            }
        }
        kotlin.math.ceil(units / VOICE_LINE_UNITS).toInt().coerceAtLeast(1)
    }

    /** 채비 문장. 메모가 짧으면 채비를 읽고, 길면 메모가 있다고만 하고, 없으면 출발을 묻는다. */
    fun greetingSub(target: Schedule, memo: MemoNote): String = when (memo) {
        is MemoNote.ReadAloud -> "${target.title} 메모에 ‘${memo.text}’${iGaJosa(memo.text)} 있어요. $ASK_DEPART"
        MemoNote.HasMemo -> "${target.title} 메모가 있어요. $ASK_DEPART"
        MemoNote.None -> ASK_DEPART
    }

    /**
     * 늦게 탐: 일정이 몇 시인데 지금 출발하면 몇 시 도착이라고 말한다(이어서 출발 제안과 같은 질문을 한다).
     * 소요 시간을 모르면 도착 시각 대신 이미 지난 시간만 사실대로 말한다.
     */
    fun late(target: Schedule, lateBy: Duration, arrival: Instant?, zone: ZoneId): String {
        val head = "${iGa(target.title)} ${spokenTime(target.start, zone)}인데"
        return if (arrival != null) {
            "$head 지금 출발하면 ${spokenTime(arrival, zone)} 도착이에요."
        } else {
            "$head 이미 ${lateBy.toMinutes()}분 지났어요."
        }
    }

    /** 목적지 묻기(출발까지 1시간 넘게 남음) */
    fun askDestinationPlenty(target: Schedule, departBy: Instant, zone: ZoneId) =
        "$ASK_DESTINATION ${spokenTime(target.start, zone)} ${eunNeun(target.title)} ${spokenTime(departBy, zone)}에 출발하면 돼요."

    // ---- 카드 조립 ----

    /** 화면 문장을 TTS 문장으로. 화면용 줄바꿈만 공백으로 바꾸고 글자는 그대로 쓴다. */
    fun spoken(card: CardContent): String =
        listOfNotNull(card.voice, card.sub, card.footnote)
            .filter { it.isNotEmpty() }
            .joinToString(" ")
            .replace("\n", " ")

    /**
     * 탑승 판단 결과를 카드 한 장으로. [now]는 카드를 띄우는 시각이다.
     * 출발 제안과 늦게 탐은 출발·잠깐만, 목적지 묻기는 후보(있을 때)·그냥 갈게 버튼이다.
     */
    fun card(decision: BoardingDecision.Card, now: Instant, zone: ZoneId): CardContent {
        val briefing = decision.briefing
        val footnote = if (briefing.fromFallback) STALE_SCHEDULE else null
        val base = CardContent(
            status = STATUS_BEFORE_DEPARTURE,
            voice = "",
            footnote = footnote,
            hints = listOf(HINT_SAY_YES, HINT_AUTO_FOLD),
        )
        return when (val q = decision.question) {
            is Question.Depart -> {
                val target = q.target
                val (voice, sub) = greeting(briefing.allDayTitle, target, briefing.memo, now, zone)
                base.copy(
                    voice = voice,
                    sub = sub,
                    tiles = firstBoardingTiles(briefing, zone),
                    primary = ACCEPT_DEPART,
                    secondary = HOLD,
                )
            }
            is Question.DepartLate -> base.copy(
                voice = late(q.target, q.lateBy, q.arrival, zone),
                sub = ASK_DEPART,
                primary = ACCEPT_DEPART,
                secondary = HOLD,
            )
            is Question.AskDestination -> when (q.reason) {
                AskReason.NO_SCHEDULE -> base.copy(
                    voice = ASK_DESTINATION,
                    secondary = JUST_GO,
                    hints = listOf(HINT_SAY_JUST_GO, HINT_AUTO_FOLD),
                )
                AskReason.PLENTY_OF_TIME -> {
                    val target = checkNotNull(q.suggested)
                    val departBy = checkNotNull(q.departBy)
                    base.copy(
                        voice = askDestinationPlenty(target, departBy, zone),
                        tiles = listOf(TileView.PlaceTile(target.place?.name.orEmpty(), "${time(target, zone)} ${target.title}")),
                        primary = ro(target.place?.name.orEmpty()),
                        secondary = JUST_GO,
                    )
                }
                AskReason.PLACE_UNKNOWN -> base.copy(
                    voice = askPlace(q.suggested?.title.orEmpty()),
                    secondary = JUST_GO,
                    hints = listOf(HINT_SAY_JUST_GO, HINT_AUTO_FOLD),
                )
            }
        }
    }

    /** 일정을 불러오지 못했을 때 보이는 카드. 닫기 하나. */
    fun scheduleUnavailableCard() = CardContent(
        status = STATUS_BEFORE_DEPARTURE,
        voice = SCHEDULE_UNAVAILABLE,
        secondary = CLOSE,
        hints = listOf(HINT_AUTO_FOLD),
    )

    /** 첫 탑승 타일: 오늘 일정(최대 3줄, 첫 번째만 다음 일정) + 채비(짧은 메모일 때). */
    private fun firstBoardingTiles(briefing: Briefing, zone: ZoneId): List<TileView> {
        val tiles = mutableListOf<TileView>()
        val rows = briefing.upcoming.take(MAX_TILE_ROWS)
            .mapIndexed { i, s -> TileRow(time(s, zone), s.title, next = i == 0) }
        if (rows.isNotEmpty()) tiles += TileView.Schedules(rows)
        (briefing.memo as? MemoNote.ReadAloud)?.let { tiles += TileView.Care(careItems(it.text)) }
        return tiles
    }

    /** 메모를 채비 태그로 나눈다: '·', ',', '/' 로 끊고, 구분이 없으면 메모 전체가 하나. */
    fun careItems(memo: String): List<String> =
        memo.split('·', ',', '，', '、', '/').map { it.trim() }.filter { it.isNotEmpty() }

    private const val MAX_TILE_ROWS = 3
}
