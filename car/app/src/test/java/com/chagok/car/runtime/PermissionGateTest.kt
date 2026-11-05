package com.chagok.car.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

class PermissionGateTest {
    @Test fun `필요한 권한이 모두 있으면 주행 중이어도 신호를 시작한다`() {
        assertEquals(PermissionStep.START_SOURCES, PermissionGate.next(missingAny = false, driving = true, alreadyAsked = false))
        assertEquals(PermissionStep.START_SOURCES, PermissionGate.next(missingAny = false, driving = false, alreadyAsked = true))
    }

    @Test fun `권한이 없고 주행 중이면 설명 카드와 요청과 거부 안내를 모두 미룬다`() {
        assertEquals(PermissionStep.DEFER, PermissionGate.next(missingAny = true, driving = true, alreadyAsked = false))
        assertEquals(PermissionStep.DEFER, PermissionGate.next(missingAny = true, driving = true, alreadyAsked = true))
    }

    @Test fun `정차하면 설명 카드를 띄운다`() {
        assertEquals(PermissionStep.EXPLAIN, PermissionGate.next(missingAny = true, driving = false, alreadyAsked = false))
    }

    @Test fun `이미 물었는데 거부됐으면 정차 중에 거부 안내를 보인다`() {
        assertEquals(PermissionStep.SHOW_DENIED, PermissionGate.next(missingAny = true, driving = false, alreadyAsked = true))
    }
}
