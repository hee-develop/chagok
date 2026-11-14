package com.chagok.car.flow

import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.ui.TileView
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 위치로 하는 일정 장소 도착(시간 창·측위 나이·이번 주행 뒤 측위)과 집 하차(집을 떠났다 돌아옴·하루 한 번·픽업 물건).
 * 계약은 docs/home-exit.md.
 */
class DriveSessionLocationTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = MutableClock(start)
    private var schedules: List<Schedule> = emptyList()
    private var favorites: List<Favorite> = listOf(Favorite(FavoriteKind.HOME, Place("집", HOME)))
    private lateinit var session: DriveSession

    private fun at(min: Long) = start + Duration.ofMinutes(min)

    private fun schedule(
        id: String,
        title: String,
        startMin: Long,
        endMin: Long = startMin + 60,
        place: Place? = GANGNAM,
        memo: String? = null,
        care: String? = null,
    ) = Schedule(id, title, at(startMin), at(endMin), place = place, memo = memo, care = care)

    private fun begin(vararg items: Schedule, paired: Boolean = true) {
        schedules = items.toList()
        session = DriveSession(clock, { ScheduleSnapshot(schedules, favorites = favorites) }, paired = paired)
        session.handle(Event.GearChanged(Gear.PARK))
    }

    private fun drive() = session.handle(Event.GearChanged(Gear.DRIVE))
    private fun park() = session.handle(Event.GearChanged(Gear.PARK))
    private fun loc(position: LatLng, ageMillis: Long = 0) = session.handle(Event.LocationChanged(position, ageMillis))
    private inline fun <reified T : Effect> List<Effect>.has() = any { it is T }
    private fun List<Effect>.exitCard() =
        filterIsInstance<Effect.ShowCard>().map { it.card }.singleOrNull { it.status == Phrases.STATUS_BEFORE_EXIT }

    private fun List<Effect>.noExitCard() = exitCard() == null
    private fun List<Effect>.savedSnapshot() = filterIsInstance<Effect.Save>().lastOrNull()?.snapshot
    private fun statusOf(effects: List<Effect>, id: String) = effects.savedSnapshot()?.statuses?.get(id)

    /** 달려 와 [position]에서 P단. 위치는 달리기 시작하고 [afterDriveStart]가 지난 뒤(이번 주행 중) 받는다. */
    private fun driveAndPark(position: LatLng?, ageMillis: Long = 0, afterDriveStart: Duration = Duration.ZERO): List<Effect> {
        drive()
        clock.now += afterDriveStart
        position?.let { loc(it, ageMillis) }
        return park()
    }

    // ---- 일정 장소 도착: 시간 창 ----

    @Test
    fun 시작_60분_전_정각부터_도착으로_본다() {
        begin(schedule("a", "고객 미팅", 120, memo = "계약서 2부"))
        clock.now = at(60)
        val parked = driveAndPark(NEAR_GANGNAM)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요.", parked.exitCard()!!.voice)
        assertEquals(ScheduleStatus.ARRIVED, statusOf(parked, "a"))
        // 위치로 새로 도착한 것이라 내비에 다시 묻지 않는다.
        assertFalse(parked.has<Effect.RequestLocation>())
    }

    @Test
    fun 시작_60분_1초_전이면_창_밖이라_도착이_아니고_내비에도_묻지_않는다() {
        begin(schedule("a", "고객 미팅", 120, memo = "계약서 2부"))
        clock.now = at(60) - Duration.ofSeconds(1)
        val parked = driveAndPark(NEAR_GANGNAM)
        assertTrue(parked.noExitCard())
        assertNull(statusOf(parked, "a"))
        // 집 좌표가 있어 내비에 현재 위치를 한 번 묻는다(답이 일정 창과 집 어디에도 안 맞으면 아무 일 없다).
        assertTrue(parked.has<Effect.RequestLocation>())
    }

    @Test
    fun 창_밖이고_집_좌표도_없으면_내비에_묻지_않는다() {
        favorites = emptyList()
        begin(schedule("a", "고객 미팅", 120))
        clock.now = at(0)
        val parked = driveAndPark(NEAR_GANGNAM)
        assertTrue(parked.noExitCard())
        assertFalse(parked.has<Effect.RequestLocation>())
    }

    @Test
    fun 종료_1초_전까지는_도착이고_종료_시각에는_건너뜀이라_도착이_아니다() {
        begin(schedule("a", "고객 미팅", 120, 180))
        clock.now = at(180) - Duration.ofSeconds(1)
        assertNotNull(driveAndPark(NEAR_GANGNAM).exitCard())

        begin(schedule("a", "고객 미팅", 120, 180))
        clock.now = at(180)
        val started = drive()
        loc(NEAR_GANGNAM)
        val late = park()
        assertTrue(late.noExitCard())
        // 끝난 일정은 건너뜀으로 바뀌어 후보가 아니다(도착으로 되돌아가지 않는다).
        assertEquals(ScheduleStatus.SKIPPED, statusOf(started, "a"))
        assertEquals(ScheduleStatus.SKIPPED, statusOf(late, "a"))
    }

    @Test
    fun 장소가_없는_일정과_종일_일정은_도착_후보가_아니다() {
        begin(schedule("a", "장소 없음", 30, place = null), schedule("b", "종일", 0, 1440).copy(allDay = true))
        val parked = driveAndPark(NEAR_GANGNAM)
        assertTrue(parked.noExitCard())
        assertNull(statusOf(parked, "a"))
        assertNull(statusOf(parked, "b"))
    }

    @Test
    fun 후보가_여럿이면_시작_시각이_지금과_가까운_일정이_도착이다() {
        // 지난 30분 전 시작(a)보다 20분 뒤 시작(b)이 가깝고, 먼 일정(c, 50분 뒤)은 더 멀다.
        begin(
            schedule("a", "이른 일정", -30, 30, memo = "서류"),
            schedule("b", "곧 시작", 20, memo = "노트북"),
            schedule("c", "나중", 50, memo = "우산"),
        )
        clock.now = at(0)
        val parked = driveAndPark(NEAR_GANGNAM)
        assertEquals("노트북 챙기세요!", parked.exitCard()!!.voice)
        val statuses = parked.savedSnapshot()!!.statuses
        assertEquals(ScheduleStatus.ARRIVED, statuses["b"])
        assertNull(statuses["a"])
        assertNull(statuses["c"])
    }

    @Test
    fun 시작_시각이_같은_거리면_먼저_시작하는_일정을_고른다() {
        begin(schedule("a", "앞", -20, 40), schedule("b", "뒤", 20, 80))
        clock.now = at(0)
        val statuses = driveAndPark(NEAR_GANGNAM).savedSnapshot()!!.statuses
        assertEquals(ScheduleStatus.ARRIVED, statuses["a"])
        assertNull(statuses["b"])
    }

    @Test
    fun 일정_장소_300m_밖이면_도착이_아니다() {
        begin(schedule("a", "고객 미팅", 30))
        val parked = driveAndPark(FAR_GANGNAM)
        assertTrue(parked.noExitCard())
        assertNull(statusOf(parked, "a"))
        // 어댑터 위치가 멀면 내비에 현재 위치를 한 번 묻는다.
        assertTrue(parked.has<Effect.RequestLocation>())
    }

    // ---- 측위 나이·이번 주행 뒤 측위 ----

    @Test
    fun 측위한_지_정확히_5분이면_쓰고_1밀리초_넘으면_쓰지_않는다() {
        val maxAge = Rules.LOCATION_MAX_AGE.toMillis()
        // 달리기 시작한 10분 뒤에 받은 위치라 5분 전 측위도 이번 주행 안이다.
        val ten = Duration.ofMinutes(10)
        begin(schedule("a", "고객 미팅", 30))
        assertNotNull(driveAndPark(NEAR_GANGNAM, ageMillis = maxAge, afterDriveStart = ten).exitCard())

        begin(schedule("a", "고객 미팅", 30))
        val stale = driveAndPark(NEAR_GANGNAM, ageMillis = maxAge + 1, afterDriveStart = ten)
        assertTrue(stale.noExitCard())
        assertNull(statusOf(stale, "a"))
        assertTrue(stale.has<Effect.RequestLocation>())
    }

    @Test
    fun 위치를_받은_뒤_5분이_넘게_지나_P단에_넣으면_낡은_위치라_쓰지_않는다() {
        begin(schedule("a", "고객 미팅", 30))
        drive()
        loc(NEAR_GANGNAM)
        clock.now += Rules.LOCATION_MAX_AGE + Duration.ofSeconds(1)
        val parked = park()
        assertTrue(parked.noExitCard())
        assertTrue(parked.has<Effect.RequestLocation>())
    }

    @Test
    fun 이번_주행_시작_전에_측위한_위치는_5분_안이어도_쓰지_않는다() {
        begin(schedule("a", "고객 미팅", 30))
        drive()
        clock.now += Duration.ofMinutes(3)
        // 이벤트는 지금 왔지만 4분 전(= 주행 시작 1분 전)에 측위한 값이다.
        loc(NEAR_GANGNAM, ageMillis = Duration.ofMinutes(4).toMillis())
        val parked = park()
        assertTrue(parked.noExitCard())
        assertNull(statusOf(parked, "a"))
        assertTrue(parked.has<Effect.RequestLocation>())
    }

    @Test
    fun 이번_주행_시작_뒤에_측위한_위치는_쓴다() {
        begin(schedule("a", "고객 미팅", 30))
        drive()
        clock.now += Duration.ofMinutes(3)
        loc(NEAR_GANGNAM, ageMillis = Duration.ofMinutes(2).toMillis())
        assertNotNull(park().exitCard())
    }

    @Test
    fun 정차_중_받은_위치는_다음_주행_전의_위치라_쓰지_않는다() {
        begin(schedule("a", "고객 미팅", 30))
        loc(NEAR_GANGNAM)
        val parked = driveAndPark(null)
        assertTrue(parked.noExitCard())
        assertTrue(parked.has<Effect.RequestLocation>())
    }

    // ---- 내비 위치 질의와의 관계 ----

    @Test
    fun 어댑터_위치가_없으면_내비에_묻고_답이_같은_규칙으로_판정된다() {
        begin(schedule("a", "고객 미팅", 30, memo = "계약서 2부"))
        val parked = driveAndPark(null)
        assertTrue(parked.has<Effect.RequestLocation>())
        val answered = loc(NEAR_GANGNAM)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요.", answered.exitCard()!!.voice)
    }

    @Test
    fun 낡은_어댑터_위치가_먼저_와도_내비의_답을_기다려_판정한다() {
        begin(schedule("a", "고객 미팅", 30, memo = "계약서 2부"))
        drive()
        clock.now += Duration.ofMinutes(10)
        val parked = park()
        assertTrue(parked.has<Effect.RequestLocation>())
        // 6분 전에 측위한 값(주행 시작 뒤지만 5분 초과)이 먼저 와도 쓰지 않고 계속 기다린다.
        assertTrue(loc(NEAR_GANGNAM, ageMillis = Duration.ofMinutes(6).toMillis()).noExitCard())
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요.", loc(NEAR_GANGNAM).exitCard()!!.voice)
    }

    @Test
    fun 내비_답도_시간_창_밖이면_도착이_아니다() {
        begin(schedule("a", "고객 미팅", 120))
        clock.now = at(0)
        val parked = driveAndPark(null)
        assertTrue(parked.has<Effect.RequestLocation>())
        val answered = loc(NEAR_GANGNAM)
        assertTrue(answered.noExitCard())
        assertNull(statusOf(answered, "a"))
    }

    @Test
    fun 내비가_답하지_않아도_어댑터_위치로_한_판정은_남는다() {
        // 어댑터 위치가 일정 장소 안이면 내비에 묻지 않는다(답이 없어도 도착과 카드는 이미 났다).
        begin(schedule("a", "고객 미팅", 30, memo = "계약서 2부"))
        val parked = driveAndPark(NEAR_GANGNAM)
        assertFalse(parked.has<Effect.RequestLocation>())
        assertNotNull(parked.exitCard())
    }

    @Test
    fun 내비_답이_P단이_아닐_때_오면_판정하지_않는다() {
        begin(schedule("a", "고객 미팅", 30))
        driveAndPark(null)
        session.handle(Event.GearChanged(Gear.DRIVE))
        val answered = loc(NEAR_GANGNAM)
        assertTrue(answered.noExitCard())
        assertNull(statusOf(answered, "a"))
    }

    // ---- 집 하차 ----

    @Test
    fun 집을_떠난_적_없이_집에_P단을_넣으면_카드가_없다() {
        begin()
        val parked = driveAndPark(NEAR_HOME)
        assertTrue(parked.noExitCard())
        assertFalse(parked.has<Effect.RequestLocation>())
    }

    @Test
    fun 집_밖_위치를_받은_뒤_집에_P단을_넣으면_인사_카드가_뜬다() {
        begin()
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val parked = park()
        val card = parked.exitCard()!!
        assertEquals(Phrases.HOME_GREETING, card.voice)
        assertTrue(card.alert)
        assertNull(card.primary)
        assertTrue(card.tiles.isEmpty())
        assertEquals(Rules.EXIT_CARD, card.autoDismiss)
        val speak = parked.filterIsInstance<Effect.Speak>().single()
        assertEquals("오늘도 수고했어요.", speak.text)
        assertFalse(speak.thenListen)
        assertEquals(Rules.EXIT_CARD, parked.filterIsInstance<Effect.ScheduleCardTimeout>().single().delay)
        assertTrue(parked.savedSnapshot()!!.homeCardShown)
    }

    @Test
    fun 집_반경_300m_안은_집이고_밖은_집이_아니다() {
        // 위도 0.00268도 ≈ 298m, 0.00272도 ≈ 302m
        val inside = LatLng(HOME.lat + 0.00268, HOME.lng)
        val outside = LatLng(HOME.lat + 0.00272, HOME.lng)
        assertTrue(inside.distanceTo(HOME) < Rules.HOME_RADIUS_METERS)
        assertTrue(outside.distanceTo(HOME) > Rules.HOME_RADIUS_METERS)

        begin()
        drive()
        loc(AWAY)
        loc(inside)
        assertNotNull(park().exitCard())

        begin()
        drive()
        loc(AWAY)
        loc(outside)
        val parked = park()
        assertTrue(parked.noExitCard())
        // 집도 일정도 아니라 내비에 현재 위치를 한 번 묻는다.
        assertTrue(parked.has<Effect.RequestLocation>())
    }

    @Test
    fun 집_P단_뒤에는_다시_집을_떠나야_다음_집_하차가_된다() {
        begin()
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertNotNull(park().exitCard())
        // 이미 한 번 인사했으니 다시 떠났다 와도 인사는 하루에 한 번뿐이다. 그 전에 '떠난 적'은 소진돼 있다.
        drive()
        loc(NEAR_HOME)
        val sameHome = park()
        assertTrue(sameHome.noExitCard())
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertTrue(park().noExitCard())
    }

    @Test
    fun 오래전에_측위한_집_밖_위치는_집을_떠난_증거가_아니다() {
        begin()
        drive()
        loc(AWAY, ageMillis = Rules.LOCATION_MAX_AGE.toMillis() + 1)
        loc(NEAR_HOME)
        assertTrue(park().noExitCard())
    }

    @Test
    fun 일정_장소_창_밖의_일정은_집_판정으로_넘어간다() {
        // 집 근처에 장소가 있는 일정이 있지만 시작 60분 전보다 이르면 도착이 아니고, 집 하차로 본다.
        begin(schedule("a", "집 앞 약속", 600, place = Place("집 앞", NEAR_HOME)))
        clock.now = at(0)
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val parked = park()
        assertEquals(Phrases.HOME_GREETING, parked.exitCard()!!.voice)
        assertNull(statusOf(parked, "a"))
    }

    @Test
    fun 일정_장소가_집_근처이고_창_안이면_일정_도착이_먼저다() {
        begin(schedule("a", "집 앞 약속", 30, place = Place("집 앞", NEAR_HOME), memo = "열쇠"))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val parked = park()
        assertEquals("열쇠 챙기세요!", parked.exitCard()!!.voice)
        assertEquals(ScheduleStatus.ARRIVED, statusOf(parked, "a"))
        // 한 P단에 카드는 하나다.
        assertEquals(1, parked.filterIsInstance<Effect.ShowCard>().size)
    }

    @Test
    fun 집을_모르면_집_하차는_없다() {
        favorites = emptyList()
        begin()
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val parked = park()
        assertTrue(parked.noExitCard())
        assertFalse(parked.has<Effect.RequestLocation>())
    }

    @Test
    fun 집이_아닌_자주_가는_곳은_집으로_보지_않는다() {
        favorites = listOf(Favorite(FavoriteKind.WORK, Place("회사", NEAR_HOME)))
        begin()
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertTrue(park().noExitCard())
    }

    @Test
    fun 집에서_내비_답으로도_집_하차가_된다() {
        begin()
        drive()
        loc(AWAY)
        // P단에 넣는 순간 마지막 어댑터 위치(집 밖)로는 판정이 안 나 내비에 묻고, 답이 집이면 그때 띄운다.
        val parked = park()
        assertTrue(parked.has<Effect.RequestLocation>())
        assertTrue(parked.noExitCard())
        assertEquals(Phrases.HOME_GREETING, loc(NEAR_HOME).exitCard()!!.voice)
    }

    // ---- 픽업 물건 ----

    @Test
    fun 시작이_지난_픽업_일정의_물건을_챙기세요로_알린다() {
        begin(schedule("k", "콩물 픽업", -30, 30, place = Place("콩물집", LatLng(35.0, 126.0)), memo = "현금"))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val parked = park()
        val card = parked.exitCard()!!
        assertEquals("콩물 챙기세요!", card.voice)
        assertEquals("챙겼어요", card.primary)
        assertEquals(listOf<TileView>(TileView.Care(listOf("콩물"))), card.tiles)
        assertEquals("‘콩물 픽업’ 일정 메모: 현금", card.footnote)
        assertEquals("콩물 챙기세요!", parked.filterIsInstance<Effect.Speak>().single().text)
        assertEquals(setOf("k"), parked.savedSnapshot()!!.homeItemsAnnounced)
    }

    @Test
    fun 앱_채비가_있으면_픽업_일정의_한_줄도_메모보다_채비를_먼저_읽는다() {
        begin(schedule("k", "콩물 픽업", -30, 30, memo = "현금", care = "보냉백"))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals("‘콩물 픽업’ 일정 채비: 보냉백", park().exitCard()!!.footnote)
    }

    @Test
    fun 한_줄_메모가_없거나_길면_각주가_없다() {
        begin(schedule("k", "콩물 픽업", -30, 30, memo = "현금과 카드를 모두 가져가서 결제하고 영수증도 받아 오기"))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val card = park().exitCard()!!
        assertEquals("콩물 챙기세요!", card.voice)
        assertNull(card.footnote)
    }

    @Test
    fun 시작_전_픽업은_아직_챙길_물건이_아니라_인사만_한다() {
        begin(schedule("k", "콩물 픽업", 600))
        clock.now = at(0)
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals(Phrases.HOME_GREETING, park().exitCard()!!.voice)
    }

    @Test
    fun 도착으로_기록된_픽업은_시작_전이어도_챙긴다() {
        // 콩물집 근처에서 위치로 도착(창 안) → 같은 날 집에서 물건을 알린다.
        begin(schedule("k", "콩물 픽업", 30, place = Place("콩물집", LAKE)))
        assertNotNull(driveAndPark(NEAR_LAKE).exitCard())
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals("콩물 챙기세요!", park().exitCard()!!.voice)
    }

    @Test
    fun 장소가_있는데_건너뜀인_픽업은_빼고_장소가_없는_픽업은_건너뜀이어도_넣는다() {
        begin(
            schedule("k", "콩물 픽업", -90, -30, place = Place("콩물집", LAKE)),
            schedule("m", "우유 사기", -90, -30, place = null),
        )
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val card = park().exitCard()!!
        assertEquals("우유 챙기세요!", card.voice)
    }

    @Test
    fun 같은_물건은_하루_한_번만_알리고_인사도_하루_한_번이다() {
        begin(schedule("k", "콩물 픽업", -30, 30))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals("콩물 챙기세요!", park().exitCard()!!.voice)
        // 다시 떠났다 돌아오면 이미 알린 물건은 빼고, 남은 물건이 없는데 오늘 이미 말했으니 카드가 없다.
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertTrue(park().noExitCard())
    }

    @Test
    fun 새_물건이_생기면_인사를_했어도_그_물건은_알린다() {
        begin(schedule("k", "콩물 픽업", -30, 30))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals("콩물 챙기세요!", park().exitCard()!!.voice)
        schedules = schedules + schedule("m", "우유 사기", -10, 50, place = null)
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals("우유 챙기세요!", park().exitCard()!!.voice)
    }

    @Test
    fun 알림_기록은_날짜가_바뀌면_비워져_다음_날_다시_알린다() {
        begin(schedule("k", "콩물 픽업", -30, 30))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertNotNull(park().exitCard())
        clock.now += Duration.ofDays(1)
        schedules = listOf(schedule("k", "콩물 픽업", 24 * 60 - 30, 24 * 60 + 30))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals("콩물 챙기세요!", park().exitCard()!!.voice)
    }

    @Test
    fun 같은_이름의_물건은_카드에서_한_번만_보이고_세_개까지만_올린다() {
        begin(
            schedule("a", "콩물 픽업", -30, 30),
            schedule("b", "콩물 수령", -30, 30),
            schedule("c", "우유 사기", -30, 30),
            schedule("d", "빵 찾기", -30, 30),
            schedule("e", "책 수령", -30, 30),
        )
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val card = park().exitCard()!!
        assertEquals("콩물·우유·빵 챙기세요!", card.voice)
    }

    // ---- 내비 도착과 겹침, 다른 카드, 주행·제한 ----

    private fun boardAndAccept() {
        val request = session.handle(Event.Boarded).filterIsInstance<Effect.RequestTravelTime>().single()
        session.handle(Event.TravelTimeResult(request.requestId, null))
        session.handle(Event.PrimaryPressed)
        session.handle(Event.RouteRequestResult(true))
    }

    @Test
    fun 내비_도착_대기가_있는_P단은_위치로_판정하지_않고_내비_쪽_카드_하나만_뜬다() {
        // 길안내 대상은 먼저 시작하는 고객 미팅. 콩물 픽업(장소 없음)은 집에서 알릴 물건이다.
        // 집 앞 약속(c)은 이 P단의 위치(집 근처)로 도착이 될 수 있는 창 안의 일정이지만, 내비 도착 대기가 있어 이 P단은 위치로 판정하지 않는다.
        begin(
            schedule("a", "고객 미팅", -45, 45, memo = "계약서 2부"),
            schedule("k", "콩물 픽업", -30, 30, place = null),
            schedule("c", "집 앞 약속", -20, 40, place = Place("집 앞", NEAR_HOME)),
        )
        boardAndAccept()
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        session.handle(Event.DestinationArrived)
        val parked = park()
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요.", parked.exitCard()!!.voice)
        assertEquals(1, parked.filterIsInstance<Effect.ShowCard>().size)
        assertFalse(parked.has<Effect.RequestLocation>())
        assertFalse(parked.savedSnapshot()!!.homeCardShown)
        assertEquals(ScheduleStatus.ARRIVED, statusOf(parked, "a"))
        assertNull(statusOf(parked, "c"))
    }

    @Test
    fun 탑승_판단이_진행_중이면_집_하차_카드를_띄우지_않고_알림_기록도_남기지_않는다() {
        begin(schedule("k", "콩물 픽업", -30, 30))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        // N단에서 탑승 판단을 시작해 소요 시간 답을 기다리는 중에 P단에 넣는다.
        session.handle(Event.Boarded).filterIsInstance<Effect.RequestTravelTime>().single()
        val parked = park()
        assertTrue(parked.noExitCard())
        assertTrue(parked.filterIsInstance<Effect.Speak>().isEmpty())
        assertTrue(parked.savedSnapshot()?.homeItemsAnnounced.orEmpty().isEmpty())
        assertFalse(parked.savedSnapshot()?.homeCardShown ?: false)
    }

    @Test
    fun 연결_전에는_집_하차_카드가_없다() {
        begin(paired = false)
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val parked = park()
        assertTrue(parked.noExitCard())
        assertTrue(parked.filterIsInstance<Effect.Speak>().isEmpty())
    }

    @Test
    fun 주행_제한이_걸린_P단은_미루고_위치로_정한_대기는_다시_달리면_지운다() {
        begin()
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        session.handle(Event.RestrictionChanged(true))
        assertTrue(park().noExitCard())
        // 제한이 풀리면 미룬 카드를 띄운다.
        assertNotNull(session.handle(Event.RestrictionChanged(false)).exitCard())

        // 이번엔 제한이 안 풀린 채 다시 달리면 위치로 정한 대기는 버려 다음 P단에서 뜨지 않는다.
        begin()
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        session.handle(Event.RestrictionChanged(true))
        park()
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.RestrictionChanged(false))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 위치로_도착한_일정의_하차_대기도_제한으로_미뤘다가_다시_달리면_지운다() {
        begin(schedule("a", "고객 미팅", 30, memo = "계약서 2부"))
        drive()
        loc(NEAR_GANGNAM)
        session.handle(Event.RestrictionChanged(true))
        val parked = park()
        assertTrue(parked.noExitCard())
        assertEquals("a", parked.savedSnapshot()!!.exitTargetId)
        val driven = session.handle(Event.GearChanged(Gear.DRIVE))
        assertNull(driven.savedSnapshot()!!.exitTargetId)
        session.handle(Event.RestrictionChanged(false))
        assertTrue(park().noExitCard())
    }

    @Test
    fun 내비_도착으로_정한_하차_대기는_다시_달려도_다음_P단까지_남는다() {
        begin(schedule("a", "고객 미팅", 30, memo = "계약서 2부"))
        boardAndAccept()
        drive()
        session.handle(Event.DestinationArrived)
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        session.handle(Event.GearChanged(Gear.DRIVE))
        assertNotNull(park().exitCard())
    }

    @Test
    fun 시동을_끄면_집_하차_대기를_버린다() {
        begin()
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        session.handle(Event.RestrictionChanged(true))
        park()
        session.handle(Event.IgnitionChanged(com.chagok.car.domain.Ignition.OFF))
        session.handle(Event.IgnitionChanged(com.chagok.car.domain.Ignition.ON))
        assertTrue(session.handle(Event.RestrictionChanged(false)).noExitCard())
    }

    @Test
    fun 달리지_않고_넣은_P단은_집_반경_안이어도_집_하차가_없다() {
        begin()
        // 앱을 켠 순간 이미 P단이고 위치를 받았다. 달린 적이 없어 하차가 아니다.
        loc(AWAY)
        loc(NEAR_HOME)
        session.handle(Event.GearChanged(Gear.NEUTRAL))
        val parked = park()
        assertTrue(parked.noExitCard())
        assertFalse(parked.has<Effect.RequestLocation>())
    }

    // ---- 연결 해제, 저장 ----

    @Test
    fun 연결이_풀리면_집_밖에_있었던_기록도_버린다() {
        begin()
        drive()
        loc(AWAY)
        session.handle(Event.Unpaired)
        session.handle(Event.Paired(brief = false))
        loc(NEAR_HOME)
        assertTrue(park().noExitCard())
    }

    @Test
    fun 집_좌표가_지워진_뒤에는_집_하차가_없다() {
        begin()
        drive()
        loc(AWAY)
        // 연결 해제로 서버 응답·사본의 집이 지워졌다.
        favorites = emptyList()
        loc(NEAR_HOME)
        assertTrue(park().noExitCard())
    }

    @Test
    fun 데모_초기화는_집_하차_기록과_알림_기록을_비운다() {
        begin(schedule("k", "콩물 픽업", -30, 30))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertNotNull(park().exitCard())
        val reset = session.handle(Event.Reset)
        assertTrue(reset.savedSnapshot()!!.homeItemsAnnounced.isEmpty())
        assertFalse(reset.savedSnapshot()!!.homeCardShown)
        session.handle(Event.GearChanged(Gear.PARK))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals("콩물 챙기세요!", park().exitCard()!!.voice)
    }

    @Test
    fun 저장된_알림_기록은_다시_뜬_세션에도_이어진다() {
        begin(schedule("k", "콩물 픽업", -30, 30))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val snapshot = park().savedSnapshot()!!
        session = DriveSession(clock, { ScheduleSnapshot(schedules, favorites = favorites) }, restored = snapshot)
        session.handle(Event.GearChanged(Gear.PARK))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertTrue(park().noExitCard())
    }

    @Test
    fun 날짜가_다른_저장분의_알림_기록은_버린다() {
        begin(schedule("k", "콩물 픽업", -30, 30))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        val snapshot = park().savedSnapshot()!!
        clock.now += Duration.ofDays(1)
        schedules = listOf(schedule("k", "콩물 픽업", 24 * 60 - 30, 24 * 60 + 30))
        session = DriveSession(clock, { ScheduleSnapshot(schedules, favorites = favorites) }, restored = snapshot)
        session.handle(Event.GearChanged(Gear.PARK))
        drive()
        loc(AWAY)
        loc(NEAR_HOME)
        assertEquals("콩물 챙기세요!", park().exitCard()!!.voice)
    }

    private companion object {
        val GANGNAM = Place("강남역", LatLng(37.4979, 127.0276))

        /** 강남역에서 약 222m(위도 0.002도), 약 333m(0.003도) */
        val NEAR_GANGNAM = LatLng(GANGNAM.position.lat + 0.002, GANGNAM.position.lng)
        val FAR_GANGNAM = LatLng(GANGNAM.position.lat + 0.003, GANGNAM.position.lng)

        val HOME = LatLng(37.30, 127.10)
        val NEAR_HOME = LatLng(HOME.lat + 0.001, HOME.lng)
        val AWAY = LatLng(37.35, 127.05)

        val LAKE = LatLng(35.0, 126.0)
        val NEAR_LAKE = LatLng(35.001, 126.0)
    }
}
