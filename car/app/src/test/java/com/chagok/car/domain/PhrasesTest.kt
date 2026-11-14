package com.chagok.car.domain

import com.chagok.car.flow.Phrases
import com.chagok.car.ui.CandidateRow
import com.chagok.car.ui.TileRow
import com.chagok.car.ui.TileView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration

class PhrasesTest {
    private fun sched(id: String, title: String, start: String, place: String? = null, memo: String? = null) = Schedule(
        id, title, at(start), at(start) + Duration.ofHours(1),
        place = place?.let { Place(it, LatLng(0.0, 0.0)) }, memo = memo,
    )

    private fun briefing(
        level: Briefing.Level,
        target: Schedule?,
        upcoming: List<Schedule> = listOfNotNull(target),
        allDay: String? = null,
        memo: MemoNote = MemoNote.None,
        fallback: Boolean = false,
    ) = Briefing(level, target, upcoming.size, upcoming, allDay, memo, fallback)

    private fun card(b: Briefing, q: Question, now: String) = Phrases.card(BoardingDecision.Card(b, q), at(now), SEOUL)

    private val lunch = sched("l", "육전집 점심", "13:00", place = "광주 육전집", memo = "유니폼·응원봉·티켓")
    private val game = sched("g", "KIA 직관", "17:00", place = "광주-기아 챔피언스필드")
    private val pickup = sched("p", "콩물 픽업", "21:00", place = "단골 콩물집")

    @Test fun `제목 조사는 받침에 따라 이에요 또는 예요`() {
        assertEquals("고객 미팅이에요", Phrases.iEyo("고객 미팅"))
        assertEquals("치과예요", Phrases.iEyo("치과"))
        assertEquals("점심 약속이에요", Phrases.iEyo("점심 약속"))
        assertEquals("회의 2예요", Phrases.iEyo("회의 2"))
        assertEquals("1차 회의예요", Phrases.iEyo("1차 회의"))
        assertEquals("스프린트 3이에요", Phrases.iEyo("스프린트 3"))
        // ㄹ 받침도 받침이다
        assertEquals("달이에요", Phrases.iEyo("달"))
    }

    @Test fun `이와 가는 받침에 따라 고른다`() {
        assertEquals("티켓이", Phrases.iGa("티켓"))
        assertEquals("육전집 점심이", Phrases.iGa("육전집 점심"))
        assertEquals("티셔츠가", Phrases.iGa("티셔츠"))
        assertEquals("치과가", Phrases.iGa("치과"))
        assertEquals("KIA 직관이", Phrases.iGa("KIA 직관"))
        assertEquals("회의 2가", Phrases.iGa("회의 2"))
    }

    @Test fun `으로와 로는 받침이 있으면 으로 ㄹ 받침과 없으면 로`() {
        assertEquals("강남역으로", Phrases.ro("강남역"))
        assertEquals("광주 육전집으로", Phrases.ro("광주 육전집"))
        assertEquals("서울대로", Phrases.ro("서울대"))
        assertEquals("성수동으로", Phrases.ro("성수동"))
        assertEquals("서울숲 근처 달로", Phrases.ro("서울숲 근처 달"))
        assertEquals("챔피언스필드로", Phrases.ro("챔피언스필드"))
        assertEquals("7로", Phrases.ro("7"))
        assertEquals("1로", Phrases.ro("1"))
        assertEquals("8로", Phrases.ro("8"))
        assertEquals("3으로", Phrases.ro("3"))
    }

    @Test fun `말하는 시각은 12시간제이고 오전 오후가 없다`() {
        assertEquals("1시", Phrases.spokenTime(at("13:00"), SEOUL))
        assertEquals("2시 40분", Phrases.spokenTime(at("14:40"), SEOUL))
        assertEquals("12시", Phrases.spokenTime(at("12:00"), SEOUL))
        assertEquals("12시 5분", Phrases.spokenTime(at("00:05"), SEOUL))
        assertEquals("11시 30분", Phrases.spokenTime(at("23:30"), SEOUL))
        assertEquals("5시", Phrases.spokenTime(at("05:00"), SEOUL))
    }

    @Test fun `타일 시각은 24시간제`() {
        assertEquals("13:00", Phrases.time(lunch, SEOUL))
        assertEquals("21:00", Phrases.time(pickup, SEOUL))
    }

    @Test fun `남은 시간 표기`() {
        assertEquals("3시간 40분", Phrases.remaining(Duration.ofMinutes(220)))
        assertEquals("1시간", Phrases.remaining(Duration.ofMinutes(60)))
        assertEquals("45분", Phrases.remaining(Duration.ofMinutes(45)))
        assertEquals("2시간 5분", Phrases.remaining(Duration.ofMinutes(125)))
        // 초는 반올림
        assertEquals("40분", Phrases.remaining(Duration.ofSeconds(40 * 60 - 20)))
        assertEquals("0분", Phrases.remaining(Duration.ofMinutes(-3)))
    }

    @Test fun `첫 탑승 카드는 인사와 채비 문장과 두 타일과 버튼을 가진다`() {
        val b = briefing(Briefing.Level.FULL, lunch, listOf(lunch, game, pickup), allDay = "광주 직관", memo = MemoNote.ReadAloud("유니폼·응원봉·티켓"))
        val c = card(b, Question.Depart(lunch), "09:20")
        assertEquals("광주 직관 날이에요!\n1시 육전집 점심까지 3시간 40분이에요.", c.voice)
        assertEquals("육전집 점심 메모에 ‘유니폼·응원봉·티켓’이 있어요. 출발할까요?", c.sub)
        assertEquals("정차 중 · 출발 전", c.status)
        assertEquals(
            listOf(
                TileView.Schedules(listOf(TileRow("13:00", "육전집 점심", true), TileRow("17:00", "KIA 직관", false), TileRow("21:00", "콩물 픽업", false))),
                TileView.Care(listOf("유니폼", "응원봉", "티켓")),
            ),
            c.tiles,
        )
        assertEquals("응, 출발", c.primary)
        assertEquals("잠깐만", c.secondary)
        assertEquals(listOf("“응”이라고 말해도 돼요", "출발하면 자동으로 접혀요"), c.hints)
        // 화면 문장과 TTS 문장은 같다(화면용 줄바꿈만 공백)
        assertEquals("광주 직관 날이에요! 1시 육전집 점심까지 3시간 40분이에요. 육전집 점심 메모에 ‘유니폼·응원봉·티켓’이 있어요. 출발할까요?", Phrases.spoken(c))
    }

    @Test fun `카드에는 질문이 하나이고 출발 제안은 출발할까요로 끝난다`() {
        val withMemo = card(briefing(Briefing.Level.FULL, lunch, allDay = "광주 직관", memo = MemoNote.ReadAloud("유니폼·응원봉·티켓")), Question.Depart(lunch), "09:20")
        val long = card(briefing(Briefing.Level.FULL, lunch, memo = MemoNote.HasMemo), Question.Depart(lunch), "09:20")
        val none = card(briefing(Briefing.Level.FULL, lunch), Question.Depart(lunch), "09:20")
        val late = card(briefing(Briefing.Level.ONE_LINE, lunch), Question.DepartLate(lunch, Duration.ofMinutes(20), at("13:20")), "13:00")
        listOf(withMemo, long, none, late).forEach {
            assertEquals(Phrases.spoken(it), 1, Phrases.spoken(it).count { c -> c == '?' })
            assertTrue(Phrases.spoken(it), Phrases.spoken(it).endsWith("출발할까요?"))
        }
        val ask = card(briefing(Briefing.Level.FULL, lunch, memo = MemoNote.ReadAloud("유니폼")), Question.AskDestination(AskReason.PLENTY_OF_TIME, lunch, at("12:50")), "09:00")
        assertEquals(Phrases.spoken(ask), 1, Phrases.spoken(ask).count { c -> c == '?' })
    }

    @Test fun `종일 일정이 없으면 인사 첫 문장을 뺀다`() {
        val c = card(briefing(Briefing.Level.FULL, lunch), Question.Depart(lunch), "09:20")
        assertEquals("1시 육전집 점심까지 3시간 40분이에요.", c.voice)
    }

    @Test fun `메모가 길면 메모가 있다고만 하고 없으면 출발을 묻는다`() {
        val long = card(briefing(Briefing.Level.FULL, lunch, memo = MemoNote.HasMemo), Question.Depart(lunch), "09:20")
        assertEquals("육전집 점심 메모가 있어요. 출발할까요?", long.sub)
        assertEquals(1, long.tiles.size)
        val none = card(briefing(Briefing.Level.FULL, lunch), Question.Depart(lunch), "09:20")
        assertEquals("출발할까요?", none.sub)
    }

    @Test fun `메모의 채비 조사는 받침에 맞춘다`() {
        val shirt = sched("s", "야구장", "13:00", memo = "티셔츠")
        val c = card(briefing(Briefing.Level.FULL, shirt, memo = MemoNote.ReadAloud("티셔츠")), Question.Depart(shirt), "09:20")
        assertEquals("야구장 메모에 ‘티셔츠’가 있어요. 출발할까요?", c.sub)
    }

    @Test fun `제목이 길어 t-voice가 두 줄을 넘으면 남은 시간 문장을 sub로 내린다`() {
        val long = sched("x", "광주 챔피언스필드 개막전 응원", "13:00", place = "챔필")
        val b = briefing(Briefing.Level.FULL, long, allDay = "광주 직관", memo = MemoNote.None)
        val c = card(b, Question.Depart(long), "09:20")
        assertEquals("광주 직관 날이에요!", c.voice)
        assertEquals("1시 광주 챔피언스필드 개막전 응원까지 3시간 40분이에요. 출발할까요?", c.sub)
        // 말하는 순서는 틀과 같다
        assertEquals("광주 직관 날이에요! 1시 광주 챔피언스필드 개막전 응원까지 3시간 40분이에요. 출발할까요?", Phrases.spoken(c))
        // 짧은 제목은 틀대로 t-voice에 둔다
        assertTrue(Phrases.voiceLines("광주 직관 날이에요!\n1시 육전집 점심까지 3시간 40분이에요.") <= 2)
        assertTrue(Phrases.voiceLines("광주 직관 날이에요!\n1시 광주 챔피언스필드 개막전 응원까지 3시간 40분이에요.") > 2)
    }

    @Test fun `늦게 탐은 늦는다고 말한 뒤 출발 제안과 같은 질문과 버튼을 둔다`() {
        val c = card(briefing(Briefing.Level.ONE_LINE, lunch), Question.DepartLate(lunch, Duration.ofMinutes(20), at("13:20")), "13:00")
        assertEquals("육전집 점심이 1시인데 지금 출발하면 1시 20분 도착이에요.", c.voice)
        assertEquals("출발할까요?", c.sub)
        assertEquals("응, 출발", c.primary)
        assertEquals("잠깐만", c.secondary)
        assertEquals(listOf("“응”이라고 말해도 돼요", "출발하면 자동으로 접혀요"), c.hints)
        assertEquals("육전집 점심이 1시인데 지금 출발하면 1시 20분 도착이에요. 출발할까요?", Phrases.spoken(c))
    }

    @Test fun `늦게 탐 소요 시간을 모르면 이미 지난 시간만 말한다`() {
        val c = card(briefing(Briefing.Level.ONE_LINE, lunch), Question.DepartLate(lunch, Duration.ofMinutes(12)), "13:12")
        assertEquals("육전집 점심이 1시인데 이미 12분 지났어요.", c.voice)
        val shirt = sched("s", "치과", "13:00")
        assertEquals("치과가 1시인데 이미 7분 지났어요.", card(briefing(Briefing.Level.ONE_LINE, shirt), Question.DepartLate(shirt, Duration.ofMinutes(7)), "13:07").voice)
    }

    @Test fun `목적지 묻기 일정 없음은 그냥 갈게 하나만 둔다`() {
        val c = card(briefing(Briefing.Level.FULL, null, emptyList()), Question.AskDestination(AskReason.NO_SCHEDULE), "09:00")
        assertEquals("어디로 갈까요?", c.voice)
        assertNull(c.primary)
        assertEquals("그냥 갈게", c.secondary)
        assertTrue(c.tiles.isEmpty())
        assertEquals(listOf("“그냥 갈게”라고 말해도 돼요", "출발하면 자동으로 접혀요"), c.hints)
    }

    @Test fun `목적지 묻기 1시간 넘게 남음은 출발 시각과 장소 타일과 장소 버튼`() {
        val meeting = sched("m", "육전집 점심", "13:30", place = "광주 육전집")
        val c = card(briefing(Briefing.Level.FULL, meeting), Question.AskDestination(AskReason.PLENTY_OF_TIME, meeting, at("12:50")), "09:00")
        assertEquals("어디로 갈까요? 1시 30분 육전집 점심은 12시 50분에 출발하면 돼요.", c.voice)
        assertEquals(listOf<TileView>(TileView.PlaceTile("광주 육전집", "13:30 육전집 점심")), c.tiles)
        assertEquals("광주 육전집으로", c.primary)
        assertEquals("그냥 갈게", c.secondary)
    }

    @Test fun `목적지 묻기 장소 없음`() {
        val noPlace = sched("c", "치과", "13:00")
        val c = card(briefing(Briefing.Level.FULL, noPlace), Question.AskDestination(AskReason.PLACE_UNKNOWN, noPlace), "12:30")
        assertEquals("'치과' 어디로 가면 될까요?", c.voice)
        assertNull(c.primary)
        assertEquals("그냥 갈게", c.secondary)
    }

    @Test fun `일정을 새로 못 받으면 한 줄을 붙인다`() {
        val c = card(briefing(Briefing.Level.ONE_LINE, game, fallback = true), Question.Depart(game), "14:00")
        assertEquals("서버에 연결하지 못해 마지막으로 받은 일정 기준이에요.", c.footnote)
        assertTrue(Phrases.spoken(c).endsWith("서버에 연결하지 못해 마지막으로 받은 일정 기준이에요."))
        assertNull(card(briefing(Briefing.Level.ONE_LINE, game), Question.Depart(game), "14:00").footnote)
    }

    @Test fun `채비 태그는 가운뎃점 쉼표 슬래시로 나눈다`() {
        assertEquals(listOf("유니폼", "응원봉", "티켓"), Phrases.careItems("유니폼·응원봉·티켓"))
        assertEquals(listOf("우산", "지갑"), Phrases.careItems("우산, 지갑"))
        assertEquals(listOf("도시락"), Phrases.careItems("도시락"))
    }

    private val home = Favorite(FavoriteKind.HOME, Place("예시 아파트 101동", LatLng(0.0, 0.0)))
    private val work = Favorite(FavoriteKind.WORK, Place("광주 예시 업무지구", LatLng(0.0, 0.0)))
    private val station = Favorite(FavoriteKind.OTHER, Place("광주송정역", LatLng(0.0, 0.0)), "광주 광산구 상무대로 201")

    @Test fun `일정 없음에 자주 가는 곳이 있으면 후보 타일과 1번 후보 버튼`() {
        val q = Question.AskDestination(AskReason.NO_SCHEDULE, favorites = listOf(home, work, station))
        val c = card(briefing(Briefing.Level.FULL, null, emptyList()), q, "09:00")
        assertEquals("어디로 갈까요?", c.voice)
        val rows = listOf(CandidateRow("집", "예시 아파트 101동"), CandidateRow("회사", "광주 예시 업무지구"), CandidateRow("광주송정역", "광주 광산구 상무대로 201"))
        assertEquals(listOf<TileView>(TileView.Candidates("자주 가는 곳", rows)), c.tiles)
        assertEquals("집으로", c.primary)
        assertEquals("그냥 갈게", c.secondary)
        assertEquals(listOf("“응”이라고 말해도 돼요", "출발하면 자동으로 접혀요"), c.hints)
        assertEquals(listOf("집", "회사", "광주송정역"), Phrases.candidateNames(q))
    }

    @Test fun `여유가 많을 때 자주 가는 곳이 붙으면 일정 장소를 1번 줄로 둔 후보 타일`() {
        val meeting = sched("m", "육전집 점심", "13:30", place = "광주 육전집")
        val q = Question.AskDestination(AskReason.PLENTY_OF_TIME, meeting, at("12:50"), listOf(work))
        val c = card(briefing(Briefing.Level.FULL, meeting), q, "09:00")
        assertEquals("어디로 갈까요? 1시 30분 육전집 점심은 12시 50분에 출발하면 돼요.", c.voice)
        val rows = listOf(CandidateRow("광주 육전집", "13:30 육전집 점심"), CandidateRow("회사", "광주 예시 업무지구"))
        assertEquals(listOf<TileView>(TileView.Candidates("갈 곳", rows)), c.tiles)
        assertEquals("광주 육전집으로", c.primary)
        assertEquals(listOf("광주 육전집", "회사"), Phrases.candidateNames(q))
        assertEquals(q.candidates.size, Phrases.candidateNames(q).size)
    }

    @Test fun `대안으로 한 곳만 보일 때는 그 후보를 묻고 후보 이름도 그 하나다`() {
        val all = Question.AskDestination(AskReason.NO_SCHEDULE, favorites = listOf(home, work, station))
        val alt = checkNotNull(all.nextAlternative())
        val c = card(briefing(Briefing.Level.FULL, null, emptyList()), alt, "09:00")
        assertEquals("회사로 갈까요?", c.voice)
        assertEquals(listOf<TileView>(TileView.Candidates("자주 가는 곳", listOf(CandidateRow("회사", "광주 예시 업무지구")))), c.tiles)
        assertEquals("회사로", c.primary)
        assertEquals("그냥 갈게", c.secondary)
        assertEquals(listOf("회사"), Phrases.candidateNames(alt))
        assertEquals(listOf(work.place), alt.candidates)
        assertEquals("광주송정역으로 갈까요?", card(briefing(Briefing.Level.FULL, null, emptyList()), checkNotNull(alt.nextAlternative()), "09:00").voice)
        // 마지막 후보 뒤에는 없다.
        assertNull(alt.nextAlternative()?.nextAlternative())
    }

    @Test fun `여유 많음의 대안은 일정 장소 다음 후보부터이고 일정 장소 말은 다시 하지 않는다`() {
        val meeting = sched("m", "육전집 점심", "13:30", place = "광주 육전집")
        val q = Question.AskDestination(AskReason.PLENTY_OF_TIME, meeting, at("12:50"), listOf(work, station))
        val alt = checkNotNull(q.nextAlternative())
        val c = card(briefing(Briefing.Level.FULL, meeting), alt, "09:00")
        assertEquals("회사로 갈까요?", c.voice)
        assertEquals(listOf<TileView>(TileView.Candidates("갈 곳", listOf(CandidateRow("회사", "광주 예시 업무지구")))), c.tiles)
        assertEquals("회사로", c.primary)
    }

    @Test fun `후보가 하나이거나 없거나 장소 모름은 대안이 없다`() {
        assertNull(Question.AskDestination(AskReason.NO_SCHEDULE, favorites = listOf(home)).nextAlternative())
        assertNull(Question.AskDestination(AskReason.NO_SCHEDULE).nextAlternative())
        assertNull(Question.AskDestination(AskReason.PLACE_UNKNOWN, sched("c", "치과", "13:00"), favorites = listOf(home)).nextAlternative())
        val meeting = sched("m", "육전집 점심", "13:30", place = "광주 육전집")
        assertNull(Question.AskDestination(AskReason.PLENTY_OF_TIME, meeting, at("12:50")).nextAlternative())
    }

    @Test fun `장소 모름은 후보 이름이 없다`() {
        val noPlace = sched("c", "치과", "13:00")
        assertEquals(emptyList<String>(), Phrases.candidateNames(Question.AskDestination(AskReason.PLACE_UNKNOWN, noPlace, favorites = listOf(home))))
    }

    // ---- 앱에서 적은 채비 ----

    private fun careCard(vararg items: CareItem) =
        card(briefing(Briefing.Level.FULL, lunch, memo = MemoNote.Care(items.toList())), Question.Depart(lunch), "09:20")

    @Test fun `한 일정의 짧은 채비는 그대로 읽고 채비 타일에 둔다`() {
        val c = careCard(CareItem("KIA 직관", "유니폼·응원봉·티켓"))
        assertEquals("KIA 직관 채비는 ‘유니폼·응원봉·티켓’이에요. 출발할까요?", c.sub)
        assertTrue(TileView.Care(listOf("유니폼", "응원봉", "티켓")) in c.tiles)
    }

    @Test fun `채비 조사는 받침에 맞춘다`() {
        assertEquals("KIA 직관 채비는 ‘우산’이에요. 출발할까요?", careCard(CareItem("KIA 직관", "우산")).sub)
        assertEquals("KIA 직관 채비는 ‘보조배터리’예요. 출발할까요?", careCard(CareItem("KIA 직관", "보조배터리")).sub)
    }

    @Test fun `여러 일정의 채비는 오늘 채비로 묶고 같은 항목은 한 번만 태그로 둔다`() {
        val c = careCard(CareItem("KIA 직관", "유니폼·티켓"), CareItem("콩물 픽업", "보냉백·티켓"))
        assertEquals("오늘 채비는 ‘유니폼·티켓·보냉백·티켓’이에요. 출발할까요?", c.sub)
        assertTrue(TileView.Care(listOf("유니폼", "티켓", "보냉백")) in c.tiles)
    }

    @Test fun `채비가 30자를 넘으면 있다고만 말하고 항목은 타일에 둔다`() {
        val long = "가".repeat(31)
        assertEquals("KIA 직관 채비가 있어요. 출발할까요?", careCard(CareItem("KIA 직관", long)).sub)
        assertEquals("오늘 챙길 채비가 있어요. 출발할까요?", careCard(CareItem("KIA 직관", "가".repeat(20)), CareItem("콩물 픽업", "나".repeat(11))).sub)
        assertTrue(careCard(CareItem("KIA 직관", long)).tiles.any { it is TileView.Care })
    }

    @Test fun `재탑승 출발 제안은 대상 일정 한 줄이고 오늘 일정 타일 없이 채비만 둔다`() {
        val oneLine = card(briefing(Briefing.Level.ONE_LINE, game), Question.Depart(game), "14:00")
        assertEquals("5시 KIA 직관까지 3시간이에요.", oneLine.voice)
        assertEquals("출발할까요?", oneLine.sub)
        assertTrue(oneLine.tiles.isEmpty())
        val withCare = card(briefing(Briefing.Level.ONE_LINE, game, memo = MemoNote.Care(listOf(CareItem("KIA 직관", "유니폼·티켓")))), Question.Depart(game), "14:00")
        assertEquals("KIA 직관 채비는 ‘유니폼·티켓’이에요. 출발할까요?", withCare.sub)
        assertEquals(listOf<TileView>(TileView.Care(listOf("유니폼", "티켓"))), withCare.tiles)
    }

    @Test fun `주행 중 칩은 24시간제 시각과 제목이고 앞 글자는 다음이다`() {
        assertEquals("13:00 육전집 점심", Phrases.nextChipBody(lunch, SEOUL))
        assertEquals("17:00 KIA 직관", Phrases.nextChipBody(game, SEOUL))
        assertEquals("다음", Phrases.NEXT_CHIP_LABEL)
    }

    // ---- 하차 카드(일정 장소) ----

    private fun exitSched(title: String = "KIA 직관", memo: String? = null, care: String? = null) =
        Schedule("x", title, at("17:00"), at("19:00"), place = OFFICE, memo = memo, care = care)

    private fun exit(title: String = "KIA 직관", memo: String? = null, care: String? = null) =
        Phrases.exitCard(exitSched(title, memo, care))

    private fun spokenOf(title: String = "KIA 직관", memo: String? = null, care: String? = null) =
        Phrases.exitSpoken(exitSched(title, memo, care))

    @Test fun `하차 카드 목록 메모는 챙기세요 문장과 채비 타일과 메모 한 줄을 둔다`() {
        val card = exit(memo = "유니폼·응원봉·티켓")
        assertEquals("도착 · 내리기 전", card.status)
        assertEquals("유니폼·응원봉·티켓 챙기세요!", card.voice)
        assertEquals(listOf<TileView>(TileView.Care(listOf("유니폼", "응원봉", "티켓"))), card.tiles)
        assertEquals("‘KIA 직관’ 일정 메모: 유니폼·응원봉·티켓", card.footnote)
        assertEquals("챙겼어요", card.primary)
        assertNull(card.secondary)
        assertTrue(!card.alert)
        assertEquals(Rules.EXIT_CARD, card.autoDismiss)
        assertEquals(listOf("5초 뒤 자동으로 닫혀요"), card.hints)
        assertTrue(!card.fixedHeight)
    }

    @Test fun `하차 카드 쉼표와 슬래시 구분도 목록이고 띄어쓰기 없는 한 단어도 챙기세요다`() {
        assertEquals("유니폼·티켓 챙기세요!", exit(memo = "유니폼, 티켓").voice)
        assertEquals("유니폼·티켓 챙기세요!", exit(memo = "유니폼/티켓").voice)
        val one = exit(memo = "우산")
        assertEquals("우산 챙기세요!", one.voice)
        assertEquals(listOf<TileView>(TileView.Care(listOf("우산"))), one.tiles)
    }

    @Test fun `하차 카드 한 줄 문장형 메모는 탑승 카드와 같은 문장이고 타일이 없다`() {
        val card = exit(memo = "주차는 B2")
        assertEquals("KIA 직관 메모에 ‘주차는 B2’가 있어요.", card.voice)
        assertTrue(card.tiles.isEmpty())
        assertNull(card.footnote)
        assertEquals("챙겼어요", card.primary)
        assertEquals("KIA 직관 메모에 ‘3루 출입구에서 만나기’가 있어요.", exit(memo = "3루 출입구에서 만나기").voice)
    }

    @Test fun `하차 카드 링크나 시각 꼴은 슬래시가 있어도 목록으로 보지 않는다`() {
        assertEquals("KIA 직관 메모에 ‘meet.google.com/abc 접속’이 있어요.", exit(memo = "meet.google.com/abc 접속").voice)
        assertEquals("KIA 직관 메모에 ‘10:30/11:00 입장’이 있어요.", exit(memo = "10:30/11:00 입장").voice)
    }

    @Test fun `하차 카드 길거나 여러 줄 메모는 메모가 있다고만 한다`() {
        val long = exit(memo = "가".repeat(31))
        assertEquals("KIA 직관 메모가 있어요.", long.voice)
        assertTrue(long.tiles.isEmpty())
        assertEquals("챙겼어요", long.primary)
        assertEquals("KIA 직관 메모가 있어요.", exit(memo = "유니폼\n응원봉").voice)
    }

    @Test fun `하차 카드 메모가 없거나 항목이 모두 비면 인사만 하고 버튼이 없다`() {
        listOf(null, "", "  ", "·", "·,/").forEach { memo ->
            val card = exit(memo = memo)
            assertEquals("잘 다녀오세요.", card.voice)
            assertTrue(card.alert)
            assertNull(card.primary)
            assertTrue(card.tiles.isEmpty())
            assertNull(card.footnote)
        }
    }

    @Test fun `하차 카드 큰 문구의 제목은 12자로 줄이고 말하는 문장에서는 따옴표를 뺀다`() {
        val card = exit(title = "아주아주 긴 일정 제목입니다 정말로", memo = "주차는 B2")
        assertEquals("아주아주 긴 일정 제… 메모에 ‘주차는 B2’가 있어요.", card.voice)
        assertEquals("가나다라마바사아자차카타", Phrases.shortTitle("가나다라마바사아자차카타"))
        assertEquals("가나다라마바사아자차카…", Phrases.shortTitle("가나다라마바사아자차카타파"))
        assertEquals("고객 미팅 메모에 주차는 B2가 있어요.", spokenOf(title = "고객 미팅", memo = "주차는 B2"))
    }

    @Test fun `하차 카드 앱 채비가 있으면 메모 대신 채비를 같은 규칙으로 읽고 문구는 채비라고 한다`() {
        val list = exit(memo = "주차는 B2", care = "유니폼·응원봉·티켓")
        assertEquals("유니폼·응원봉·티켓 챙기세요!", list.voice)
        assertEquals("‘KIA 직관’ 일정 채비: 유니폼·응원봉·티켓", list.footnote)
        assertEquals("KIA 직관 채비에 ‘주차 먼저 확인’이 있어요.", exit(memo = "유니폼", care = "주차 먼저 확인").voice)
        assertEquals("KIA 직관 채비가 있어요.", exit(care = "가".repeat(40)).voice)
        // 앱 채비가 비어 있으면(공백) 메모를 읽는다.
        assertEquals("우산 챙기세요!", exit(memo = "우산", care = "  ").voice)
        // 채비가 있고 메모가 없어도 읽는다.
        assertEquals("우산 챙기세요!", exit(care = "우산").voice)
    }

    @Test fun `하차 카드 힌트 시간은 카드 닫힘 시간을 따른다`() {
        val card = Phrases.exitCard(Schedule("x", "KIA 직관", at("17:00"), at("19:00"), place = OFFICE), Duration.ofSeconds(30))
        assertEquals(Duration.ofSeconds(30), card.autoDismiss)
        assertEquals(listOf("30초 뒤 자동으로 닫혀요"), card.hints)
    }

    @Test fun `하차 카드 말하는 문장은 줄이지 않은 전체 제목을 쓴다`() {
        val title = "아주아주 긴 일정 제목입니다 정말로"
        assertEquals("$title 메모가 있어요.", spokenOf(title = title, memo = "가".repeat(31)))
        assertEquals("아주아주 긴 일정 제… 메모가 있어요.", exit(title = title, memo = "가".repeat(31)).voice)
    }

    @Test fun `하차 카드 말이 30자를 넘으면 목록은 챙길 것이 있다고만 하고 화면은 그대로다`() {
        val memo = "유니폼·응원봉·티켓·보조배터리·손수건·물티슈·모자"
        assertEquals("KIA 직관 챙길 것이 있어요.", spokenOf(memo = memo))
        assertEquals("KIA 직관 채비가 있어요.", spokenOf(care = memo))
        assertEquals("유니폼·응원봉·티켓·보조배터리·손수건·물티슈·모자 챙기세요!", exit(memo = memo).voice)
        // 짧으면 그대로 읽는다
        assertEquals("유니폼·응원봉·티켓 챙기세요!", spokenOf(memo = "유니폼·응원봉·티켓"))
        assertEquals("잘 다녀오세요.", spokenOf())
    }

    @Test fun `하차 카드 문장형이 길면 챙길 것이 아니라 메모가 있다고만 말한다`() {
        // 문장형 메모는 챙길 것이라 단정하지 않는다: '챙길 것이 있어요.'는 목록에만 쓴다.
        assertEquals("KIA 직관 메모가 있어요.", spokenOf(memo = "3루 출입구에서 친구 만나기"))
        assertEquals("KIA 직관 채비가 있어요.", spokenOf(care = "3루 출입구에서 친구 만나기"))
        // 길이가 30자 이하면 그대로 읽는다(따옴표는 뺀다).
        assertEquals("KIA 직관 메모에 주차는 B2가 있어요.", spokenOf(memo = "주차는 B2"))
    }

    @Test fun `하차 카드 말할 문장이 30자를 넘으면 제목을 12자로 줄인 문장을 말한다`() {
        val title = "아주아주 긴 일정 제목입니다 정말로 좋아요"
        val short = "아주아주 긴 일정 제…"
        assertEquals("$short 메모가 있어요.", spokenOf(title = title, memo = "가".repeat(31)))
        assertEquals("$short 채비가 있어요.", spokenOf(title = title, care = "가".repeat(31)))
        // 문장형·목록의 대체 문장도 제목이 길면 줄인다.
        assertEquals("$short 메모가 있어요.", spokenOf(title = title, memo = "3루 출입구에서 만나기"))
        assertEquals("$short 챙길 것이 있어요.", spokenOf(title = title, memo = "유니폼·응원봉·티켓·보조배터리·손수건·물티슈·모자"))
        // 전체 제목으로도 30자 안이면 줄이지 않는다.
        val mid = "열두 글자를 넘는 제목입니다"
        assertEquals("$mid 메모가 있어요.", spokenOf(title = mid, memo = "가".repeat(31)))
        // 제목이 짧고 항목이 길어도 항목을 읽는 문장이 30자 안이면 그대로다.
        assertEquals("유니폼·응원봉·티켓 챙기세요!", spokenOf(title = title, memo = "유니폼·응원봉·티켓"))
    }

    @Test fun `하차 카드 항목 끝의 문장부호는 떼고 목록으로 판정하고 보인다`() {
        val one = exit(memo = "우산!")
        assertEquals("우산 챙기세요!", one.voice)
        assertEquals(listOf<TileView>(TileView.Care(listOf("우산"))), one.tiles)
        assertEquals("‘KIA 직관’ 일정 메모: 우산!", one.footnote)
        assertEquals("우산 챙기세요!", spokenOf(memo = "우산?"))
        assertEquals("유니폼·티켓 챙기세요!", exit(memo = "유니폼!, 티켓.").voice)
        // 문장부호만 있는 항목은 빈 항목이다.
        assertEquals("우산 챙기세요!", exit(memo = "우산·!").voice)
        assertEquals("잘 다녀오세요.", exit(memo = "!").voice)
        // 문장은 문장부호가 있어도 문장형이다.
        assertEquals("KIA 직관 메모에 ‘비 와요!’가 있어요.", exit(memo = "비 와요!").voice)
    }

    @Test fun `하차 카드 도메인 꼴은 슬래시가 없어도 문장형이고 숫자 단위 꼴은 링크가 아니다`() {
        assertEquals("KIA 직관 메모에 ‘naver.com’가 있어요.", exit(memo = "naver.com").voice)
        assertEquals("KIA 직관 메모에 ‘a.co.kr’가 있어요.", exit(memo = "a.co.kr").voice)
        assertEquals("KIA 직관 메모에 ‘예매 meet.google.com’가 있어요.", exit(memo = "예매 meet.google.com").voice)
        assertTrue(Phrases.looksLikeLinkOrTime("meet.google.com/abc"))
        assertTrue(!Phrases.looksLikeLinkOrTime("1.5L/우산"))
        assertEquals("1.5L·우산 챙기세요!", exit(memo = "1.5L/우산").voice)
        assertEquals("2.5kg·우산 챙기세요!", exit(memo = "2.5kg, 우산").voice)
        assertEquals("우산 챙기세요!", exit(memo = "우산").voice)
    }

    @Test fun `하차 카드 큰 문구와 한 줄의 제목은 모두 12자로 줄인다`() {
        val card = exit(title = "아주아주 긴 일정 제목입니다 정말로", memo = "유니폼·티켓")
        assertEquals("‘아주아주 긴 일정 제…’ 일정 메모: 유니폼·티켓", card.footnote)
    }

    @Test fun `하차 카드 숫자가 든 한 단어는 번호나 코드라 챙길 것으로 보지 않는다`() {
        mapOf("010-1234-5678" to "이", "B2-15" to "가", "301호" to "가", "AB1234" to "가").forEach { (memo, josa) ->
            val card = exit(memo = memo)
            assertEquals("KIA 직관 메모에 ‘$memo’$josa 있어요.", card.voice)
            assertTrue(card.tiles.isEmpty())
        }
        // 구분자로 나뉜 둘 이상은 숫자가 있어도 목록이다.
        assertEquals("B2-15·301호 챙기세요!", exit(memo = "B2-15·301호").voice)
        assertEquals("우산 챙기세요!", exit(memo = "우산").voice)
    }

    @Test fun `제목을 줄일 때 서로게이트 쌍을 가르지 않는다`() {
        val title = "가나다라마바사아자차\uD83D\uDE00타파하"
        val short = Phrases.shortTitle(title)
        assertEquals("가나다라마바사아자차\uD83D\uDE00…", short)
        assertTrue(!short.contains('\uFFFD'))
        assertEquals("\uD83D\uDE00".repeat(12), Phrases.shortTitle("\uD83D\uDE00".repeat(12)))
    }

    @Test fun `제목을 줄일 때 변형 선택자와 결합 문자를 글자에서 떼지 않는다`() {
        val heart = "\u2764\uFE0F"
        // 11번째 글자가 변형 선택자가 붙은 하트: 하트와 선택자를 함께 남긴다.
        assertEquals("가나다라마바사아자차$heart…", Phrases.shortTitle("가나다라마바사아자차${heart}타파하"))
        assertEquals(heart.repeat(12), Phrases.shortTitle(heart.repeat(12)))
        // 자모가 풀어쓰인(NFD) 한글도 한 글자다.
        val nfd = java.text.Normalizer.normalize("가나다라마바사아자차카타파", java.text.Normalizer.Form.NFD)
        assertEquals(java.text.Normalizer.normalize("가나다라마바사아자차카…", java.text.Normalizer.Form.NFD), Phrases.shortTitle(nfd))
    }

    @Test fun `제목을 줄일 때 ZWJ 이모지를 가르지 않는다`() {
        // JDK 20 미만의 BreakIterator는 ZWJ 열을 묶지 못한다. 실기기(Android ICU)와 JDK 20 이상에서만 확인한다.
        org.junit.Assume.assumeTrue(System.getProperty("java.specification.version")!!.substringAfter("1.").toInt() >= 20)
        val family = "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67"
        assertEquals("가나다라마바사아자차$family…", Phrases.shortTitle("가나다라마바사아자차${family}타파하"))
        assertEquals(family.repeat(12), Phrases.shortTitle(family.repeat(12)))
    }

    // ---- 집 하차 카드 ----

    private fun pickup(title: String, memo: String? = null, care: String? = null) =
        Schedule("p-$title", title, at("21:00"), at("22:00"), place = OFFICE, memo = memo, care = care)
            .let { PickupItem(HomePickup.itemName(title)!!, it) }

    @Test fun `집 하차 카드 물건이 있으면 챙기세요 문장과 채비 타일과 한 줄 메모를 둔다`() {
        val card = Phrases.homeExitCard(listOf(pickup("콩물 픽업", memo = "현금")))
        assertEquals("도착 · 내리기 전", card.status)
        assertEquals("콩물 챙기세요!", card.voice)
        assertEquals(listOf<TileView>(TileView.Care(listOf("콩물"))), card.tiles)
        assertEquals("‘콩물 픽업’ 일정 메모: 현금", card.footnote)
        assertEquals("챙겼어요", card.primary)
        assertNull(card.secondary)
        assertTrue(!card.alert)
        assertTrue(!card.fixedHeight)
        assertEquals(Rules.EXIT_CARD, card.autoDismiss)
        assertEquals(listOf("5초 뒤 자동으로 닫혀요"), card.hints)
    }

    @Test fun `집 하차 카드 물건이 없으면 인사만 하고 버튼이 없다`() {
        val card = Phrases.homeExitCard(emptyList())
        assertEquals("오늘도 수고했어요.", card.voice)
        assertTrue(card.alert)
        assertNull(card.primary)
        assertTrue(card.tiles.isEmpty())
        assertNull(card.footnote)
        assertEquals("오늘도 수고했어요.", Phrases.homeExitSpoken(emptyList()))
    }

    @Test fun `집 하차 카드 물건은 같은 이름을 합치고 세 개까지만 올리며 제목은 12자로 줄인다`() {
        val items = listOf("콩물 픽업", "콩물 수령", "우유 사기", "빵 찾기", "책 수령").map { pickup(it) }
        assertEquals("콩물·우유·빵 챙기세요!", Phrases.homeExitCard(items).voice)
        val long = pickup("아주아주아주아주긴물건이름이에요 픽업")
        assertEquals("아주아주아주아주긴물건…", Phrases.homeExitCard(listOf(long)).voice.removeSuffix(" 챙기세요!"))
    }

    @Test fun `집 하차 카드 한 줄은 앱 채비가 있으면 메모보다 채비를 먼저 읽고 문구는 채비라고 한다`() {
        val card = Phrases.homeExitCard(listOf(pickup("콩물 픽업", memo = "현금", care = "보냉백")))
        assertEquals("‘콩물 픽업’ 일정 채비: 보냉백", card.footnote)
    }

    @Test fun `집 하차 카드 한 줄은 물건 순서대로 처음 한 줄이 있는 일정의 것이고 길면 두지 않는다`() {
        val items = listOf(
            pickup("우유 사기", memo = "아주 길어서 한 줄로 읽을 수 없는 메모가 서른 글자를 훌쩍 넘어갑니다 정말로"),
            pickup("콩물 픽업", memo = "현금"),
        )
        assertEquals("‘콩물 픽업’ 일정 메모: 현금", Phrases.homeExitCard(items).footnote)
        assertNull(Phrases.homeExitCard(items.take(1)).footnote)
    }

    @Test fun `집 하차 카드 말은 큰 문구이고 30자를 넘으면 챙길 물건이 있다고만 한다`() {
        assertEquals("콩물 챙기세요!", Phrases.homeExitSpoken(listOf(pickup("콩물 픽업"))))
        val long = listOf("아주아주아주긴물건이름하나 픽업", "아주아주아주긴물건이름둘 수령", "아주아주아주긴물건이름셋 사기").map { pickup(it) }
        assertEquals("챙길 물건이 있어요.", Phrases.homeExitSpoken(long))
        // 화면의 큰 문구와 타일은 그대로다.
        assertEquals(3, (Phrases.homeExitCard(long).tiles.single() as TileView.Care).items.size)
    }
}
