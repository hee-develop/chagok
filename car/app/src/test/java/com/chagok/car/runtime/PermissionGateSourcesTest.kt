package com.chagok.car.runtime

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 기어·시동 구독은 위치 권한 결정과 무관하다. [SessionHost.start]는 [PermissionGate.ALWAYS_ON]을 권한 없이 켜고,
 * 위치만 [PermissionGate.AFTER_PERMISSION]으로 권한 결정 뒤에 켠다. 이 구분을 고정한다(계측 테스트는 권한을 아예 비워 이 회귀를 못 잡는다).
 */
class PermissionGateSourcesTest {
    @Test fun `기어와 시동은 권한 미결정 상태에서도 시작한다`() {
        assertTrue(Source.VEHICLE_SIGNALS in PermissionGate.ALWAYS_ON)
        assertFalse(Source.VEHICLE_SIGNALS in PermissionGate.AFTER_PERMISSION)
    }

    @Test fun `위치만 권한 결정 뒤에 켠다`() {
        assertTrue(Source.LOCATION in PermissionGate.AFTER_PERMISSION)
        assertFalse(Source.LOCATION in PermissionGate.ALWAYS_ON)
    }

    @Test fun `권한이 미결정이어도 거부돼도 설명·거부 단계와 별개로 신호원 구분은 그대로다`() {
        // 위치 권한이 없을 때(설명 카드 대기·거부) 흐름 단계는 달라도 ALWAYS_ON은 바뀌지 않는다
        for (alreadyAsked in listOf(false, true)) {
            PermissionGate.next(missingAny = true, driving = false, alreadyAsked = alreadyAsked)
            assertTrue(Source.VEHICLE_SIGNALS in PermissionGate.ALWAYS_ON)
        }
    }
}
