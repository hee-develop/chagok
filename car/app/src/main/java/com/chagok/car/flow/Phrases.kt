package com.chagok.car.flow

import com.chagok.car.domain.AskReason
import com.chagok.car.domain.Briefing
import com.chagok.car.domain.BoardingDecision
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.MemoNote
import com.chagok.car.domain.Question
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.ui.CandidateRow
import com.chagok.car.ui.CardContent
import com.chagok.car.ui.TileRow
import com.chagok.car.ui.TileView
import java.text.BreakIterator
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
    const val STATUS_BEFORE_EXIT = "도착 · 내리기 전"
    const val STATUS_PAIRING = "휴대폰 연결 전"
    const val PAIRING_VOICE = "휴대폰과 연결해 주세요."
    const val PAIRING_SUB = "휴대폰 차곡 앱에서 QR을 찍거나 번호를 넣어 주세요."

    // 하차 카드(일정 장소). 질문이 없고 한 번 말하고 끝난다.
    const val GOT_IT = "챙겼어요"
    const val EXIT_GREETING = "잘 다녀오세요."

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

    // 목적지 묻기 후보 타일 머리. 일정 없음은 자주 가는 곳만, 여유 많음은 일정 장소와 자주 가는 곳을 함께 보인다.
    const val FAVORITES_LABEL = "자주 가는 곳"
    const val CANDIDATES_LABEL = "갈 곳"

    // 자주 가는 곳 중 집·회사를 부르는 이름
    const val HOME = "집"
    const val WORK = "회사"
    const val DUCKING = "차곡 안내 중 · 볼륨을 잠깐 낮췄어요"

    /** 주행 중 다음 일정 칩(NextChip)의 앞 글자. 뒤에 [nextChipBody]가 붙는다. */
    const val NEXT_CHIP_LABEL = "다음"

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

    /** 주행 중 다음 일정 칩의 본문 "13:00 육전집 점심"(24시간제 시각 + 제목). 화면에는 앞에 [NEXT_CHIP_LABEL]이 붙는다. 도착 예정은 내비 몫이라 넣지 않는다. */
    fun nextChipBody(target: Schedule, zone: ZoneId): String = "${time(target, zone)} ${target.title}"

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
        is MemoNote.Care -> "${careSentence(memo)} $ASK_DEPART"
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

    /** 자주 가는 곳을 부르는 이름: 집·회사는 자리 이름, 나머지는 장소 이름. */
    fun favoriteName(favorite: Favorite): String = when (favorite.kind) {
        FavoriteKind.HOME -> HOME
        FavoriteKind.WORK -> WORK
        FavoriteKind.OTHER -> favorite.place.name
    }

    /** 후보 줄의 둘째 글: 집·회사는 장소 이름, 나머지는 주소. */
    private fun favoriteDetail(favorite: Favorite): String = when (favorite.kind) {
        FavoriteKind.HOME, FavoriteKind.WORK -> favorite.place.name
        FavoriteKind.OTHER -> favorite.address.orEmpty()
    }

    /**
     * 목적지 묻기 후보 이름. 화면 줄·주 버튼·음성 고르기에 같이 쓰고, 순서는 [Question.AskDestination.candidates]와 같다.
     * 여유 많음은 일정 장소 이름이 1번이다.
     */
    fun candidateNames(question: Question.AskDestination): List<String> = when (question.reason) {
        AskReason.PLENTY_OF_TIME -> listOfNotNull(question.suggested?.place?.name) + question.favorites.map(::favoriteName)
        AskReason.NO_SCHEDULE -> question.favorites.map(::favoriteName)
        AskReason.PLACE_UNKNOWN -> emptyList()
    }

    private fun favoriteRows(favorites: List<Favorite>) = favorites.map { CandidateRow(favoriteName(it), favoriteDetail(it)) }

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
                    tiles = boardingTiles(briefing, zone),
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
                // 자주 가는 곳이 없으면 후보 없이 묻는다("응"으로는 고를 곳이 없다).
                AskReason.NO_SCHEDULE -> if (q.favorites.isEmpty()) {
                    base.copy(
                        voice = ASK_DESTINATION,
                        secondary = JUST_GO,
                        hints = listOf(HINT_SAY_JUST_GO, HINT_AUTO_FOLD),
                    )
                } else {
                    base.copy(
                        voice = ASK_DESTINATION,
                        tiles = listOf(TileView.Candidates(FAVORITES_LABEL, favoriteRows(q.favorites))),
                        primary = ro(candidateNames(q).first()),
                        secondary = JUST_GO,
                    )
                }
                AskReason.PLENTY_OF_TIME -> {
                    val target = checkNotNull(q.suggested)
                    val departBy = checkNotNull(q.departBy)
                    val name = target.place?.name.orEmpty()
                    val line = "${time(target, zone)} ${target.title}"
                    // 자주 가는 곳이 붙으면 일정 장소를 1번 줄로 둔 후보 목록, 아니면 일정 장소 타일 하나
                    val tile = if (q.favorites.isEmpty()) {
                        TileView.PlaceTile(name, line)
                    } else {
                        TileView.Candidates(CANDIDATES_LABEL, listOf(CandidateRow(name, line)) + favoriteRows(q.favorites))
                    }
                    base.copy(
                        voice = askDestinationPlenty(target, departBy, zone),
                        tiles = listOf(tile),
                        primary = ro(name),
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

    /**
     * 하차 카드(정책서 4·6·9장, 시안 Arrive): 일정 장소에 도착해 P단에 넣었을 때 한 번 말하고 [timeout](기본 [Rules.EXIT_CARD]) 뒤 닫힌다. 질문은 없다.
     * 읽을 글은 앱 채비가 있으면 그것, 없으면 일정 메모다([MemoNote.forExit]). 문구의 "메모"는 앱 채비일 때 "채비"가 된다. 글을 이렇게 가른다(사용자 결정 2026-11-11).
     * - 챙길 것 목록: '·' ',' '/'로 나뉜 항목이 둘 이상이거나 띄어쓰기 없는 짧은 말(한 단어)이면 "유니폼·응원봉·티켓 챙기세요!" + 채비 타일 + 한 줄 + [챙겼어요]
     * - 문장형(예 '주차는 B2', '3루 출입구에서 만나기'): 챙길 것이라 단정하지 않고 탑승 카드와 같은 "{일정} 메모에 ‘…’가 있어요." + [챙겼어요](타일 없음)
     * - 길거나 여러 줄: "{일정} 메모가 있어요." + [챙겼어요]
     * - 글이 없거나 항목이 모두 비면('·'만 등): 인사 "잘 다녀오세요."(alert 한 문장, 버튼 없음)
     * 큰 문구는 두 줄까지라 제목은 [shortTitle]로 줄인다. 오늘 요약 줄(주행 거리·충전·내비 조작)은 두지 않는다.
     * 말은 [spoken] 대신 [exitSpoken]을 쓴다(한 줄은 화면에서 읽는 보조 정보다).
     */
    fun exitCard(schedule: Schedule, timeout: Duration = Rules.EXIT_CARD): CardContent {
        val base = CardContent(
            status = STATUS_BEFORE_EXIT,
            voice = "",
            hints = listOf(exitAutoCloseHint(timeout)),
            autoDismiss = timeout,
            fixedHeight = false,
        )
        val title = shortTitle(schedule.title)
        return when (val text = exitText(schedule)) {
            ExitText.Greeting -> base.copy(voice = EXIT_GREETING, alert = true)
            is ExitText.Has -> base.copy(voice = "$title ${text.noun}가 있어요.", primary = GOT_IT)
            is ExitText.Items -> base.copy(
                voice = "${text.items.joinToString("·")} 챙기세요!",
                tiles = listOf(TileView.Care(text.items)),
                footnote = "‘$title’ 일정 ${text.noun}: ${text.raw}",
                primary = GOT_IT,
            )
            is ExitText.Sentence -> base.copy(voice = "$title ${text.noun}에 ‘${text.raw}’${iGaJosa(text.raw)} 있어요.", primary = GOT_IT)
        }
    }

    /** 하차 카드가 읽을 글의 갈래. [noun]은 메모 출처면 "메모", 앱 채비 출처면 "채비". */
    private sealed interface ExitText {
        data object Greeting : ExitText
        data class Has(val noun: String) : ExitText
        data class Items(val items: List<String>, val raw: String, val noun: String) : ExitText
        data class Sentence(val raw: String, val noun: String) : ExitText
    }

    private fun exitText(schedule: Schedule): ExitText {
        val exitNote = MemoNote.forExit(schedule)
        val noun = if (exitNote.fromCare) "채비" else "메모"
        return when (val memo = exitNote.note) {
            MemoNote.None -> ExitText.Greeting
            MemoNote.HasMemo -> ExitText.Has(noun)
            is MemoNote.ReadAloud -> {
                // 항목 끝의 문장부호('우산!')는 떼고 판정·표시한다. 문장부호만 있던 항목은 빈 항목이다.
                val items = careItems(memo.text).map { it.trimEnd(*TRAILING_PUNCTUATION) }.filter { it.isNotEmpty() }
                when {
                    items.isEmpty() -> ExitText.Greeting
                    // 링크·시각 꼴('meet.google.com/abc', '10:30/11:00')은 '/'로 나뉘어도 챙길 것 목록이 아니다.
                    // 숫자가 든 한 단어('010-1234-5678', 'B2-15', '301호')는 번호·코드라 챙길 것으로 보지 않는다(구분자로 나뉜 둘 이상은 목록).
                    !looksLikeLinkOrTime(memo.text) &&
                        (items.size >= 2 || items.single().none { it.isWhitespace() || it.isDigit() }) ->
                        ExitText.Items(items, memo.text, noun)
                    else -> ExitText.Sentence(memo.text, noun)
                }
            }
            is MemoNote.Care -> error("MemoNote.forExit는 Care를 돌려주지 않는다")
        }
    }

    /**
     * 하차 카드에서 말하는 문장. 화면 큰 문구와 같되 제목은 줄이지 않은 전체 제목이고(탑승 문구와 같게) TTS가 따옴표를 읽지 않게 ‘ ’는 뺀다.
     * 카드는 5초 뒤 닫히고 말은 닫힐 때 멈추므로 말할 문장은 [Rules.MEMO_READ_MAX_CHARS]자(탑승 브리핑이 채비를 읽는 한계와 같은 상수) 안이어야 한다.
     * 넘으면 앞에서부터 차례로 더 짧은 문장을 고른다. 항목은 화면에 남는다.
     * - 목록: 항목을 읽는 문장 → "{일정} 챙길 것이 있어요."(앱 채비 출처면 "{일정} 채비가 있어요.")
     * - 문장형: 메모를 읽는 문장 → "{일정} 메모가 있어요."(앱 채비 출처면 "{일정} 채비가 있어요.")
     * - 마지막 문장도 넘으면 제목을 [shortTitle]로 줄인 같은 문장(그래도 넘으면 그대로 말한다)
     */
    fun exitSpoken(schedule: Schedule): String {
        val text = exitText(schedule)
        if (text == ExitText.Greeting) return EXIT_GREETING
        val full = schedule.title
        val short = shortTitle(full)
        fun candidates(title: String): List<String> = when (text) {
            ExitText.Greeting -> emptyList()
            is ExitText.Has -> listOf("$title ${text.noun}가 있어요.")
            is ExitText.Items -> listOf(
                "${text.items.joinToString("·")} 챙기세요!",
                if (text.noun == "채비") "$title 채비가 있어요." else "$title 챙길 것이 있어요.",
            )
            is ExitText.Sentence -> listOf(
                "$title ${text.noun}에 ${text.raw}${iGaJosa(text.raw)} 있어요.",
                "$title ${text.noun}가 있어요.",
            )
        }
        val ordered = candidates(full) + candidates(short).takeLast(1)
        return ordered.firstOrNull { it.length <= Rules.MEMO_READ_MAX_CHARS } ?: ordered.last()
    }

    /** 메모가 URL이나 시각 꼴을 담았는가. 그러면 '·' ',' '/' 로 나뉘어도 챙길 것 목록으로 보지 않는다. */
    fun looksLikeLinkOrTime(memo: String): Boolean = LINK_OR_TIME.containsMatchIn(memo)

    /** 하차 카드 힌트 "5초 뒤 자동으로 닫혀요". 시간은 카드의 닫힘 시간에서 가져온다. */
    fun exitAutoCloseHint(timeout: Duration) = "${timeout.seconds}초 뒤 자동으로 닫혀요"

    /**
     * 큰 문구에 넣는 제목. 사람이 한 글자로 읽는 단위(자소 묶음)로 [max]자를 넘으면 앞 (max-1)자 + '…'로 줄여 문구가 두 줄 안에 들게 한다.
     * 코드포인트가 아니라 [BreakIterator] 글자 경계로 자르므로 ZWJ 이모지·변형 선택자·결합 문자를 가르지 않는다.
     */
    fun shortTitle(title: String, max: Int = TITLE_MAX): String {
        val boundaries = BreakIterator.getCharacterInstance()
        boundaries.setText(title)
        var count = 0
        var cut = 0
        var next = boundaries.next()
        while (next != BreakIterator.DONE) {
            count++
            if (count == max - 1) cut = next
            next = boundaries.next()
        }
        return if (count <= max) title else title.substring(0, cut).trimEnd() + "…"
    }

    /** 일정을 불러오지 못했을 때 보이는 카드. 닫기 하나. */
    /**
     * 휴대폰과 연결하기 전 카드. QR과 숫자 6자리를 보이고 말하지 않는다. 버튼은 없다(연결되면 접힌다).
     * 숫자는 세 자리씩 띄워 읽기 쉽게 한다.
     */
    fun pairingCard(code: String, qr: String) = CardContent(
        status = STATUS_PAIRING,
        voice = PAIRING_VOICE,
        sub = PAIRING_SUB,
        tiles = listOf(TileView.Pairing(qr = qr, code = if (code.length == 6) "${code.take(3)} ${code.drop(3)}" else code)),
    )

    fun scheduleUnavailableCard() = CardContent(
        status = STATUS_BEFORE_DEPARTURE,
        voice = SCHEDULE_UNAVAILABLE,
        secondary = CLOSE,
        hints = listOf(HINT_AUTO_FOLD),
    )

    /**
     * 출발 제안 카드의 타일. 첫 탑승은 오늘 일정(최대 3줄, 첫 번째만 다음 일정) + 채비(짧은 메모·앱 채비),
     * 재탑승(대상 일정 한 줄, 5장)은 채비만 둔다.
     */
    private fun boardingTiles(briefing: Briefing, zone: ZoneId): List<TileView> {
        val tiles = mutableListOf<TileView>()
        if (briefing.level == Briefing.Level.FULL) {
            val rows = briefing.upcoming.take(MAX_TILE_ROWS)
                .mapIndexed { i, s -> TileRow(time(s, zone), s.title, next = i == 0) }
            if (rows.isNotEmpty()) tiles += TileView.Schedules(rows)
        }
        when (val memo = briefing.memo) {
            is MemoNote.ReadAloud -> tiles += TileView.Care(careItems(memo.text))
            is MemoNote.Care -> tiles += TileView.Care(careItems(careText(memo)).distinct())
            MemoNote.HasMemo, MemoNote.None -> Unit
        }
        return tiles
    }

    /** 앱 채비를 이어 붙인 글. 일정마다의 채비를 '·'로 잇는다. */
    private fun careText(care: MemoNote.Care) = care.items.joinToString("·") { it.text }

    /**
     * 앱 채비 문장. 한 일정이면 "{일정} 채비는 ‘…’이에요.", 여러 일정이면 "오늘 채비는 ‘…’이에요."
     * 읽을 글이 30자([Rules.MEMO_READ_MAX_CHARS])를 넘으면 있다고만 말하고 항목은 채비 타일에 둔다.
     */
    fun careSentence(care: MemoNote.Care): String {
        val text = careText(care)
        val single = care.items.singleOrNull()
        val short = text.length <= Rules.MEMO_READ_MAX_CHARS
        return when {
            single != null && short -> "${single.title} 채비는 ${iEyo("‘$text’")}."
            single != null -> "${single.title} 채비가 있어요."
            short -> "오늘 채비는 ${iEyo("‘$text’")}."
            else -> "오늘 챙길 채비가 있어요."
        }
    }

    /** 메모를 채비 태그로 나눈다: '·', ',', '/' 로 끊고, 구분이 없으면 메모 전체가 하나. */
    fun careItems(memo: String): List<String> =
        memo.split('·', ',', '，', '、', '/').map { it.trim() }.filter { it.isNotEmpty() }

    private const val MAX_TILE_ROWS = 3

    /** 큰 문구에 넣는 제목의 최대 글자 수 */
    private const val TITLE_MAX = 12

    /**
     * 링크·시각 꼴: 시각(10:30), 주소 머리(https://, www.), 도메인(끝이 알파벳 TLD: naver.com, a.co.kr, meet.google.com/abc).
     * '1.5L/우산'의 '1.5L'처럼 끝이 숫자·단위인 꼴은 도메인이 아니다.
     */
    private val LINK_OR_TIME = Regex("""\d{1,2}:\d{2}|https?://|www\.|(?<![A-Za-z0-9-])([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![A-Za-z0-9-])""", RegexOption.IGNORE_CASE)

    /** 하차 카드 항목 끝에서 떼는 문장부호 */
    private val TRAILING_PUNCTUATION = charArrayOf('!', '?', '.', '…', '~', '！', '？', '。')
}
