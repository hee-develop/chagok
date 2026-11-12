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
import org.junit.Before
import org.junit.Test

/**
 * 목적지 묻기 후보 E2E: 일정 응답에 실린 자주 가는 곳(favorites)이 '어디로 갈까요?' 카드의 후보 줄로 보이고,
 * 줄을 누르거나 이름을 말하거나 주 버튼을 누르면 그 장소로 길안내를 요청한다. 가짜 STT·내비는 [DepartRouteTest]와 같다.
 */
class DestinationCandidatesTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val app get() = instrumentation.targetContext.applicationContext as ChagokApp
    private val host get() = app.host
    private val speaker get() = E2eApp.fakeSpeaker
    private val navigator get() = E2eApp.fakeNavigator

    @Before
    fun setUp() {
        E2eApp.favoritesJson = FAVORITES
        device.pressHome()
        host.post(Event.RestrictionChanged(false))
        speaker.spoken.clear()
        speaker.listened.clear()
        navigator.apply { travelTime = null; routeOk = true; routes.clear() }
    }

    @After
    fun tearDown() {
        // 다른 테스트 클래스가 기본 응답(자주 가는 곳 없음, 광주 직관 하루)을 받도록 되돌리고 다시 받는다.
        E2eApp.favoritesJson = "[]"
        E2eApp.emptyDay = false
        host.post(Event.RestrictionChanged(false))
        host.post(Event.GearChanged(Gear.PARK))
        device.pressHome()
        host.resetDemo()
    }

    /** 응답을 고른 뒤 데모를 초기화해 다시 받고 앱을 연다(앱 진입이 탑승 신호). */
    private fun launch(emptyDay: Boolean) {
        E2eApp.emptyDay = emptyDay
        host.resetDemo()
        host.post(Event.GearChanged(Gear.PARK))
        val context = instrumentation.targetContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
    }

    private fun waitFor(text: String, timeoutMs: Long = TIMEOUT_MS) =
        device.wait(Until.findObject(By.textContains(text)), timeoutMs)

    private fun assertRoutedTo(name: String) {
        assertNotNull("시작 안내", waitFor("길안내를 시작할게요."))
        assertEquals(listOf(name), navigator.routes.map { it.name })
    }

    /** 일정이 없는 날 목적지 묻기 카드에 자주 가는 곳 세 줄과 1번 후보 버튼이 보인다. */
    private fun emptyDayCard() {
        launch(emptyDay = true)
        assertNotNull("목적지 묻기", waitFor("어디로 갈까요?"))
        assertNotNull(device.findObject(By.text("자주 가는 곳")))
        for (name in listOf("집", "회사", "광주송정역")) assertNotNull(name, device.findObject(By.text(name)))
        assertNotNull(device.findObject(By.text("집으로")))
        assertNotNull(device.findObject(By.text("그냥 갈게")))
    }

    @Test
    fun 일정이_없는_날_후보_줄을_누르면_그_장소로_길안내한다() {
        emptyDayCard()
        device.findObject(By.text("광주송정역")).click()
        assertRoutedTo("광주송정역")
    }

    @Test
    fun 일정이_없는_날_주_버튼은_집으로_길안내한다() {
        emptyDayCard()
        device.findObject(By.text("집으로")).click()
        assertRoutedTo("예시 아파트 101동")
    }

    @Test
    fun 일정이_없는_날_후보_이름을_말하면_그_장소로_길안내한다() {
        emptyDayCard()
        host.post(Event.Heard("회사"))
        assertRoutedTo("광주 예시 업무지구")
    }

    @Test
    fun 여유가_많은_날은_일정_장소_뒤에_자주_가는_곳이_붙는다() {
        navigator.travelTime = Duration.ofMinutes(30)
        launch(emptyDay = false)
        assertNotNull("목적지 묻기", waitFor("어디로 갈까요?"))
        assertNotNull(device.findObject(By.text("갈 곳")))
        assertNotNull(device.findObject(By.text("광주 육전집으로")))
        // 일정 장소 1줄 + 자주 가는 곳 2줄(최대 3줄)이라 세 번째 자주 가는 곳은 보이지 않는다.
        assertNotNull(device.findObject(By.text("집")))
        assertNotNull(device.findObject(By.text("회사")))
        assertEquals(null, device.findObject(By.text("광주송정역")))

        device.findObject(By.text("회사")).click()
        assertRoutedTo("광주 예시 업무지구")
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L

        /** 목 장소(fixtures/places/mock-places.json)에서 고른 집·회사·자주 가는 곳. 서버 favorites 형식 */
        const val FAVORITES = """[
            {"kind":"home","name":"예시 아파트 101동","address":"광주 북구 샘플로 12","lat":35.1743,"lng":126.9121},
            {"kind":"work","name":"광주 예시 업무지구","address":"광주 서구 상무대로 800","lat":35.1531,"lng":126.8514},
            {"kind":"other","name":"광주송정역","address":"광주 광산구 상무대로 201","lat":35.1378,"lng":126.7912}
        ]"""
    }
}
