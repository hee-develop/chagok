package com.chagok.car

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.chagok.car.domain.Gear
import com.chagok.car.flow.Event
import java.time.Duration
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 하차 카드 E2E: 픽스처 일정(광주 직관 하루)의 '육전집 점심'(메모 '유니폼·응원봉·티켓')으로 길안내를 시작해 내비 도착을 알리고,
 * 실제로 달린 다음 P단에 넣으면 "도착 · 내리기 전" 카드가 뜨는지 본다. 계약은 docs/exit-card.md
 */
class ExitCardTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val app get() = instrumentation.targetContext.applicationContext as ChagokApp
    private val host get() = app.host
    private val speaker get() = E2eApp.fakeSpeaker
    private val navigator get() = E2eApp.fakeNavigator

    @Before
    fun setUp() {
        device.pressHome()
        host.setPaired(true)
        host.post(Event.RestrictionChanged(false))
        host.resetDemo()
        host.post(Event.GearChanged(Gear.PARK))
        speaker.spoken.clear()
        speaker.listened.clear()
        navigator.apply { travelTime = Duration.ofMinutes(200); routeOk = true; routes.clear(); location = null }
        // 5초는 확인하기에 빠듯해 이 테스트만 늘린다.
        DebugInjection.exitCardSeconds = 30
    }

    @After
    fun tearDown() {
        DebugInjection.exitCardSeconds = null
        host.post(Event.RestrictionChanged(false))
        host.post(Event.GearChanged(Gear.PARK))
        device.pressHome()
    }

    private fun waitFor(text: String) = device.wait(Until.findObject(By.textContains(text)), TIMEOUT_MS)

    private fun launch() {
        val context = instrumentation.targetContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
    }

    @Test
    fun 내비_도착_뒤_달린_다음_P단에_넣으면_하차_카드가_뜨고_챙겼어요로_닫는다() {
        launch()
        assertNotNull("출발 제안 카드", waitFor("광주 직관 날이에요!"))
        host.post(Event.Heard("응"))
        assertNotNull(waitFor("길안내를 시작할게요."))
        host.post(Event.GearChanged(Gear.DRIVE))
        host.post(Event.DestinationArrived)
        host.post(Event.GearChanged(Gear.PARK))

        assertNotNull("하차 카드", waitFor("도착 · 내리기 전"))
        assertNotNull(waitFor("유니폼·응원봉·티켓 챙기세요!"))
        assertNotNull(device.findObject(By.text("챙겼어요")))
        assertNotNull(device.findObject(By.textContains("30초 뒤 자동으로 닫혀요")))
        instrumentation.waitForIdleSync()
        assertEquals("유니폼·응원봉·티켓 챙기세요!", speaker.spoken.last())

        device.findObject(By.text("챙겼어요")).click()
        assertTrue("카드가 닫혀야 함", device.wait(Until.gone(By.text("챙겼어요")), TIMEOUT_MS))
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
