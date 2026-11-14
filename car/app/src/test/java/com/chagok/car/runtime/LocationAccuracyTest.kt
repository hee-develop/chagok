package com.chagok.car.runtime

import com.chagok.car.domain.Rules
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 정확도 반경이 큰 측위는 버리고, 정확도를 모르는 측위(수동 갱신으로 온 다른 앱의 값)는 받는다. */
class LocationAccuracyTest {
    @Test fun `정확도 반경이 상한을 넘으면 버리고 이하면 받는다`() {
        assertTrue(LocationAdapter.isAccurateEnough(true, 5f))
        assertTrue(LocationAdapter.isAccurateEnough(true, Rules.LOCATION_MAX_ACCURACY_METERS))
        assertFalse(LocationAdapter.isAccurateEnough(true, Rules.LOCATION_MAX_ACCURACY_METERS + 0.1f))
        assertFalse(LocationAdapter.isAccurateEnough(true, 1_500f))
    }

    @Test fun `정확도를 모르는 측위는 받는다`() {
        assertTrue(LocationAdapter.isAccurateEnough(false, 0f))
    }
}
