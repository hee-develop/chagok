package com.chagok.car.flow

import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Schedule
import com.chagok.car.ui.TileView
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 휴대폰 연결 전 연결 카드와, 연결된 뒤 브리핑으로 이어지는 흐름. 계약은 docs/pairing.md */
class DriveSessionPairingTest {
    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = object : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = start
    }
    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val schedules = listOf(
        Schedule(id = "a", title = "고객 미팅", start = start + Duration.ofMinutes(40), end = start + Duration.ofMinutes(100), place = gangnam),
    )
    private lateinit var session: DriveSession

    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()
    private inline fun <reified T : Effect> List<Effect>.has() = any { it is T }

    private val code = Event.PairingCodeIssued("123456", "chagok://pair?code=123456")

    @Before
    fun setUp() {
        session = DriveSession(clock, { ScheduleSnapshot(schedules) }, paired = false)
        session.handle(Event.GearChanged(Gear.PARK))
    }

    private fun pairingTile(out: List<Effect>) = out.one<Effect.ShowCard>().card.tiles.single() as TileView.Pairing

    /** 연결됐다고 알린 뒤 일정 다시 받기가 끝나고 소요 시간까지 받아 브리핑 카드를 띄운다. */
    private fun pairAndBrief(): List<Effect> {
        val paired = session.handle(Event.Paired(brief = true))
        assertTrue(paired.has<Effect.RefreshSchedules>())
        session.handle(Event.ScheduleLoading(1))
        val request = session.handle(Event.ScheduleLoaded(1)).one<Effect.RequestTravelTime>()
        return session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(20)))
    }

    @Test
    fun 연결_전에는_코드를_받으면_정차_중에_연결_카드만_보이고_말하지_않는다() {
        val out = session.handle(code)
        val card = out.one<Effect.ShowCard>().card
        assertEquals("휴대폰과 연결해 주세요.", card.voice)
        assertEquals(TileView.Pairing("chagok://pair?code=123456", "123 456"), pairingTile(out))
        assertEquals(null, card.primary)
        assertEquals(null, card.secondary)
        assertFalse(out.has<Effect.Speak>())
        // 시간이 지나도 접지 않는다.
        assertFalse(out.has<Effect.ScheduleCardTimeout>())
    }

    @Test
    fun 연결_전에는_탑승해도_브리핑하지_않고_탑승을_소진하지_않는다() {
        session.handle(code)
        val boarded = session.handle(Event.Boarded)
        assertFalse(boarded.has<Effect.RequestTravelTime>())
        assertFalse(boarded.has<Effect.Speak>())
        assertFalse(boarded.has<Effect.Save>())
        // 이미 같은 카드가 떠 있어 다시 그리지 않는다.
        assertFalse(boarded.has<Effect.ShowCard>())
        // 연결 카드에는 버튼·듣기가 없다.
        assertTrue(session.handle(Event.PrimaryPressed).isEmpty())
        assertTrue(session.handle(Event.Heard("응")).isEmpty())
    }

    @Test
    fun 코드를_받기_전에는_아무것도_보이지_않고_새_코드가_오면_카드를_바꾼다() {
        assertTrue(session.handle(Event.Boarded).isEmpty())
        session.handle(code)
        val renewed = session.handle(Event.PairingCodeIssued("654321", "chagok://pair?code=654321"))
        assertEquals("654 321", pairingTile(renewed).code)
        assertTrue(session.handle(Event.PairingCodeIssued("654321", "chagok://pair?code=654321")).isEmpty())
    }

    @Test
    fun 주행하면_연결_카드를_바로_접고_다시_서면_다시_보인다() {
        session.handle(code)
        val driving = session.handle(Event.GearChanged(Gear.DRIVE))
        assertTrue(driving.one<Effect.CollapseCard>().instant)
        assertFalse(driving.has<Effect.ShowCard>())
        assertTrue(pairingTile(session.handle(Event.GearChanged(Gear.PARK))).code == "123 456")
    }

    @Test
    fun 폰이_연결하면_카드를_접고_일정을_다시_받아_첫_탑승으로_브리핑한다() {
        session.handle(code)
        val paired = session.handle(Event.Paired(brief = true))
        assertTrue(paired.has<Effect.CollapseCard>())
        assertTrue(paired.has<Effect.RefreshSchedules>())

        val out = pairAndBriefAfterRefresh()
        val card = out.one<Effect.ShowCard>().card
        assertEquals("12시 40분 고객 미팅까지 40분이에요.", card.voice)
        assertTrue(card.tiles.any { it is TileView.Schedules })
        assertTrue(out.one<Effect.Speak>().thenListen)
        // 연결된 뒤에는 새 코드가 와도 무시한다.
        assertTrue(session.handle(code).none { it is Effect.ShowCard })
    }

    private fun pairAndBriefAfterRefresh(): List<Effect> {
        session.handle(Event.ScheduleLoading(1))
        val request = session.handle(Event.ScheduleLoaded(1)).one<Effect.RequestTravelTime>()
        return session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(20)))
    }

    @Test
    fun 주행_중에_연결되면_다음_탑승에_브리핑한다() {
        session.handle(code)
        // 주행 제한으로 주행 중이 된다(P단에 넣지 않아 잠깐 정차 판정과 섞이지 않게).
        session.handle(Event.RestrictionChanged(true))
        val paired = session.handle(Event.Paired(brief = true))
        assertFalse(paired.has<Effect.RefreshSchedules>())
        assertFalse(paired.has<Effect.ShowCard>())
        assertFalse(session.handle(Event.RestrictionChanged(false)).has<Effect.ShowCard>())
        assertTrue(session.handle(Event.Boarded).has<Effect.RequestTravelTime>())
    }

    @Test
    fun 디버그로_미리_연결하면_말하지_않고_다음_탑승부터_평소대로_브리핑한다() {
        session.handle(code)
        val paired = session.handle(Event.Paired(brief = false))
        assertTrue(paired.has<Effect.CollapseCard>())
        assertFalse(paired.has<Effect.RefreshSchedules>())
        assertFalse(paired.has<Effect.Speak>())
        assertTrue(session.handle(Event.Boarded).has<Effect.RequestTravelTime>())
    }

    @Test
    fun 연결을_풀면_떠_있던_카드를_접고_새_코드가_오면_연결_카드를_보인다() {
        val out = pairAndBrief()
        assertTrue(out.has<Effect.ShowCard>())
        val unpaired = session.handle(Event.Unpaired)
        assertTrue(unpaired.one<Effect.CollapseCard>().instant)
        assertFalse(unpaired.has<Effect.ShowCard>())
        assertEquals("123 456", pairingTile(session.handle(code)).code)
    }

    @Test
    fun 데모_초기화_뒤에도_연결_전이면_연결_카드를_다시_보인다() {
        session.handle(code)
        val reset = session.handle(Event.Reset)
        assertTrue(reset.has<Effect.CollapseCard>())
        assertEquals("123 456", pairingTile(reset).code)
    }

    @Test
    fun 처음부터_연결돼_있으면_연결_카드_없이_브리핑한다() {
        session = DriveSession(clock, { ScheduleSnapshot(schedules) })
        session.handle(Event.GearChanged(Gear.PARK))
        assertTrue(session.handle(code).isEmpty())
        assertTrue(session.handle(Event.Boarded).has<Effect.RequestTravelTime>())
    }
}
