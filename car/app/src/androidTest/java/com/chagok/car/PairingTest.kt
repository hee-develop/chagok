package com.chagok.car

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.chagok.car.domain.Gear
import com.chagok.car.flow.Event
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 휴대폰 연결 전 연결 카드(QR·번호) → 폰이 연결하면 카드가 접히고 탑승 브리핑. 연결 서버는 [FakePairingClient]. */
class PairingTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val app get() = instrumentation.targetContext.applicationContext as ChagokApp
    private val host get() = app.host
    private val speaker get() = E2eApp.fakeSpeaker

    @Before
    fun setUp() {
        device.pressHome()
        host.setPaired(true)
        host.post(Event.RestrictionChanged(false))
        host.resetDemo()
        host.post(Event.GearChanged(Gear.PARK))
        speaker.spoken.clear()
        E2eApp.fakeNavigator.apply { travelTime = null; routeOk = true; routes.clear() }
    }

    @After
    fun tearDown() {
        // 다른 테스트가 연결 카드 없이 시작하도록 되돌린다.
        host.setPaired(true)
        device.pressHome()
    }

    private fun launch() {
        val context = instrumentation.targetContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
    }

    private fun waitFor(text: String, timeoutMs: Long = TIMEOUT_MS) =
        device.wait(Until.findObject(By.textContains(text)), timeoutMs)

    @Test
    fun 연결_전에는_연결_카드만_보이고_폰이_연결하면_브리핑한다() {
        host.setPaired(false)
        launch()

        assertNotNull("연결 카드", waitFor("휴대폰과 연결해 주세요."))
        assertNotNull("연결 번호", device.findObject(By.res(instrumentation.targetContext.packageName, "pairing_code").text("123 456")))
        assertNotNull("QR", device.findObject(By.desc("연결 QR")))
        // 연결 전에는 브리핑하지 않고 말하지 않는다.
        assertNull(device.findObject(By.textContains("광주 직관 날이에요!")))
        assertTrue(speaker.spoken.isEmpty())

        // 폰이 번호를 보내 서버에서 연결됐다.
        E2eApp.fakePairing.paired = true

        assertNotNull("연결되면 첫 탑승 브리핑", waitFor("광주 직관 날이에요!", timeoutMs = 10_000))
        assertTrue(device.wait(Until.gone(By.textContains("휴대폰과 연결해 주세요.")), TIMEOUT_MS))
        assertTrue(speaker.spoken.single().startsWith("광주 직관 날이에요!"))
    }

    @Test
    fun 서버가_연결을_풀면_앱이_앞으로_올_때_연결_카드로_돌아가고_받아_둔_일정_사본을_지운다() {
        host.setPaired(false)
        E2eApp.fakePairing.paired = false
        launch()
        assertNotNull("연결 카드", waitFor("휴대폰과 연결해 주세요."))
        E2eApp.fakePairing.paired = true
        assertNotNull("연결되면 첫 탑승 브리핑", waitFor("광주 직관 날이에요!", timeoutMs = 10_000))
        // 연결해 일정을 받았으니 저장된 사본이 있다.
        val store = com.chagok.car.runtime.ChagokStore(instrumentation.targetContext)
        assertNotNull("받아 둔 사본", store.loadCopy())

        // 폰(운전자)에서 연결을 풀었다. 차는 앱이 앞으로 올 때 서버에 물어 해제를 안다.
        E2eApp.fakePairing.paired = false
        device.pressHome()
        launch()

        assertNotNull("연결 카드로 돌아감", waitFor("휴대폰과 연결해 주세요."))
        assertNull("일정 사본이 지워져야 함", store.loadCopy())
        assertTrue(!store.paired)
    }

    @Test
    fun 서버가_이_차를_모르면_해제로_보지_않고_연결과_사본을_그대로_둔다() {
        host.setPaired(false)
        E2eApp.fakePairing.paired = false
        E2eApp.fakePairing.serverKnowsCar = true
        launch()
        assertNotNull("연결 카드", waitFor("휴대폰과 연결해 주세요."))
        E2eApp.fakePairing.paired = true
        assertNotNull("연결되면 첫 탑승 브리핑", waitFor("광주 직관 날이에요!", timeoutMs = 10_000))
        val store = com.chagok.car.runtime.ChagokStore(instrumentation.targetContext)
        assertNotNull("받아 둔 사본", store.loadCopy())

        // 서버를 다시 켜 메모리가 비었다: 이 차를 모른다(404). 해제가 아니다.
        E2eApp.fakePairing.paired = false
        E2eApp.fakePairing.serverKnowsCar = false
        try {
            device.pressHome()
            launch()
            // 재진입 확인이 돌 시간을 준다. 연결 카드로 돌아가지 않고 사본·연결이 남아야 한다.
            Thread.sleep(3_000)
            assertNull("연결 카드로 돌아가면 안 됨", device.findObject(By.textContains("휴대폰과 연결해 주세요.")))
            assertNotNull("사본이 남아야 함", store.loadCopy())
            assertTrue(store.paired)
        } finally {
            E2eApp.fakePairing.serverKnowsCar = true
        }
    }

    private companion object {
        const val TIMEOUT_MS = 5_000L
    }
}
