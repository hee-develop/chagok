package com.chagok.car.flow

import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.Executor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 받기 시작과 세션 전달의 순서. 메인 큐는 리스트로 흉내 낸다. */
class ScheduleRefresherTest {
    private val anchor = Instant.parse("2026-12-03T00:00:00Z")
    private val sameThread = Executor { it.run() }
    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val meeting = Schedule("a", "고객 미팅", anchor + Duration.ofMinutes(40), anchor + Duration.ofMinutes(100), place = gangnam)

    private val clock = object : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = anchor
    }

    /** 메인 스레드의 큐와 직접 전달 경로를 흉내 낸 하네스. */
    private class Harness(source: ServerScheduleSource, val session: DriveSession) {
        val queue = ArrayDeque<Event>()
        val delivered = mutableListOf<Event>()
        val effects = mutableListOf<Effect>()
        val refresher = ScheduleRefresher(source, { queue.addLast(it) }, ::deliver)

        fun deliver(event: Event) {
            delivered += event
            effects += session.handle(event)
        }

        fun runQueue() {
            while (queue.isNotEmpty()) deliver(queue.removeFirst())
        }
    }

    @Test fun `받기가 즉시 실패해도 시작이 완료보다 먼저 세션에 닿고 보류가 풀린다`() {
        val source = ServerScheduleSource({ error("바로 실패") }, { anchor }, null, { ZoneOffset.UTC }, Logger.None, sameThread)
        val session = DriveSession(clock, source)
        session.handle(Event.GearChanged(Gear.PARK))
        val h = Harness(source, session)

        h.refresher.refresh()
        // 동기 실행기라 받기는 이미 끝났지만 완료는 큐에 있고, 시작만 세션에 닿았다.
        assertEquals(listOf<Event>(Event.ScheduleLoading(1)), h.delivered)
        assertEquals(listOf<Event>(Event.ScheduleLoaded(1)), h.queue.toList())

        // 받는 동안 들어온 탑승은 보류되고, 완료가 오면 이어 간다(일정을 못 받았으니 안내 카드).
        h.deliver(Event.AppEntered)
        assertTrue(h.effects.none { it is Effect.ShowCard })
        h.runQueue()
        assertEquals(Event.ScheduleLoading(1), h.delivered.first())
        assertEquals(Event.ScheduleLoaded(1), h.delivered.last())
        assertTrue(h.effects.any { it is Effect.ShowCard })
    }

    @Test fun `받기가 성공하면 보류한 탑승이 일정으로 이어진다`() {
        val body = """{"anchor":"2026-12-03T00:00:00Z","schedules":[{"id":"a","title":"고객 미팅","start":"2026-12-03T00:40:00Z","end":"2026-12-03T01:40:00Z","allDay":false,"locationText":null,"place":{"name":"강남역","lat":37.4979,"lng":127.0276},"memo":null,"attendees":[]}]}"""
        val source = ServerScheduleSource({ body }, { anchor }, null, { ZoneOffset.UTC }, Logger.None, sameThread)
        val session = DriveSession(clock, source)
        session.handle(Event.GearChanged(Gear.PARK))
        val h = Harness(source, session)

        h.refresher.refresh()
        h.deliver(Event.AppEntered)
        h.runQueue()
        assertEquals(gangnam, h.effects.filterIsInstance<Effect.RequestTravelTime>().single().place)
    }

    @Test fun `연달아 받아도 세대는 늘기만 하고 마지막 세대에서 풀린다`() {
        val queued = ArrayDeque<Runnable>()
        val source = ServerScheduleSource({ error("실패") }, { anchor }, null, { ZoneOffset.UTC }, Logger.None, { queued.addLast(it) })
        val session = DriveSession(clock, source)
        session.handle(Event.GearChanged(Gear.PARK))
        val h = Harness(source, session)

        h.refresher.refresh()
        h.refresher.refresh()
        assertEquals(listOf<Event>(Event.ScheduleLoading(1), Event.ScheduleLoading(2)), h.delivered)
        h.deliver(Event.Boarded)
        queued.forEach { it.run() }
        h.runQueue()
        // 세대 1의 완료는 소스가 버리고 세대 2만 알린다. 보류한 탑승은 안내 대신 다시 받기를 요청한다(출처가 NONE).
        assertEquals(listOf<Event>(Event.ScheduleLoading(1), Event.ScheduleLoading(2), Event.Boarded, Event.ScheduleLoaded(2)), h.delivered)
    }
}
