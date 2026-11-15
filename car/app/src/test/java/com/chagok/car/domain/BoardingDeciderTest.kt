package com.chagok.car.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

class BoardingDeciderTest {
    private val meeting = schedule("m", "10:00", "11:00", memo = "계약서 2부")
    private val lunch = schedule("l", "12:30", "13:30")
    private val plan = DayPlan(listOf(meeting, lunch))
    private val thirtyMin = Duration.ofMinutes(30)

    private fun decide(
        now: String,
        kind: BoardingKind = BoardingKind.FIRST,
        plan: DayPlan? = this.plan,
        fallback: Boolean = false,
        travel: Duration? = thirtyMin,
        favorites: List<Favorite> = emptyList(),
        here: LatLng? = null,
    ) = BoardingDecider.decide(at(now), kind, plan, fallback, travel, favorites, here)

    private fun card(decision: BoardingDecision) = decision as BoardingDecision.Card

    @Test fun `잠깐 정차면 말하지 않음`() {
        assertEquals(BoardingDecision.StaySilent, decide("09:00", kind = BoardingKind.QUICK_STOP))
    }

    @Test fun `출발 시각 근처면 출발 제안`() {
        // 출발해야 할 시각 = 10:00 - 30분 - 여유 10분 = 09:20
        assertEquals(Question.Depart(meeting, at("09:30")), card(decide("09:00")).question)
    }

    @Test fun `출발 시각보다 60분 넘게 이르면 목적지를 물음`() {
        assertEquals(Question.AskDestination(AskReason.PLENTY_OF_TIME, meeting, at("09:20")), card(decide("08:19")).question)
        assertEquals(Question.Depart(meeting, at("08:50")), card(decide("08:20")).question)
    }

    @Test fun `도착 예정이 시작보다 5분 넘게 늦으면 늦게 탐`() {
        assertEquals(Question.Depart(meeting, at("10:05")), card(decide("09:35")).question)
        assertEquals(Question.DepartLate(meeting, Duration.ofMinutes(6), at("10:06")), card(decide("09:36")).question)
    }

    @Test fun `오늘 남은 일정이 없으면 목적지를 물음`() {
        val done = plan.markArrived("m").markArrived("l")
        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE), card(decide("15:00", plan = done)).question)
        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE), card(decide("09:00", plan = null)).question)
    }

    @Test fun `끝난 일정은 건너뛰고 다음 일정을 고름`() {
        assertEquals(Question.Depart(lunch, at("12:00")), card(decide("11:30")).question)
    }

    @Test fun `장소를 못 정한 일정이면 목적지를 물음`() {
        val noPlace = schedule("x", "10:00", "11:00", place = null)
        assertEquals(
            Question.AskDestination(AskReason.PLACE_UNKNOWN, noPlace),
            card(decide("09:00", plan = DayPlan(listOf(noPlace)))).question,
        )
    }

    @Test fun `소요 시간을 모르면 출발만 제안`() {
        assertEquals(Question.Depart(meeting), card(decide("06:00", travel = null)).question)
    }

    @Test fun `소요 시간을 몰라도 시작이 5분 넘게 지났으면 늦게 탐`() {
        // 경계: 시작(10:00)에서 정확히 5분은 늦지 않고, 6분부터 늦음(lateBy = now - start)
        assertEquals(Question.Depart(meeting), card(decide("10:05", travel = null)).question)
        assertEquals(Question.DepartLate(meeting, Duration.ofMinutes(6)), card(decide("10:06", travel = null)).question)
    }

    @Test fun `소요 시간을 모르면 이르게 타도 여유 판단은 하지 않음`() {
        assertEquals(Question.Depart(meeting), card(decide("07:00", travel = null)).question)
    }

    @Test fun `첫 탑승은 전체 브리핑과 챙길 것`() {
        val briefing = card(decide("09:00")).briefing
        assertEquals(Briefing.Level.FULL, briefing.level)
        assertEquals(2, briefing.remainingToday)
        assertEquals(MemoNote.ReadAloud("계약서 2부"), briefing.memo)
    }

    @Test fun `재탑승은 대상 일정 한 줄만`() {
        val briefing = card(decide("09:00", kind = BoardingKind.AGAIN)).briefing
        assertEquals(Briefing.Level.ONE_LINE, briefing.level)
        assertEquals(meeting, briefing.target)
        assertEquals(MemoNote.None, briefing.memo)
    }

    @Test fun `사본으로 판단하면 한 줄을 붙임`() {
        assertTrue(card(decide("09:00", fallback = true)).briefing.fromFallback)
        assertFalse(card(decide("09:00", plan = null, fallback = true)).briefing.fromFallback)
    }

    @Test fun `메모는 한 줄 30자 이하만 읽음`() {
        assertEquals(MemoNote.None, MemoNote.of("  "))
        assertEquals(MemoNote.ReadAloud("가".repeat(30)), MemoNote.of("가".repeat(30)))
        assertEquals(MemoNote.HasMemo, MemoNote.of("가".repeat(31)))
        assertEquals(MemoNote.HasMemo, MemoNote.of("도장\n서류"))
    }

    @Test fun `종일 일정은 대상 일정에서 빠지고 첫 탑승 인사에만 쓴다`() {
        val allDay = Schedule("d", "광주 직관", at("00:00"), at("23:59"), allDay = true)
        val withAllDay = DayPlan(listOf(allDay, meeting, lunch))
        val first = card(decide("09:00", plan = withAllDay)).briefing
        assertEquals(meeting, first.target)
        assertEquals(listOf(meeting, lunch), first.upcoming)
        assertEquals("광주 직관", first.allDayTitle)
        // 재탑승에는 종일 일정 인사가 없다
        assertEquals(null, card(decide("09:00", kind = BoardingKind.AGAIN, plan = withAllDay)).briefing.allDayTitle)
        // 종일 일정만 있으면 갈 곳이 없는 것과 같다
        val onlyAllDay = DayPlan(listOf(allDay))
        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE), card(decide("09:00", plan = onlyAllDay)).question)
        // 종일 일정은 늦음·건너뜀 판단 대상이 아니다
        assertEquals(emptyMap<String, ScheduleStatus>(), withAllDay.skipOverdue(at("23:59") + Duration.ofHours(1)).statuses.filterKeys { it == "d" })
    }

    private val home = Favorite(FavoriteKind.HOME, Place("예시 아파트", LatLng(35.17, 126.91)))
    private val work = Favorite(FavoriteKind.WORK, Place("예시타워", OFFICE.position))
    private val station = Favorite(FavoriteKind.OTHER, Place("광주송정역", LatLng(35.13, 126.79)), "광주 광산구 상무대로 201")
    private val library = Favorite(FavoriteKind.OTHER, Place("광주 시립도서관", LatLng(35.13, 126.90)))
    private val all = listOf(home, work, station, library)

    @Test fun `일정이 없으면 자주 가는 곳을 앞에서부터 3개까지 후보로 붙임`() {
        val q = card(decide("09:00", plan = null, favorites = all)).question as Question.AskDestination
        assertEquals(Question.AskDestination(AskReason.NO_SCHEDULE, favorites = listOf(home, work, station)), q)
        assertEquals(listOf(home.place, work.place, station.place), q.candidates)
    }

    @Test fun `여유가 많으면 일정 장소가 1번이고 같은 곳을 뺀 자주 가는 곳 2개가 뒤에 붙음`() {
        // work는 일정 장소(OFFICE)와 좌표가 같아 뺀다.
        val q = card(decide("08:19", favorites = all)).question as Question.AskDestination
        assertEquals(Question.AskDestination(AskReason.PLENTY_OF_TIME, meeting, at("09:20"), listOf(home, station)), q)
        assertEquals(listOf(OFFICE, home.place, station.place), q.candidates)
    }

    @Test fun `장소를 모르는 일정과 출발 제안에는 자주 가는 곳을 붙이지 않음`() {
        val noPlace = schedule("n", "10:00", "11:00", place = null)
        val unknown = card(decide("09:00", plan = DayPlan(listOf(noPlace)), favorites = all)).question as Question.AskDestination
        assertEquals(emptyList<Favorite>(), unknown.favorites)
        assertEquals(emptyList<Place>(), unknown.candidates)
        assertEquals(Question.Depart(meeting, at("09:30")), card(decide("09:00", favorites = all)).question)
    }

    // ---- 앱에서 적은 채비 ----

    private val withCare = { s: Schedule, care: String -> s.copy(care = care) }

    @Test fun `첫 탑승은 오늘 다른 일정의 앱 채비를 모으고 메모 대신 읽음`() {
        // 대상(meeting)에는 메모만, 점심(lunch)에 앱 채비. 다른 일정의 앱 채비가 있으면 앱 채비만 모은다.
        val plan = DayPlan(listOf(meeting, withCare(lunch, "우산")))
        assertEquals(MemoNote.Care(listOf(CareItem(lunch.title, "우산"))), card(decide("09:00", plan = plan)).briefing.memo)
    }

    @Test fun `대상 일정의 앱 채비가 먼저이고 종일 일정 채비도 모음`() {
        val allDay = Schedule("d", "광주 직관", at("00:00"), at("23:59"), allDay = true, care = "보조배터리")
        val plan = DayPlan(listOf(withCare(meeting, "계약서"), withCare(lunch, "우산"), allDay))
        val expected = listOf(CareItem(meeting.title, "계약서"), CareItem("광주 직관", "보조배터리"), CareItem(lunch.title, "우산"))
        assertEquals(MemoNote.Care(expected), card(decide("09:00", plan = plan)).briefing.memo)
    }

    @Test fun `도착하거나 건너뛴 일정의 채비와 빈 채비는 모으지 않음`() {
        val done = withCare(schedule("x", "08:00", "08:30"), "명함")
        val plan = DayPlan(listOf(done, meeting, withCare(lunch, "  ")), mapOf("x" to ScheduleStatus.ARRIVED))
        // 모을 앱 채비가 없으면 지금처럼 대상 일정의 메모를 읽는다.
        assertEquals(MemoNote.ReadAloud("계약서 2부"), card(decide("09:00", plan = plan)).briefing.memo)
    }

    @Test fun `재탑승은 대상 일정의 앱 채비만`() {
        val plan = DayPlan(listOf(withCare(meeting, "계약서"), withCare(lunch, "우산")))
        assertEquals(MemoNote.Care(listOf(CareItem(meeting.title, "계약서"))), card(decide("09:00", kind = BoardingKind.AGAIN, plan = plan)).briefing.memo)
        assertEquals(MemoNote.None, card(decide("09:00", kind = BoardingKind.AGAIN, plan = DayPlan(listOf(meeting, withCare(lunch, "우산"))))).briefing.memo)
    }

    // ---- 대상 일정 고르기 보강(5장): 빈 장소 60분, 이미 그곳 300m ----

    @Test fun `장소 칸이 빈 일정은 시작 60분 전부터만 대상이고 그 전에는 다음 일정을 본다`() {
        val blank = schedule("n", "10:00", "11:00", place = null)
        val plan = DayPlan(listOf(blank, lunch))
        // 61분 전: 건너뛰고 점심(장소 있음)이 대상. 장소 묻기가 아니라 출발 제안이다.
        val early = card(decide("08:59", plan = plan, travel = null))
        assertEquals(lunch, early.briefing.target)
        assertTrue(early.question is Question.Depart)
        // 정확히 60분 전: 대상이 되어 장소를 묻는다.
        val onTime = card(decide("09:00", plan = plan, travel = null))
        assertEquals(blank, onTime.briefing.target)
        assertEquals(Question.AskDestination(AskReason.PLACE_UNKNOWN, blank), onTime.question)
        // 오늘 일정 수·타일은 건너뛴 일정도 센다(아직 끝나지 않은 오늘 일정).
        assertEquals(2, early.briefing.remainingToday)
    }

    @Test fun `장소 칸이 빈 일정뿐이고 아직 60분보다 이르면 일정 없음과 같다`() {
        val blank = schedule("n", "10:00", "11:00", place = null)
        val q = card(decide("08:00", plan = DayPlan(listOf(blank)))).question
        assertEquals(AskReason.NO_SCHEDULE, (q as Question.AskDestination).reason)
    }

    /** [meters] 미터쯤 북쪽. 위도 1도는 약 111,195m다. */
    private fun northOf(position: LatLng, meters: Double) = LatLng(position.lat + meters / 111_194.9, position.lng)

    @Test fun `일정 장소가 지금 차 위치 300m 안이면 이미 그곳이라 대상에서 빼고 다음 일정을 본다`() {
        val atOffice = schedule("m2", "09:30", "10:30", place = OFFICE)
        val elsewhere = Place("서울시청", LatLng(37.5663, 126.9779))
        val next = schedule("x", "11:00", "12:00", place = elsewhere)
        val plan = DayPlan(listOf(atOffice, next))
        val inside = northOf(OFFICE.position, 299.0)
        val outside = northOf(OFFICE.position, 301.0)
        assertTrue(OFFICE.position.distanceTo(inside) < Rules.ALREADY_THERE_RADIUS_METERS)
        assertTrue(OFFICE.position.distanceTo(outside) > Rules.ALREADY_THERE_RADIUS_METERS)

        assertEquals(next, card(decide("09:00", plan = plan, here = inside)).briefing.target)
        assertEquals(atOffice, card(decide("09:00", plan = plan, here = outside)).briefing.target)
        // 위치를 모르면 이 판정을 건너뛴다.
        assertEquals(atOffice, card(decide("09:00", plan = plan, here = null)).briefing.target)
    }

    @Test fun `대상 후보가 모두 이미 그곳이면 일정 없음이다`() {
        val plan = DayPlan(listOf(schedule("m2", "09:30", "10:30", place = OFFICE)))
        val q = card(decide("09:00", plan = plan, here = OFFICE.position)).question as Question.AskDestination
        assertEquals(AskReason.NO_SCHEDULE, q.reason)
    }

    // ---- 종일 일정 장소 후보, 지금 집이면 집 빼기(6·8장) ----

    private val stadium = Place("광주-기아 챔피언스필드", LatLng(35.1681, 126.8888))
    private fun allDayAt(place: Place?, title: String = "광주 직관") = Schedule("d-$title", title, at("00:00"), at("23:59"), place = place, allDay = true)

    @Test fun `장소 있는 종일 일정은 일정 없음의 후보에 집 다음 나머지 자주 가는 곳 앞에 들어간다`() {
        val plan = DayPlan(listOf(allDayAt(stadium)))
        val q = card(decide("09:00", plan = plan, favorites = all)).question as Question.AskDestination
        // 정책서 5장 순서: 집 → 종일 일정 장소 → 나머지 자주 가는 곳
        assertEquals(listOf(home.place, stadium, work.place), q.candidates)
        assertEquals(listOf(allDayAt(stadium)), q.allDay)
        // 집이 없으면(등록 안 함·지금 집이라 뺌) 종일 일정 장소가 1번이다.
        val noHome = card(decide("09:00", plan = plan, favorites = listOf(work, station))).question as Question.AskDestination
        assertEquals(listOf(stadium, work.place, station.place), noHome.candidates)
        // 장소 없는 종일 일정은 후보에 넣지 않는다.
        val noPlace = card(decide("09:00", plan = DayPlan(listOf(allDayAt(null))), favorites = all)).question as Question.AskDestination
        assertEquals(listOf(home.place, work.place, station.place), noPlace.candidates)
    }

    @Test fun `종일 일정 후보는 여럿이어도 한 자리만 쓴다`() {
        val second = Place("광주송정역", LatLng(35.139, 126.793))
        val plan = DayPlan(listOf(allDayAt(stadium), allDayAt(second).copy(id = "all2", title = "종일 둘째")))
        val q = card(decide("09:00", plan = plan, favorites = all)).question as Question.AskDestination
        assertEquals(listOf(allDayAt(stadium)), q.allDay)
        assertEquals(listOf(home.place, stadium, work.place), q.candidates)
        // 대상 일정 장소가 있어도 자리는 대상 일정 → 집 → 종일 한 곳이다.
        val plenty = card(decide("08:19", plan = DayPlan(plan.schedules + meeting + lunch), favorites = all)).question as Question.AskDestination
        assertEquals(listOf(OFFICE, home.place, stadium), plenty.candidates)
    }

    @Test fun `여유가 많으면 일정 장소 다음에 집 그다음 종일 일정 장소 그다음 나머지 자주 가는 곳이고 같은 곳은 한 번만 넣는다`() {
        val sameAsFavorite = Favorite(FavoriteKind.OTHER, Place("다른 이름", stadium.position))
        val plan = DayPlan(listOf(allDayAt(stadium), meeting, lunch))
        val q = card(decide("08:19", plan = plan, favorites = listOf(sameAsFavorite, home, station))).question as Question.AskDestination
        assertEquals(AskReason.PLENTY_OF_TIME, q.reason)
        // 일정 장소(OFFICE) 1 + 집 1 + 종일(stadium) 1(최대 3개). 종일 일정과 좌표가 같은 자주 가는 곳은 뺀다.
        assertEquals(listOf(OFFICE, home.place, stadium), q.candidates)
        // 대상 일정 장소와 같은 종일 일정은 한 번만
        val dup = card(decide("08:19", plan = DayPlan(listOf(allDayAt(OFFICE), meeting)), favorites = listOf(home))).question as Question.AskDestination
        assertEquals(listOf(OFFICE, home.place), dup.candidates)
    }

    @Test fun `끝난 종일 일정이나 도착 처리된 종일 일정은 후보에 넣지 않는다`() {
        val ended = allDayAt(stadium).copy(end = at("08:00"))
        val q = card(decide("09:00", plan = DayPlan(listOf(ended)), favorites = listOf(home))).question as Question.AskDestination
        assertEquals(listOf(home.place), q.candidates)
    }

    @Test fun `지금 집이면 집은 후보에서 뺀다`() {
        val atHome = northOf(home.place.position, 100.0)
        val q = card(decide("09:00", plan = null, favorites = all, here = atHome)).question as Question.AskDestination
        assertEquals(listOf(work.place, station.place, library.place), q.candidates)
        // 집 반경 밖이거나 위치를 모르면 그대로 집이 1번이다.
        val away = northOf(home.place.position, 400.0)
        assertEquals(home.place, (card(decide("09:00", plan = null, favorites = all, here = away)).question as Question.AskDestination).candidates.first())
        assertEquals(home.place, (card(decide("09:00", plan = null, favorites = all, here = null)).question as Question.AskDestination).candidates.first())
        // 여유 많음의 후보에서도 뺀다.
        val plenty = card(decide("08:19", favorites = all, here = atHome)).question as Question.AskDestination
        assertEquals(listOf(OFFICE, station.place, library.place).take(3), plenty.candidates)
    }

    // ---- 일정 겹침(5장·6장) ----

    private val lunchPlace = Place("광주 육전집", LatLng(35.1595, 126.8526))

    private fun at(id: String, title: String, start: Instant, end: Instant, place: Place?) = Schedule(id, title, start, end, place = place)

    @Test fun `A 종료와 이동 시간을 더해도 B 시작보다 늦으면 겹침이고 정확히 같으면 겹침이 아니다`() {
        val a = at("a", "육전집 점심", at("12:00"), at("13:00"), lunchPlace)
        val travel = Rules.overlapTravel(lunchPlace.position.distanceTo(stadium.position))
        // 이동 시간은 시속 30km 직선거리 기준: 약 3.4km면 6~7분이다.
        assertTrue(travel > Duration.ofMinutes(6) && travel < Duration.ofMinutes(8))
        val exactlyReachable = at("b", "경기", at("13:00") + travel, at("15:00") + travel, stadium)
        assertEquals(null, BoardingDecider.findOverlap(listOf(a, exactlyReachable)))
        val oneMilliTooEarly = exactlyReachable.copy(start = exactlyReachable.start - Duration.ofMillis(1))
        assertEquals(a to oneMilliTooEarly, BoardingDecider.findOverlap(listOf(a, oneMilliTooEarly)))
    }

    @Test fun `시간이 겹치는 서로 다른 곳의 일정은 겹침이고 질문은 먼저인 일정과 다음 일정이다`() {
        val a = at("a", "육전집 점심", at("12:00"), at("13:00"), lunchPlace)
        val b = at("b", "경기", at("12:30"), at("15:00"), stadium)
        val q = card(decide("09:00", plan = DayPlan(listOf(b, a)), travel = null)).question
        assertEquals(Question.Overlap(a, b), q)
        // 겹침이면 대상 일정은 먼저인 일정이다.
        assertEquals(a, card(decide("09:00", plan = DayPlan(listOf(b, a)), travel = null)).briefing.target)
    }

    @Test fun `같은 곳이거나 장소를 모르면 겹침이 아니다`() {
        val a = at("a", "육전집 점심", at("12:00"), at("13:00"), lunchPlace)
        val sameSpot = at("b", "같은 곳 약속", at("12:30"), at("14:00"), Place("육전집 옆", northOf(lunchPlace.position, 200.0)))
        assertEquals(null, BoardingDecider.findOverlap(listOf(a, sameSpot)))
        val noPlace = at("c", "장소 없음", at("12:30"), at("14:00"), null)
        assertEquals(null, BoardingDecider.findOverlap(listOf(a, noPlace)))
        assertEquals(null, BoardingDecider.findOverlap(listOf(a)))
        assertEquals(null, BoardingDecider.findOverlap(emptyList()))
    }

    @Test fun `겹침은 대상 일정과 바로 다음 일정만 본다`() {
        val a = at("a", "육전집 점심", at("12:00"), at("13:00"), lunchPlace)
        val next = at("b", "여유 있는 일정", at("15:00"), at("16:00"), stadium)
        val farLater = at("c", "같은 시각 일정", at("12:30"), at("14:00"), Place("서울", LatLng(37.5, 127.0)))
        // 바로 다음(시작 순)이 15:00 일정이라 겹치지 않는다. 뒤의 일정끼리는 보지 않는다.
        assertEquals(null, BoardingDecider.findOverlap(listOf(a, next, farLater)))
    }

    @Test fun `겹침에서 고른 일정은 겹침 판단 없이 대상이고 이미 도착·건너뜀이면 무시한다`() {
        val a = at("a", "육전집 점심", at("12:00"), at("13:00"), lunchPlace)
        val b = at("b", "경기", at("12:30"), at("15:00"), stadium)
        val plan = DayPlan(listOf(a, b))
        val forcedB = BoardingDecider.decide(at("09:00"), BoardingKind.FIRST, plan, false, null, forcedTarget = b) as BoardingDecision.Card
        assertEquals(b, forcedB.briefing.target)
        assertTrue(forcedB.question is Question.Depart)
        // 고른 일정이 이미 끝났으면 평소 판단(여기서는 다시 겹침)이다.
        val done = DayPlan(listOf(a, b), mapOf("b" to ScheduleStatus.ARRIVED))
        val ignored = BoardingDecider.decide(at("09:00"), BoardingKind.FIRST, done, false, null, forcedTarget = b) as BoardingDecision.Card
        assertEquals(a, ignored.briefing.target)
    }

    @Test fun `이동 속도는 시속 30km다`() {
        assertEquals(Duration.ofMinutes(60), Rules.overlapTravel(30_000.0))
        assertEquals(Duration.ZERO, Rules.overlapTravel(0.0))
    }
}
