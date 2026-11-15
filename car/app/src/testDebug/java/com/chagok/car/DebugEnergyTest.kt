package com.chagok.car

import com.chagok.car.domain.EnergyKind
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.flow.Event
import com.chagok.car.flow.ScheduleSnapshot
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** debug 에너지 주입: `fuel`·`range`로 차가 읽은 값을 덮고(`real`이면 되돌리고), `home`으로 집을 바꾼다. */
class DebugEnergyTest {
    @Before @After fun reset() {
        DebugInjection.fuel = null
        DebugInjection.rangeKm = null
        DebugInjection.homeOverride = null
        EnergyOverride.fromReal(Event.EnergyChanged(null, null))
    }

    @Test fun `주입이 없으면 차가 읽은 값을 그대로 알린다`() {
        val posted = mutableListOf<Event>()
        DebugHooks.energySink { posted += it }(Event.EnergyChanged(EnergyKind.EV, 320.0))
        assertEquals(Event.EnergyChanged(EnergyKind.EV, 320.0), posted.single())
    }

    @Test fun `주입한 값은 차가 읽은 값을 덮고 real이면 차가 읽은 값으로 돌아간다`() {
        val posted = mutableListOf<Event>()
        val sink = DebugHooks.energySink { posted += it }
        sink(Event.EnergyChanged(EnergyKind.EV, 320.0))
        DebugInjection.rangeKm = 150.0
        assertEquals(Event.EnergyChanged(EnergyKind.EV, 150.0), EnergyOverride.merged())
        DebugInjection.fuel = EnergyKind.GASOLINE
        // 차가 새 값을 읽어도 주입한 쪽이 이긴다
        sink(Event.EnergyChanged(EnergyKind.EV, 310.0))
        assertEquals(Event.EnergyChanged(EnergyKind.GASOLINE, 150.0), posted.last())
        DebugInjection.rangeKm = null
        DebugInjection.fuel = null
        assertEquals(Event.EnergyChanged(EnergyKind.EV, 310.0), EnergyOverride.merged())
    }

    @Test fun `차가 값을 읽지 못해도 주입한 값은 알린다`() {
        DebugHooks.energySink { }(Event.EnergyChanged(null, null))
        DebugInjection.fuel = EnergyKind.EV
        DebugInjection.rangeKm = 150.0
        assertEquals(Event.EnergyChanged(EnergyKind.EV, 150.0), EnergyOverride.merged())
        DebugInjection.rangeKm = null
        assertEquals(Event.EnergyChanged(EnergyKind.EV, null), EnergyOverride.merged())
    }

    @Test fun `home을 주입하면 서버의 집 대신 그 좌표의 집을 준다`() {
        val serverHome = Favorite(FavoriteKind.HOME, Place("서버 집", LatLng(35.1, 126.9)))
        val work = Favorite(FavoriteKind.WORK, Place("회사", LatLng(35.2, 126.8)))
        val inner = { ScheduleSnapshot(emptyList(), favorites = listOf(serverHome, work)) }
        val source = DebugHooks.scheduleSource(inner)
        assertEquals(listOf(serverHome, work), source.snapshot().favorites)
        DebugInjection.homeOverride = LatLng(37.4, 127.1)
        assertEquals(
            listOf(Favorite(FavoriteKind.HOME, Place("집", LatLng(37.4, 127.1))), work),
            source.snapshot().favorites,
        )
        // 서버에 집이 없어도 끼워 넣는다
        val none = DebugHooks.scheduleSource { ScheduleSnapshot(emptyList()) }
        assertEquals(LatLng(37.4, 127.1), none.snapshot().favorites.single().place.position)
        DebugInjection.homeOverride = null
        assertNull(none.snapshot().favorites.firstOrNull())
    }
}
