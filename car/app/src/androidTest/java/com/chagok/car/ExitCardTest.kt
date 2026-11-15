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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 하차 카드 E2E: 픽스처 일정(광주 직관 하루)의 '육전집 점심'(챙길 것·메모 없음)으로 길안내를 시작해 주행 중에 내비 도착을 알리면
 * 그 순간 "도착 · 내리기 전" 카드가 뜨고(사용자 결정 2026-11-15) 이어지는 P단에는 다시 뜨지 않는지 본다. 계약은 docs/exit-card.md
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
        DebugInjection.exitCardSeconds = 8
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
    fun 주행_중_내비_도착이면_바로_하차_카드가_뜨고_P단에는_다시_안_뜨고_시간이_지나면_닫힌다() {
        launch()
        assertNotNull("출발 제안 카드", waitFor("광주 직관 날이에요!"))
        host.post(Event.Heard("응"))
        assertNotNull(waitFor("길안내를 시작할게요."))
        host.post(Event.GearChanged(Gear.DRIVE))
        host.post(Event.DestinationArrived)

        // 육전집 점심은 챙길 것이 없어(유니폼·응원봉·티켓은 KIA 직관의 것) 도착 기록 한 줄이다. 버튼은 없다.
        assertNotNull("하차 카드", waitFor("도착 · 내리기 전"))
        assertNotNull(waitFor("육전집 점심, 도착으로 기록했어요."))
        assertNull(device.findObject(By.text("챙겼어요")))
        assertNull(device.findObject(By.textContains("유니폼")))
        assertNotNull(device.findObject(By.textContains("8초 뒤 자동으로 닫혀요")))
        instrumentation.waitForIdleSync()
        assertEquals("육전집 점심, 도착으로 기록했어요.", speaker.spoken.last())

        // 이어서 정차해도 같은 카드를 다시 말하지 않는다.
        val spokenBefore = speaker.spoken.size
        host.post(Event.GearChanged(Gear.PARK))
        instrumentation.waitForIdleSync()
        assertEquals(spokenBefore, speaker.spoken.size)

        assertTrue("카드가 닫혀야 함", device.wait(Until.gone(By.textContains("도착으로 기록했어요")), TIMEOUT_MS))
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
