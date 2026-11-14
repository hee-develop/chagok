package com.chagok.car.runtime

import com.chagok.car.flow.Event
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 기어·시동 구독은 위치 권한 결정과 무관하다. [SourceStarter]가 [PermissionGate]의 구분대로 기어·시동은 앱 시작 때 권한 없이 켜고,
 * 위치만 권한 결정 뒤에 켠다. 실제로 어떤 어댑터 호출이 일어나는지로 고정한다(계측 테스트는 권한을 아예 비워 이 회귀를 못 잡는다).
 */
class PermissionGateSourcesTest {
    private class FakeSignals : VehicleSignals {
        val calls = mutableListOf<String>()
        override fun start() { calls += "start" }
        override fun startPermissionGated() { calls += "startPermissionGated" }
        override fun stop() { calls += "stop" }
    }

    private class FakeLocator : Locator {
        val calls = mutableListOf<String>()
        override fun start() { calls += "start" }
        override fun stop() { calls += "stop" }
        override fun setForeground(foreground: Boolean) { calls += "foreground=$foreground" }
        override fun setNeeded(needed: Boolean) { calls += "needed=$needed" }
        override fun refreshNow(deliver: (Event) -> Unit) { calls += "refreshNow" }
    }

    private val signals = FakeSignals()
    private val locator = FakeLocator()
    private val starter = SourceStarter(signals, locator)

    @Test fun `앱 시작에는 위치 권한 결정과 무관하게(거부해도) 기어와 시동 신호를 켜고 위치는 권한 결정 전에는 켜지 않는다`() {
        starter.startAtLaunch()
        assertEquals(listOf("start", "startPermissionGated"), signals.calls)
        assertTrue(locator.calls.isEmpty())
    }

    @Test fun `위치는 권한 결정 뒤에만 켜고 기어와 시동은 다시 켜지 않는다`() {
        starter.startAtLaunch()
        signals.calls.clear()
        starter.startAfterPermission()
        assertEquals(listOf("start"), locator.calls)
        assertTrue(signals.calls.isEmpty())
    }

    @Test fun `신호원 구분은 기어와 시동이 늘 켬 위치가 권한 뒤다`() {
        assertEquals(setOf(Source.VEHICLE_SIGNALS), PermissionGate.ALWAYS_ON)
        assertEquals(setOf(Source.LOCATION), PermissionGate.AFTER_PERMISSION)
    }
}
