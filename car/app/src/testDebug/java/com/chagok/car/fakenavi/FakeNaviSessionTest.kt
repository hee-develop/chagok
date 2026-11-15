package com.chagok.car.fakenavi

import com.chagok.car.DebugInjection
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class FakeNaviSessionTest {
    private class FakeScheduler : TickScheduler {
        var pending: Runnable? = null
        var count = 0
        override fun postDelayed(task: Runnable, delayMs: Long) {
            pending = task
            count++
        }

        override fun cancel(task: Runnable) {
            if (pending === task) {
                pending = null
                count--
            }
        }

        fun runPending() {
            val t = pending ?: return
            pending = null
            count--
            t.run()
        }
    }

    private val place = Place("광주 육전집", LatLng(35.1595, 126.8526))
    private val DEPARTED = java.time.Instant.parse("2026-11-06T00:20:00Z")
    private val scheduler = FakeScheduler()
    private var now = 0L
    private val arrivals = mutableListOf<String>()
    private lateinit var session: FakeNaviSession

    @Before fun setUp() {
        DebugInjection.fakeNavi = true
        DebugInjection.driveMillis = 10_000
        session = FakeNaviSession(scheduler, { now }, { arrivals += it.route.destination.name })
    }

    @After fun tearDown() {
        DebugInjection.fakeNavi = false
        DebugInjection.driveMillis = DebugInjection.DEFAULT_DRIVE_MILLIS
    }

    private fun driveAndStart() {
        session.start(place, DEPARTED)
        session.setDriving(true)
    }

    @Test fun `경로가 없거나 정차 중이면 틱이 없다`() {
        session.setDriving(true)
        assertEquals(0, scheduler.count)
        session.setDriving(false)
        session.start(place, DEPARTED)
        assertEquals(0, scheduler.count)
    }

    @Test fun `주행 중에는 틱이 하나 예약되고 시간이 지나면 앞으로 간다`() {
        driveAndStart()
        assertEquals(1, scheduler.count)
        now += 1000
        scheduler.runPending()
        assertEquals(0.1, 1 - session.trip!!.remainingRatio, 1e-6)
        assertEquals(1, scheduler.count)
    }

    @Test fun `onPause에서는 틱이 0개이고 onResume에서 이어 간다`() {
        driveAndStart()
        session.onPause()
        assertEquals(0, scheduler.count)
        now += 5000
        session.onResume()
        assertEquals(1, scheduler.count)
        now += 1000
        scheduler.runPending()
        // 멈춰 있던 5초는 세지 않는다
        assertEquals(0.1, 1 - session.trip!!.remainingRatio, 1e-6)
    }

    @Test fun `정차하면 틱이 0개다`() {
        driveAndStart()
        session.setDriving(false)
        assertEquals(0, scheduler.count)
    }

    @Test fun `경로를 지우면 틱이 0개다`() {
        driveAndStart()
        session.clear()
        assertEquals(0, scheduler.count)
        assertNull(session.trip)
    }

    @Test fun `가짜 내비를 끄면 틱이 0개다`() {
        driveAndStart()
        session.setEnabled(false)
        assertEquals(0, scheduler.count)
        assertNull(session.trip)
    }

    @Test fun `도착하면 틱이 0개이고 도착 알림은 한 번이다`() {
        driveAndStart()
        now += 20_000
        scheduler.runPending()
        assertEquals(0, scheduler.count)
        assertEquals(listOf("광주 육전집"), arrivals)
        session.setDriving(false)
        session.setDriving(true)
        assertEquals(0, scheduler.count)
        assertEquals(1, arrivals.size)
    }

    @Test fun `길이가 0인 경로는 시작하자마자 도착을 한 번 알린다`() {
        session.setDriving(true)
        session.start(Place("여기", FakeRoute.ORIGIN.position), DEPARTED)
        assertEquals(listOf("여기"), arrivals)
        assertEquals(0, scheduler.count)
    }

    @Test fun `progress는 정차 중에도 진행률을 옮기고 틱을 만들지 않는다`() {
        session.start(place, DEPARTED)
        session.setProgress(0.5)
        assertEquals(0.5, session.trip!!.remainingRatio, 1e-9)
        assertEquals(0, scheduler.count)
        assertEquals(0, arrivals.size)
    }

    @Test fun `progress 1은 도착으로 알리고 경로가 없으면 무시한다`() {
        session.setProgress(0.3)
        assertNull(session.trip)
        session.start(place, DEPARTED)
        session.setProgress(1.0)
        assertEquals(1, arrivals.size)
        assertNotNull(session.trip)
    }

    @Test fun `주행 중 progress로 도착 전 자리로 돌리면 틱이 다시 돈다`() {
        driveAndStart()
        session.setProgress(1.0)
        assertEquals(0, scheduler.count)
        session.setProgress(0.4)
        assertEquals(1, scheduler.count)
    }

    @Test fun `도착하면 onArrived로 도착한 경로를 한 번 알린다`() {
        val reached = mutableListOf<String>()
        session.onArrived = { reached += it.route.destination.name }
        driveAndStart()
        now += 20_000
        scheduler.runPending()
        assertEquals(listOf("광주 육전집"), reached)
        assertEquals(listOf("광주 육전집"), arrivals)
        // 이미 도착한 경로는 다시 알리지 않는다
        session.setDriving(false)
        session.setDriving(true)
        assertEquals(1, reached.size)
    }

    @Test fun `progress로 건너뛴 도착도 onArrived로 알린다`() {
        var count = 0
        session.onArrived = { count++ }
        session.start(place, DEPARTED)
        session.setProgress(1.0)
        assertEquals(1, count)
    }

    @Test fun `trip 주입값이 있으면 패널의 남은 시간을 그 값으로 맞춘다`() {
        DebugInjection.tripSeconds = 12_000
        try {
            session.start(place, DEPARTED)
            assertEquals(java.time.Duration.ofSeconds(12_000), session.trip!!.remainingDuration)
            session.setProgress(0.5)
            assertEquals(6_000_000.0, session.trip!!.remainingDuration.toMillis().toDouble(), 2.0)
        } finally {
            DebugInjection.tripSeconds = null
        }
    }

    @Test fun `경로를 시작한 시각이 출발 시각이고 달려도 도착 예정은 같다`() {
        DebugInjection.tripSeconds = 12_000
        try {
            session.start(place, DEPARTED)
            val expected = DEPARTED + java.time.Duration.ofSeconds(12_000)
            assertEquals(expected, session.trip!!.arrivalAt)
            session.setDriving(true)
            now += 5_000
            scheduler.runPending()
            assertEquals(expected, session.trip!!.arrivalAt)
            session.setProgress(0.9)
            assertEquals(expected, session.trip!!.arrivalAt)
            // 새 경로는 새 출발 시각으로 정한다
            val later = DEPARTED + java.time.Duration.ofMinutes(30)
            session.start(place, later)
            assertEquals(later + java.time.Duration.ofSeconds(12_000), session.trip!!.arrivalAt)
        } finally {
            DebugInjection.tripSeconds = null
        }
    }

    @Test fun `trip이 없거나 모름이면 경로 길이로 구한 시간을 쓴다`() {
        session.start(place, DEPARTED)
        assertEquals(session.trip!!.route.duration, session.trip!!.remainingDuration)
        DebugInjection.tripSeconds = DebugInjection.NO_TRIP
        try {
            session.start(place, DEPARTED)
            assertEquals(session.trip!!.route.duration, session.trip!!.remainingDuration)
        } finally {
            DebugInjection.tripSeconds = null
        }
    }

    @Test fun `가짜 경로 위 위치를 알리고 도착하면 끝점은 목적지 좌표이며 도착보다 먼저다`() {
        val log = mutableListOf<String>()
        val located = mutableListOf<LatLng>()
        session = FakeNaviSession(scheduler, { now }, { log += "도착" })
        session.onLocation = {
            located += it
            log += "위치"
        }
        session.start(place, DEPARTED)
        // 경로를 시작할 때 출발점
        assertEquals(listOf(FakeRoute.ORIGIN.position), located)
        session.setDriving(true)
        // 1초가 지나기 전에는 다시 알리지 않는다
        now += 500
        scheduler.runPending()
        assertEquals(1, located.size)
        now += 600
        scheduler.runPending()
        assertEquals(2, located.size)
        // 끝까지 가면 목적지 좌표로 알리고 그 뒤에 도착을 알린다
        now += 20_000
        scheduler.runPending()
        assertEquals(place.position, located.last())
        assertEquals(listOf("위치", "위치", "위치", "도착"), log)
    }

    @Test fun `경로가 없으면 위치를 알리지 않는다`() {
        var count = 0
        session.onLocation = { count++ }
        session.setDriving(true)
        now += 5_000
        assertEquals(0, count)
    }

    @Test fun `내비가 멈춘 동안에는 틱도 위치·도착 알림도 없고 다시 켜지면 멈춘 자리에서 이어 간다`() {
        val located = mutableListOf<LatLng>()
        val reached = mutableListOf<String>()
        session.onLocation = { located += it }
        session.onArrived = { reached += it.route.destination.name }
        driveAndStart()
        located.clear()
        session.setStopped(true)
        assertEquals(0, scheduler.count)
        now += 30_000
        assertNull(scheduler.pending)
        assertEquals(0.0, session.trip!!.traveledMeters, 1e-9)
        assertTrue(located.isEmpty() && reached.isEmpty())

        session.setStopped(false)
        assertEquals(1, scheduler.count)
        now += 1000
        scheduler.runPending()
        // 멈춰 있던 30초는 세지 않는다
        assertEquals(0.1, 1 - session.trip!!.remainingRatio, 1e-6)
    }

    @Test fun `내비가 멈춘 동안 progress는 무시하고 길이 0인 경로의 도착은 다시 켜질 때 한 번 알린다`() {
        val reached = mutableListOf<String>()
        session.onArrived = { reached += it.route.destination.name }
        session.start(place, DEPARTED)
        session.setStopped(true)
        session.setProgress(1.0)
        assertEquals(0.0, session.trip!!.traveledMeters, 1e-9)
        assertTrue(reached.isEmpty())

        session.start(Place("여기", FakeRoute.ORIGIN.position), DEPARTED)
        assertTrue(reached.isEmpty())
        session.setStopped(false)
        assertEquals(listOf("여기"), reached)
        session.setStopped(true)
        session.setStopped(false)
        assertEquals(1, reached.size)
    }
}
