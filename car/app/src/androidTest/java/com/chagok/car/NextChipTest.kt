package com.chagok.car

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.chagok.car.domain.Gear
import com.chagok.car.flow.Event
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 주행 중 다음 일정 칩 E2E: 픽스처 일정(광주 직관 하루), 고정 시계(09:20 서울)에서 대상 일정은 13:00 육전집 점심이다. */
class NextChipTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val app get() = instrumentation.targetContext.applicationContext as ChagokApp
    private val host get() = app.host

    @Before
    fun setUp() {
        device.pressHome()
        host.setPaired(true)
        host.post(Event.RestrictionChanged(false))
        host.resetDemo()
        host.post(Event.GearChanged(Gear.PARK))
    }

    @After
    fun tearDown() {
        host.post(Event.RestrictionChanged(false))
        host.post(Event.GearChanged(Gear.PARK))
        device.pressHome()
    }

    private fun launch() {
        val context = instrumentation.targetContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
    }

    @Test
    fun 주행_중에는_표시_전용_칩이_보이고_정차하면_사라진다() {
        launch()
        assertNotNull(device.wait(Until.findObject(By.textContains("광주 직관 날이에요!")), TIMEOUT_MS))

        host.post(Event.GearChanged(Gear.DRIVE))

        // 접근성에는 부모의 설명 하나만 읽힌다(자식 글자·로고는 건너뜀).
        val chip = device.wait(Until.findObject(By.desc("다음 13:00 육전집 점심")), TIMEOUT_MS)
        assertNotNull("주행 중 칩", chip)
        assertFalse("칩은 누를 수 없다", chip.isClickable)
        assertFalse("칩은 포커스를 받지 않는다", chip.isFocusable)

        host.post(Event.GearChanged(Gear.PARK))
        assertTrue("정차하면 칩이 사라진다", device.wait(Until.gone(By.desc("다음 13:00 육전집 점심")), TIMEOUT_MS))
    }

    private companion object {
        const val TIMEOUT_MS = 5_000L
    }
}
