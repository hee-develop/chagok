package com.chagok.car.domain

import com.chagok.car.flow.Phrases
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
}
