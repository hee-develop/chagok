package com.chagok.car.flow

import com.chagok.car.FixtureFile
import com.chagok.car.FixtureResponses
import com.chagok.car.domain.EnergyKind
import com.chagok.car.domain.EnergyOptions
import com.chagok.car.domain.EnergyStop
import com.chagok.car.domain.EnergyStopKind
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `docs/energy.md`의 수동 시연 장면(광주 직관 하루 픽스처 + debug 신호 `loc`·`home`·`range`·`fuel`)이 말하는 문구를 고정한다.
 * 시연 절차의 신호 값이 바뀌면 이 테스트도 같이 고친다.
 */
class FixtureEnergyDemoTest {
    private val seoul = ZoneId.of("Asia/Seoul")
    private val anchor = Instant.parse("2026-11-06T00:20:00Z") // 09:20 KST, 기준 시각

    /** debug 신호 `loc=35.15,126.91`: 광주 시내 */
    private val here = LatLng(35.15, 126.91)

    private val fixture = FixtureFile.read("schedules/gwangju-day.json")
    private val schedules = ScheduleParser.parse(FixtureResponses.response(fixture, anchor))

    private fun session(now: Instant, home: LatLng): DriveSession {
        val favorites = listOf(Favorite(FavoriteKind.HOME, Place("집", home)))
        return DriveSession(Clock.fixed(now, seoul), { ScheduleSnapshot(schedules, favorites = favorites) }).also { it.handle(Event.GearChanged(Gear.PARK)) }
    }

    /** `range`·`fuel`·`loc`을 넣고 탑승해 `trip=none`(소요 시간 모름)으로 에너지 후보 요청까지 간다. */
    private fun ask(session: DriveSession, kind: EnergyKind, range: Double): Effect.RequestEnergyOptions {
        session.handle(Event.EnergyChanged(kind, range))
        session.handle(Event.LocationChanged(here))
        val travel = session.handle(Event.Boarded).filterIsInstance<Effect.RequestTravelTime>().single()
        return session.handle(Event.TravelTimeResult(travel.requestId, null)).filterIsInstance<Effect.RequestEnergyOptions>().single()
    }

    @Test fun `주유 시연은 09시 20분 첫 탑승에서 집까지 300km인데 기름이 모자라요를 말한다`() {
        // home=37.11,127.0 range=150 fuel=gas: 지금 → 육전집 → 챔피언스필드 → 콩물집 → 집
        val s = session(anchor, LatLng(37.11, 127.0))
        val request = ask(s, EnergyKind.GASOLINE, 150.0)
        assertEquals("광주 육전집", schedules.first { it.id == "gwangju-lunch" }.place!!.name)
        assertEquals(LatLng(35.1595, 126.8526), request.request.destination)
        val gas = EnergyStop("EX-FS-002", EnergyStopKind.GAS_STATION, Place("예시 서구 알뜰주유소", LatLng(35.165, 126.87)), priceWon = 1639, priceFuel = "gasoline")
        val card = s.handle(Event.EnergyOptionsResult(request.requestId, EnergyOptions(listOf(gas)))).filterIsInstance<Effect.ShowCard>().single().card
        assertEquals("집까지 300km인데 기름이 모자라요.", card.voice)
        assertEquals("예시 서구 알뜰주유소에서 넣고 갈까요?", card.sub)
    }

    @Test fun `충전 시연은 육전집이 끝난 뒤 챔피언스필드를 대상으로 집까지 300km인데 배터리로는 모자라요를 말한다`() {
        // 14:50: 육전집 점심(14:00 종료)은 건너뜀. home=37.16,127.0 range=150 fuel=ev: 지금 → 챔피언스필드 → 콩물집 → 집
        val s = session(anchor + Duration.ofMinutes(330), LatLng(37.16, 127.0))
        val request = ask(s, EnergyKind.EV, 150.0)
        assertEquals(LatLng(35.1681, 126.8888), request.request.destination)
        // KIA 직관은 3시간(180분) 머문다: 서버가 목적지 근처 완속 충전기를 찾는 조건(2시간 이상)
        assertEquals(Duration.ofMinutes(180), request.request.stay)
        val charger = EnergyStop("EX-GJ-001", EnergyStopKind.SLOW_CHARGER, Place("예시 챔필 주차장 충전소", LatLng(35.1692, 126.887)), availableCount = 2, totalCount = 3, powerKw = 7)
        val card = s.handle(Event.EnergyOptionsResult(request.requestId, EnergyOptions(listOf(charger)))).filterIsInstance<Effect.ShowCard>().single().card
        assertEquals("집까지 300km인데 배터리로는 모자라요.", card.voice)
        assertEquals("예시 챔필 주차장 충전소에서 충전하고 갈까요?", card.sub)
    }

    @Test fun `집을 두지 않고 range만 짧게 주면 오늘 일정까지로 말한다`() {
        // 집이 없을 때(서버에 집을 등록하지 않았을 때)의 문구. 시내 일정만이라 주행 가능 거리를 아주 짧게(5km) 준다.
        val s = DriveSession(Clock.fixed(anchor, seoul), { ScheduleSnapshot(schedules) }).also { it.handle(Event.GearChanged(Gear.PARK)) }
        val request = ask(s, EnergyKind.GASOLINE, 5.0)
        val gas = EnergyStop("EX-FS-002", EnergyStopKind.GAS_STATION, Place("예시 서구 알뜰주유소", LatLng(35.165, 126.87)), priceWon = 1639, priceFuel = "gasoline")
        val voice = s.handle(Event.EnergyOptionsResult(request.requestId, EnergyOptions(listOf(gas)))).filterIsInstance<Effect.ShowCard>().single().card.voice
        assertEquals("오늘 일정까지 16km인데 기름이 모자라요.", voice)
    }
}
