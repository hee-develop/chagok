package com.chagok.car

import android.content.Intent
import android.graphics.Rect
import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.chagok.car.domain.Gear
import com.chagok.car.flow.Event
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** 탑승 브리핑 E2E: 가짜 차량 신호, 픽스처 일정(광주 직관 하루), 고정 시계(09:20)로 MainActivity를 띄운다. */
class BoardingBriefingTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val app get() = instrumentation.targetContext.applicationContext as ChagokApp
    private val host get() = app.host
    private val speaker get() = E2eApp.fakeSpeaker

    @Before
    fun setUp() {
        device.pressHome()
        // 연결 카드 없이 바로 브리핑하는 흐름이다(연결은 PairingTest).
        host.setPaired(true)
        host.post(Event.RestrictionChanged(false))
        host.resetDemo()
        host.post(Event.GearChanged(Gear.PARK))
        speaker.spoken.clear()
        speaker.listened.clear()
        E2eApp.fakeNavigator.apply { travelTime = null; routeOk = true; routes.clear() }
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
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
    }

    private fun waitFor(text: String, timeoutMs: Long = TIMEOUT_MS) =
        device.wait(Until.findObject(By.textContains(text)), timeoutMs)

    private fun assertGone(text: String, timeoutMs: Long = TIMEOUT_MS) =
        assertTrue("사라져야 함: $text", device.wait(Until.gone(By.textContains(text)), timeoutMs))

    @Test
    fun 정차_상태_앱_진입이면_브리핑_카드에_인사와_픽스처_일정이_보인다() {
        launch()

        assertNotNull("인사 문구", waitFor("광주 직관 날이에요!"))
        assertNotNull("대상 일정까지 남은 시간", waitFor("육전집 점심까지 3시간"))
        // 오늘 일정 타일의 제목(픽스처)
        assertNotNull(device.findObject(By.text("육전집 점심")))
        assertNotNull(device.findObject(By.text("KIA 직관")))
        assertNotNull(device.findObject(By.text("콩물 픽업")))
        // 육전집 점심에는 챙길 것이 없어 채비 타일이 없다(유니폼·응원봉·티켓은 KIA 직관의 메모). 출발 제안 버튼
        assertNull(device.findObject(By.text("유니폼")))
        assertNotNull(device.findObject(By.text("응, 출발")))
        assertNotNull(device.findObject(By.text("잠깐만")))
        // 읽어 주는 중에는 볼륨을 낮췄다는 알약이 보인다
        assertNotNull(waitFor("볼륨을 잠깐 낮췄어요"))
        assertEquals(1, speaker.spoken.size)
        assertTrue(speaker.spoken.single().startsWith("광주 직관 날이에요! 1시 육전집 점심까지 3시간 40분이에요."))
    }

    @Test
    fun 기어가_D로_바뀌면_카드가_즉시_사라지고_음성이_멈춘다() {
        launch()
        assertNotNull(waitFor("광주 직관 날이에요!"))
        val stopsBefore = speaker.stopCount

        host.post(Event.GearChanged(Gear.DRIVE))

        assertGone("광주 직관 날이에요!", timeoutMs = 1_500)
        assertGone("볼륨을 잠깐 낮췄어요", timeoutMs = 1_500)
        assertTrue(speaker.stopCount > stopsBefore)
    }

    @Test
    fun 주행_제한이_걸리면_카드가_사라진다() {
        launch()
        assertNotNull(waitFor("광주 직관 날이에요!"))
        host.post(Event.RestrictionChanged(true))
        assertGone("광주 직관 날이에요!", timeoutMs = 1_500)
    }

    @Test
    fun 같은_날_두_번째_탑승은_대상_일정_한_줄로_다시_묻는다() {
        launch()
        assertNotNull(waitFor("광주 직관 날이에요!"))
        device.findObject(By.text("응, 출발")).click()
        assertGone("광주 직관 날이에요!")
        speaker.spoken.clear()

        host.post(Event.Boarded)

        // 5장 재탑승: 종일 인사·오늘 일정 타일·메모 없이 대상 일정 한 줄과 출발 질문
        // 시각 사이 공백은 화면에서 NBSP라 시각이 없는 부분으로 찾는다.
        assertNotNull("재탑승 한 줄", waitFor("육전집 점심까지"))
        assertNotNull(device.findObject(By.text("출발할까요?")))
        assertNotNull(device.findObject(By.text("응, 출발")))
        assertNull(device.findObject(By.textContains("광주 직관 날이에요!")))
        assertNull(device.findObject(By.text("오늘 일정")))
    }

    private fun shell(command: String): String {
        val fd = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(fd).bufferedReader().use { it.readText() }
    }

    /** 이 앱 task의 id와 창 영역(left, top, right, bottom). */
    private fun appTask(): Pair<Int, IntArray> {
        val dump = shell("dumpsys activity activities")
        val taskId = Regex("""Task\{\S+ #(\d+) type=standard A=\d+:${instrumentation.targetContext.packageName}""").find(dump)!!.groupValues[1].toInt()
        val bounds = Regex("""mBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\) mAppBounds=Rect\(\1, \2 - \3, \4\)[^\n]*mActivityType=standard""")
            .find(dump)!!.groupValues.drop(1).map { it.toInt() }.toIntArray()
        return taskId to bounds
    }

    private fun cardAndContent(): Pair<Rect, Rect> {
        val pkg = instrumentation.targetContext.packageName
        val content = device.wait(Until.findObject(By.res("android:id/content")), TIMEOUT_MS).visibleBounds
        val card = device.wait(Until.findObject(By.res(pkg, "briefing_card")), TIMEOUT_MS).visibleBounds
        return card to content
    }

    @Test
    fun 세로와_가로_창에서_카드가_창_안에_완전히_들어온다() {
        launch()
        assertNotNull(waitFor("광주 직관 날이에요!"))
        val (taskId, original) = appTask()
        // 세로 창: 한 칸 너비(848). 가로 창: 원래 창(두 칸).
        val portrait = intArrayOf(original[2] - PORTRAIT_WIDTH, original[1], original[2], original[3])
        var portraitCardWidth = 0
        try {
            for ((name, b) in listOf("세로" to portrait, "가로" to original)) {
                shell("am task resize $taskId ${b[0]} ${b[1]} ${b[2]} ${b[3]}")
                device.waitForIdle()
                Thread.sleep(1_000)
                assertNotNull(waitFor("광주 직관 날이에요!"))
                val (card, content) = cardAndContent()
                assertTrue("$name: 카드 $card 가 창 $content 안에 있어야 함", content.contains(card))
                if (name == "가로") {
                    assertTrue("가로: 가로 가운데여야 함", Math.abs((card.left - content.left) - (content.right - card.right)) <= 2)
                    // 가로 카드 폭 ≈ 세로 카드 폭(한 칸 폭 기준), 양옆 여백 > 0
                    assertTrue("가로 카드 폭 ${card.width()} ≈ 세로 ${portraitCardWidth}", Math.abs(card.width() - portraitCardWidth) <= portraitCardWidth * 0.05)
                    assertTrue("가로: 양옆 여백", card.left - content.left > 0 && content.right - card.right > 0)
                } else {
                    assertTrue("세로: 카드가 창 너비를 채움", content.width() - card.width() <= 2)
                    portraitCardWidth = card.width()
                }
            }
        } finally {
            shell("am task resize $taskId ${original[0]} ${original[1]} ${original[2]} ${original[3]}")
        }
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
        const val PORTRAIT_WIDTH = 848
    }
}
