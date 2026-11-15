package com.chagok.car.flow

import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.domain.ServiceZone
import com.chagok.car.runtime.DemoClock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * 회귀: 에뮬레이터 시간대가 UTC라 PT 기준 시각(12/3 08:50 서울 = 12/2 23:50 UTC)에서 [시간 +10분]을 누르면 기기 날짜가 넘어가
 * 도착 기록·하차 대기가 지워지고 다시 탈 때 그날 첫 탑승(KIA 출발 제안)으로 되돌아갔다.
 * 날짜·시각은 [ServiceZone.SEOUL]로 읽으므로 같은 조작에서 도착 뒤 흐름이 이어져야 한다.
 */
class DriveSessionServiceZoneTest {
    private class BaseClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val seoul = ServiceZone.SEOUL
    private val anchor = Instant.parse("2026-12-02T23:50:00Z") // 서울 12/3 08:50
    private val kiaPlace = Place("광주-기아 챔피언스필드", LatLng(35.1682, 126.8889))
    private val kongmulPlace = Place("콩물집", LatLng(35.1500, 126.9100))
    private val schedules = listOf(
        Schedule("kia", "KIA 직관", at("2026-12-03T17:00"), at("2026-12-03T20:00"), place = kiaPlace),
        Schedule("kongmul", "콩물 픽업", at("2026-12-03T21:00"), at("2026-12-03T22:00"), place = kongmulPlace),
    )

    private fun at(local: String): Instant = java.time.LocalDateTime.parse(local).atZone(seoul).toInstant()

    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()

    private class Rig(val clock: DemoClock, val session: DriveSession)

    private fun rig(zone: ZoneId): Rig {
        val clock = DemoClock(BaseClock(anchor), zone)
        val session = DriveSession(clock, { ScheduleSnapshot(schedules) })
        session.handle(Event.GearChanged(Gear.PARK))
        return Rig(clock, session)
    }

    private fun Rig.boardWithCard(): List<Effect> {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        return session.handle(Event.TravelTimeResult(request.requestId, null))
    }

    /** 첫 탑승 → 출발 제안 수락 → 주행 → 내비 도착 → P단(하차 카드). 마지막 효과 목록은 P단 이벤트의 것이다. */
    private fun Rig.driveToArrivalAndPark(): List<Effect> {
        boardWithCard()
        session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        session.handle(Event.RouteRequestResult(true))
        session.handle(Event.GearChanged(Gear.DRIVE))
        session.handle(Event.DestinationArrived)
        return session.handle(Event.GearChanged(Gear.PARK))
    }

    /** [시간 +10분]을 [times]번 누르며 나온 효과 전부. */
    private fun Rig.advance(times: Int): List<Effect> = buildList {
        repeat(times) {
            clock.offset += Duration.ofMinutes(10)
            addAll(session.handle(Event.ClockChanged))
        }
    }

    @Test fun `서울 시간대에서는 UTC 날짜가 넘어가도 도착한 일정이 되살아나지 않고 다시 타면 다음 일정 한 줄이다`() {
        val r = rig(seoul)
        val parked = r.driveToArrivalAndPark()
        val exit = parked.filterIsInstance<Effect.ShowCard>().single().card
        assertEquals(Phrases.STATUS_BEFORE_EXIT, exit.status)

        // 서울 08:50에서 20분 뒤: UTC로는 12/3 00:10이라 UTC 날짜가 넘어갔다.
        val advanced = r.advance(2)
        assertTrue("도착 기록이 지워지면 안 된다", advanced.filterIsInstance<Effect.Save>().none { it.snapshot.statuses["kia"] != ScheduleStatus.ARRIVED })

        val request = r.session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        val card = r.session.handle(Event.TravelTimeResult(request.requestId, null)).one<Effect.ShowCard>().card
        assertTrue(card.voice, card.voice.contains("콩물 픽업"))
        assertTrue("도착한 KIA 직관을 다시 묻지 않는다: ${card.voice}", !card.voice.contains("KIA"))
        // 첫 탑승 브리핑(오늘 일정 타일·인사)이 아니라 재탑승 한 줄이다.
        assertTrue(card.tiles.isEmpty())
    }

    @Test fun `UTC 시간대로 읽으면 같은 조작에서 도착 기록이 지워진다(원인 확인용 대조)`() {
        val r = rig(ZoneOffset.UTC)
        r.driveToArrivalAndPark()
        // UTC 12/2 23:50 → 00:10: 날짜가 넘어가 도착 기록이 지워진다. 이 동작 때문에 시간대를 서울로 고정했다.
        val advanced = r.advance(2)
        val saved = advanced.filterIsInstance<Effect.Save>().lastOrNull()
        assertNotNull(saved)
        assertTrue(saved!!.snapshot.statuses["kia"] != ScheduleStatus.ARRIVED)
    }

    @Test fun `서울 날짜가 넘어가는 자정에는 서울 기준으로 새 날이 시작된다`() {
        val r = rig(seoul)
        r.driveToArrivalAndPark()
        // 서울 08:50 + 15시간 10분 = 다음 날 00:00 서울
        r.clock.offset += Duration.ofHours(15) + Duration.ofMinutes(10)
        val rolled = r.session.handle(Event.ClockChanged)
        val saved = rolled.filterIsInstance<Effect.Save>().last()
        assertEquals(java.time.LocalDate.parse("2026-12-04"), saved.snapshot.date)
        assertTrue(saved.snapshot.statuses["kia"] != ScheduleStatus.ARRIVED)
    }
}
