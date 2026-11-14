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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 출발 제안 → 길안내 E2E: 가짜 STT(테스트가 들은 말을 넣음)와 가짜 내비(소요 시간·경로 요청 결과)로
 * 픽스처 일정(광주 직관 하루)의 첫 일정 '육전집 점심'(13:00, 고정 시계 09:20)을 대상으로 돈다.
 */
class DepartRouteTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val app get() = instrumentation.targetContext.applicationContext as ChagokApp
    private val host get() = app.host
    private val speaker get() = E2eApp.fakeSpeaker
    private val navigator get() = E2eApp.fakeNavigator

    @Before
    fun setUp() {
        device.pressHome()
        host.post(Event.RestrictionChanged(false))
        host.resetDemo()
        host.post(Event.GearChanged(Gear.PARK))
        speaker.spoken.clear()
        speaker.listened.clear()
        navigator.apply { travelTime = null; routeOk = true; routes.clear(); location = null }
    }

    /** 이 테스트가 앞당긴 데모 시계. resetDemo()는 시계를 되돌리지 않아서 끝날 때 되돌린다(다음 테스트는 09:20에서 시작). */
    private var advanced: Duration = Duration.ZERO

    private fun advanceClock(by: Duration) {
        advanced += by
        host.advanceClock(by)
    }

    @After
    fun tearDown() {
        host.advanceClock(advanced.negated())
        advanced = Duration.ZERO
        E2eApp.failFetch = false
        host.post(Event.RestrictionChanged(false))
        host.post(Event.GearChanged(Gear.PARK))
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

    private fun assertGone(text: String, timeoutMs: Long = TIMEOUT_MS) =
        assertTrue("사라져야 함: $text", device.wait(Until.gone(By.textContains(text)), timeoutMs))

    /** 소요 시간 3시간 20분: 지금 출발하면 12시 40분 도착이라 늦지도 여유롭지도 않은 출발 제안이 된다. */
    private fun departOffer() {
        navigator.travelTime = Duration.ofMinutes(200)
        launch()
        assertNotNull("출발 제안 카드", waitFor("광주 직관 날이에요!"))
        assertNotNull(device.findObject(By.text("응, 출발")))
        assertNotNull(device.findObject(By.text("잠깐만")))
        // 메모는 알리기만 하고 질문은 '출발할까요?' 하나
        assertEquals("육전집 점심 메모에 ‘유니폼·응원봉·티켓’이 있어요. 출발할까요?", device.findObject(By.textContains("메모에"))?.text)
        assertNull(device.findObject(By.textContains("챙기셨어요")))
    }

    /** 말한 문장이 [count]개가 될 때까지 기다린다. 이벤트는 메인 스레드에 비동기로 들어간다. */
    private fun awaitSpoken(count: Int, timeoutMs: Long = TIMEOUT_MS) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (speaker.spoken.size < count && System.currentTimeMillis() < deadline) Thread.sleep(50)
        assertEquals(speaker.spoken.toString(), count, speaker.spoken.size)
    }

    private fun assertRoutedToLunch() {
        assertEquals(listOf("광주 육전집"), navigator.routes.map { it.name })
    }

    @Test
    fun 출발_제안에_응이라고_하면_길안내를_요청하고_시작한다고_알린다() {
        departOffer()
        // 카드를 읽은 뒤 듣는다
        assertEquals(listOf(true), speaker.listened)

        host.post(Event.Heard("응"))

        assertNotNull("시작 안내", waitFor("길안내를 시작할게요."))
        assertGone("응, 출발")
        assertRoutedToLunch()
        assertEquals("길안내를 시작할게요.", speaker.spoken.last())
        assertEquals(listOf(true, false), speaker.listened)
    }

    @Test
    fun 말이_끝나도_듣는_동안은_볼륨_낮춤_알약이_남고_듣기가_끝나면_사라진다() {
        departOffer()
        assertNotNull(waitFor("볼륨을 잠깐 낮췄어요"))

        speaker.endSpeech()
        assertFalse("듣는 동안 알약이 남아야 함", device.wait(Until.gone(By.textContains("볼륨을 잠깐 낮췄어요")), 1_500))

        speaker.endListening()
        assertGone("볼륨을 잠깐 낮췄어요")
    }

    @Test
    fun 주_버튼을_눌러도_같은_길안내가_된다() {
        departOffer()

        device.findObject(By.text("응, 출발")).click()

        assertNotNull(waitFor("길안내를 시작할게요."))
        assertRoutedToLunch()
    }

    @Test
    fun 잠깐만이라고_하면_카드를_둔_채_길안내를_하지_않고_이어서_버튼으로_수락한다() {
        departOffer()

        host.post(Event.Heard("잠깐만"))

        assertFalse("카드가 남아 있어야 함", device.wait(Until.gone(By.text("응, 출발")), 1_500))
        assertTrue(navigator.routes.isEmpty())

        device.findObject(By.text("응, 출발")).click()
        assertNotNull(waitFor("길안내를 시작할게요."))
        assertRoutedToLunch()
    }

    @Test
    fun 잠깐만_버튼도_보류라서_카드가_남는다() {
        departOffer()
        val stopsBefore = speaker.stopCount

        device.findObject(By.text("잠깐만")).click()

        assertFalse("카드가 남아 있어야 함", device.wait(Until.gone(By.text("응, 출발")), 1_500))
        assertTrue(speaker.stopCount > stopsBefore)
        assertTrue(navigator.routes.isEmpty())
    }

    @Test
    fun 아니라고_하면_카드를_접고_길안내를_하지_않는다() {
        departOffer()

        host.post(Event.Heard("아니"))

        assertGone("광주 직관 날이에요!")
        assertTrue(navigator.routes.isEmpty())
        assertNull(device.wait(Until.findObject(By.textContains("길안내를")), 1_000))
    }

    @Test
    fun 알아듣지_못하면_한_번_다시_묻고_두_번째는_화면에서_누르라고_한다() {
        departOffer()

        host.post(Event.Heard("글쎄"))
        awaitSpoken(2)
        assertEquals("다시 말해 줄래요? '응'이나 '아니'로요.", speaker.spoken.last())
        assertEquals(listOf(true, true), speaker.listened)

        host.post(Event.Heard("음"))
        assertNotNull(waitFor("화면에서 눌러 주세요."))
        assertEquals(listOf(true, true, false), speaker.listened)
        assertTrue(navigator.routes.isEmpty())
    }

    @Test
    fun 경로_요청이_실패하면_실패를_알린다() {
        navigator.routeOk = false
        departOffer()

        host.post(Event.Heard("응"))

        assertNotNull(waitFor("길안내를 시작하지 못했어요."))
        assertNull(device.findObject(By.textContains("길안내를 시작할게요.")))
        assertEquals("길안내를 시작하지 못했어요.", speaker.spoken.last())
    }

    @Test
    fun 늦게_타도_출발을_묻고_수락하면_길안내를_시작한다() {
        navigator.travelTime = Duration.ofHours(4)
        launch()

        assertNotNull("늦음 안내", waitFor("도착이에요."))
        // 출발 제안과 같은 질문·버튼이고, 수락 전에는 길안내를 요청하지도 시작한다고 말하지도 않는다
        assertNotNull(waitFor("출발할까요?"))
        assertNotNull(device.findObject(By.text("응, 출발")))
        assertNotNull(device.findObject(By.text("잠깐만")))
        assertNull(device.findObject(By.textContains("길안내를 시작")))
        assertEquals(listOf(true), speaker.listened)
        assertTrue(navigator.routes.isEmpty())

        host.post(Event.Heard("응"))

        assertNotNull(waitFor("길안내를 시작할게요."))
        assertGone("응, 출발")
        assertRoutedToLunch()
    }

    @Test
    fun 늦게_타고_수락했는데_경로_요청이_실패하면_실패를_알린다() {
        navigator.routeOk = false
        navigator.travelTime = Duration.ofHours(4)
        launch()
        assertNotNull(waitFor("출발할까요?"))

        device.findObject(By.text("응, 출발")).click()

        assertNotNull(waitFor("길안내를 시작하지 못했어요."))
        assertEquals("길안내를 시작하지 못했어요.", speaker.spoken.last())
    }

    @Test
    fun 여유가_많으면_제안_장소를_후보로_보이고_이름으로_고르면_길안내를_시작한다() {
        navigator.travelTime = Duration.ofMinutes(30)
        launch()

        assertNotNull("목적지 묻기", waitFor("어디로 갈까요?"))
        assertNotNull(device.findObject(By.text("광주 육전집으로")))
        assertNotNull(device.findObject(By.text("그냥 갈게")))
        assertEquals(listOf(true), speaker.listened)

        host.post(Event.Heard("광주 육전집"))

        assertNotNull(waitFor("길안내를 시작할게요."))
        assertRoutedToLunch()
    }

    @Test
    fun 여유가_많을_때_후보_버튼도_같은_길안내가_된다() {
        navigator.travelTime = Duration.ofMinutes(30)
        launch()
        assertNotNull(waitFor("어디로 갈까요?"))

        device.findObject(By.text("광주 육전집으로")).click()

        assertNotNull(waitFor("길안내를 시작할게요."))
        assertRoutedToLunch()
    }

    @Test
    fun 그냥_갈게는_거절이라_카드만_접는다() {
        navigator.travelTime = Duration.ofMinutes(30)
        launch()
        assertNotNull(waitFor("어디로 갈까요?"))

        device.findObject(By.text("그냥 갈게")).click()

        assertGone("어디로 갈까요?")
        assertTrue(navigator.routes.isEmpty())
    }

    @Test
    fun 결과_한_줄은_주행을_시작하면_지워져_정차로_돌아와도_다시_보이지_않는다() {
        departOffer()
        host.post(Event.Heard("응"))
        assertNotNull(waitFor("길안내를 시작할게요."))

        host.post(Event.GearChanged(Gear.DRIVE))
        assertGone("길안내를 시작할게요.")
        host.post(Event.GearChanged(Gear.PARK))

        assertNull(device.wait(Until.findObject(By.textContains("길안내를 시작할게요.")), 1_500))
    }

    @Test
    fun 주행_중에는_길안내_결과가_화면에_뜨지_않는다() {
        departOffer()
        host.post(Event.Heard("응"))
        host.post(Event.GearChanged(Gear.DRIVE))

        assertGone("광주 직관 날이에요!")
        assertNull(device.wait(Until.findObject(By.textContains("길안내를 시작할게요.")), 1_000))
    }

    @Test
    fun 서버에_연결하지_못해_사본으로_띄운_카드도_버튼이_잘리지_않는다() {
        // 정상 카드에서 주 버튼 높이를 잰다(받은 일정은 같은 날 사본으로 남는다).
        departOffer()
        val full = device.findObject(By.text("응, 출발")).visibleBounds.height()

        // 받기가 실패하면 사본을 쓰고 '서버에 연결하지 못해' 한 줄이 붙는다. 고정 높이 카드라 넘치면 버튼 줄이 잘렸었다.
        device.pressHome()
        E2eApp.failFetch = true
        host.resetDemo()
        host.post(Event.GearChanged(Gear.PARK))
        launch()
        assertNotNull("사본 안내", waitFor("서버에 연결하지 못해 마지막으로 받은 일정 기준이에요."))
        assertNotNull(waitFor("광주 직관 날이에요!"))
        assertEquals("주 버튼이 잘리지 않아야 함", full, device.findObject(By.text("응, 출발")).visibleBounds.height())
        assertEquals(full, device.findObject(By.text("잠깐만")).visibleBounds.height())
    }

    /** 도착한 뒤 잠깐 정차(10분)가 지나 다시 타면 다음 일정(17:00 KIA 직관)을 한 줄로 묻는다. */
    private fun reboardAfterArrival() {
        // 이벤트는 메인 스레드에서 차례로 처리되고 시계는 바로 바뀐다. P단·도착이 처리된 뒤에 시계를 넘겨야 정차 시각이 맞다.
        instrumentation.waitForIdleSync()
        advanceClock(Duration.ofMinutes(20))
        navigator.travelTime = null
        speaker.spoken.clear()
        host.post(Event.Boarded)
        // 시각 사이 공백은 화면에서 NBSP라 시각이 없는 부분으로 찾는다.
        assertNotNull("다음 일정 한 줄", waitFor("KIA 직관까지"))
        assertNotNull(device.findObject(By.text("응, 출발")))
        assertNull(device.findObject(By.textContains("육전집 점심")))
    }

    @Test
    fun 길안내한_일정에_내비가_도착을_알리면_다시_탈_때_다음_일정을_묻는다() {
        departOffer()
        host.post(Event.Heard("응"))
        assertNotNull(waitFor("길안내를 시작할게요."))
        host.post(Event.GearChanged(Gear.DRIVE))
        host.post(Event.DestinationArrived)
        host.post(Event.GearChanged(Gear.PARK))
        reboardAfterArrival()
    }

    @Test
    fun P단에_넣은_곳이_대상_일정_300m_안이면_도착이고_다시_탈_때_다음_일정을_묻는다() {
        departOffer()
        device.findObject(By.text("잠깐만")).click()
        host.post(Event.GearChanged(Gear.DRIVE))
        // 내비가 위치 물음에 육전집(35.1595, 126.8526)에서 약 110m 떨어진 곳이라고 답한다.
        navigator.location = com.chagok.car.domain.LatLng(35.1605, 126.8526)
        host.post(Event.GearChanged(Gear.PARK))
        reboardAfterArrival()
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
