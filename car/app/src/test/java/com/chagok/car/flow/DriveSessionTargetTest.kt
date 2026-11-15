package com.chagok.car.flow

import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.PendingReask
import com.chagok.car.domain.Place
import com.chagok.car.domain.ReaskKind
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.ui.TileView
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 탑승 판단의 대상 일정 고르기(정책서 5장): 장소 칸이 빈 일정은 시작 60분 전부터, 이미 그곳(300m)이면 대상에서 빼고,
 * 종일 일정 장소·지금 집이면 집 빼기를 후보에 반영한다. 계약은 docs/target-selection.md.
 */
class DriveSessionTargetTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = MutableClock(start)
    private var schedules: List<Schedule> = emptyList()
    private var favorites: List<Favorite> = emptyList()
    private lateinit var session: DriveSession

    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val cityHall = Place("서울시청", LatLng(37.5663, 126.9779))
    private val home = Favorite(FavoriteKind.HOME, Place("예시 아파트", LatLng(37.55, 126.92)))
    private val work = Favorite(FavoriteKind.WORK, Place("예시타워", LatLng(37.50, 127.04)))

    private fun schedule(id: String, title: String, startMin: Long, place: Place?, lengthMin: Long = 60, allDay: Boolean = false) = Schedule(
        id = id, title = title,
        start = start + Duration.ofMinutes(startMin), end = start + Duration.ofMinutes(startMin + lengthMin),
        place = place, allDay = allDay,
    )

    private fun newSession() {
        session = DriveSession(clock, { ScheduleSnapshot(schedules, favorites = favorites) })
        session.handle(Event.GearChanged(Gear.PARK))
    }

    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()
    private fun northOf(position: LatLng, meters: Double) = LatLng(position.lat + meters / 111_194.9, position.lng)

    @Before
    fun setUp() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam), schedule("b", "점심 약속", 180, cityHall))
    }

    @Test
    fun 장소_칸이_빈_일정은_60분_전부터만_대상이고_그_전에는_다음_일정으로_간다() {
        schedules = listOf(schedule("n", "치과", 120, null), schedule("b", "점심 약속", 180, cityHall))
        newSession()
        // 시작 120분 전: 치과는 건너뛰고 점심 약속이 대상이라 그 장소로 소요 시간을 묻는다.
        assertEquals(cityHall, session.handle(Event.Boarded).one<Effect.RequestTravelTime>().place)

        // 정확히 60분 전: 치과가 대상이라 장소를 묻는다(소요 시간을 묻지 않음).
        clock.now = start + Duration.ofMinutes(60)
        newSession()
        val card = session.handle(Event.Boarded).filterIsInstance<Effect.ShowCard>().single().card
        assertEquals("'치과' 어디로 가면 될까요?", card.voice)
    }

    @Test
    fun 이미_그곳이면_대상에서_빼고_다음_일정으로_소요_시간을_묻는다() {
        newSession()
        // 차가 강남역 약 200m 안에 서 있다: 고객 미팅(강남역)은 이미 그곳이라 점심 약속이 대상이다.
        session.handle(Event.LocationChanged(northOf(gangnam.position, 200.0)))
        assertEquals(cityHall, session.handle(Event.Boarded).one<Effect.RequestTravelTime>().place)
    }

    @Test
    fun 반경_밖이거나_위치를_모르거나_낡은_위치면_이미_그곳으로_보지_않는다() {
        newSession()
        session.handle(Event.LocationChanged(northOf(gangnam.position, 400.0)))
        assertEquals(gangnam, session.handle(Event.Boarded).one<Effect.RequestTravelTime>().place)

        // 위치를 모름
        newSession()
        assertEquals(gangnam, session.handle(Event.Boarded).one<Effect.RequestTravelTime>().place)

        // 측위한 지 5분(LOCATION_MAX_AGE)이 넘은 위치는 쓰지 않는다
        newSession()
        session.handle(Event.LocationChanged(northOf(gangnam.position, 100.0)))
        clock.now += Rules.LOCATION_MAX_AGE + Duration.ofSeconds(1)
        assertEquals(gangnam, session.handle(Event.Boarded).one<Effect.RequestTravelTime>().place)
    }

    @Test
    fun 위치가_5분_안이면_정차_중_오래_있어도_쓴다() {
        newSession()
        session.handle(Event.LocationChanged(northOf(gangnam.position, 100.0)))
        clock.now += Duration.ofMinutes(4)
        assertEquals(cityHall, session.handle(Event.Boarded).one<Effect.RequestTravelTime>().place)
    }

    @Test
    fun 달린_뒤_P단의_다시_묻기_판단은_이번_주행을_시작하기_전에_측위한_위치를_쓰지_않는다() {
        // 접힌 질문(고객 미팅)이 있는 채로 출발했다가 3분 뒤 P단에 넣는다.
        val restored = Snapshot(BoardingLog(lastBoardedOn = start.atZone(ZoneOffset.UTC).toLocalDate()), emptyMap(), start.atZone(ZoneOffset.UTC).toLocalDate(), reask = PendingReask(ReaskKind.DEPART, "a"))
        session = DriveSession(clock, { ScheduleSnapshot(schedules, favorites = favorites) }, restored)
        session.handle(Event.GearChanged(Gear.PARK))
        clock.now += Duration.ofMinutes(1)
        session.handle(Event.GearChanged(Gear.DRIVE))
        clock.now += Duration.ofMinutes(3)
        val parked = session.handle(Event.GearChanged(Gear.PARK))
        // P단에 넣는 순간 시스템의 마지막 위치를 읽어 넣었는데 출발(00:01) 전인 00:00에 측위한 값이다(나이 4분이라 5분 안이지만 주행 시작 전).
        // 강남역 근처에서 측위한 값이지만 차는 이미 움직였으므로 '이미 그곳'으로 보지 않는다: 도착으로도 쓰지 않고 고객 미팅이 그대로 대상이다.
        session.handle(Event.LocationChanged(northOf(gangnam.position, 100.0), ageMillis = Duration.ofMinutes(4).toMillis()))
        val timer = parked.filterIsInstance<Effect.ScheduleLocationTimeout>().single()
        val asked = session.handle(Event.LocationTimedOut(timer.timerId))
        assertEquals(gangnam, asked.one<Effect.RequestTravelTime>().place)
    }

    @Test
    fun 기다리는_사이_위치로_대상이_바뀌면_그_소요_시간은_쓰지_않는다() {
        newSession()
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        assertEquals(gangnam, request.place)
        // 소요 시간을 기다리는 동안 위치가 들어와 고객 미팅이 이미 그곳이 되면 대상이 바뀐다: 낡은 소요 시간(강남역 기준)은 버리고 판단한다.
        session.handle(Event.LocationChanged(northOf(gangnam.position, 50.0)))
        val card = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(5))).filterIsInstance<Effect.ShowCard>().single().card
        assertTrue(card.voice, card.voice.contains("점심 약속"))
    }

    @Test
    fun 장소_있는_종일_일정은_일정_없음의_후보에_넣는다() {
        schedules = listOf(schedule("all", "광주 직관", 0, Place("광주-기아 챔피언스필드", LatLng(35.1681, 126.8888)), lengthMin = 24 * 60, allDay = true))
        favorites = listOf(home, work)
        newSession()
        val card = session.handle(Event.Boarded).filterIsInstance<Effect.ShowCard>().single().card
        val tile = card.tiles.single() as TileView.Candidates
        assertEquals("갈 곳", tile.label)
        // 정책서 5장 순서: (대상 일정 장소) → 집 → (종일 일정 장소) → 나머지 자주 가는 곳
        assertEquals(listOf("집", "광주-기아 챔피언스필드", "회사"), tile.rows.map { it.name })
        assertEquals("종일 광주 직관", tile.rows[1].detail)
        assertEquals("집으로", card.primary)
        // 종일 일정 장소로 길안내하되 그 일정을 도착 대상으로 삼지는 않는다(길안내 대상이 아님).
        assertEquals("광주-기아 챔피언스필드", session.handle(Event.CandidatePressed(1)).one<Effect.StartRoute>().place.name)
    }

    @Test
    fun 지금_집이면_후보에서_집을_뺀다() {
        schedules = emptyList()
        favorites = listOf(home, work)
        newSession()
        session.handle(Event.LocationChanged(northOf(home.place.position, 100.0)))
        val tile = session.handle(Event.Boarded).filterIsInstance<Effect.ShowCard>().single().card.tiles.single() as TileView.Candidates
        assertEquals(listOf("회사"), tile.rows.map { it.name })
    }

    @Test
    fun 대안에서_일정_장소_뒤에_고른_후보는_일정을_도착_대상으로_삼지_않는다() {
        schedules = listOf(schedule("c", "저녁 모임", 300, cityHall))
        favorites = listOf(home, work)
        newSession()
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(20)))
        session.handle(Event.Heard("다른 데"))
        assertEquals(home.place, session.handle(Event.Heard("응")).one<Effect.StartRoute>().place)
        // 내비 도착은 일정 장소로 간 길안내가 아니므로 도착으로 기록하지 않는다.
        // 도착 알림이 아무 Effect도 내지 않아 `none`이 비어 있는 목록에서 거짓으로 통과하지 않게, 시동 끔의 저장 상태를 직접 읽어 확인한다.
        session.handle(Event.GearChanged(Gear.DRIVE))
        val arrived = session.handle(Event.DestinationArrived)
        assertTrue("하차 대기·카드도 없어야 한다", arrived.none { it is Effect.ShowCard || it is Effect.Speak })
        val saved = session.handle(Event.SuspendRequested).filterIsInstance<Effect.Save>().single().snapshot
        assertEquals(null, saved.statuses["c"])
        assertEquals(null, saved.exitTargetId)
    }
}
