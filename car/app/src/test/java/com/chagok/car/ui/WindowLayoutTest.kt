package com.chagok.car.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WindowLayoutTest {
    private val refW = 800f
    private val refH = 640f

    private fun scale(w: Float, h: Float) = WindowLayout.scale(w, h, refW, refH)

    @Test fun `세로 창은 창 너비 기준이다`() {
        assertEquals(1.0f, scale(800f, 1280f), 0.0001f)
        assertEquals(1.5f, scale(1200f, 1900f), 0.0001f)
    }

    @Test fun `가로 창은 한 칸 폭 기준이라 세로 창과 같은 크기의 카드가 가운데에 놓인다`() {
        // 한 칸 848, 두 칸 1696(= 848 × 2), 높이 1210
        val portraitCard = refW * scale(848f, 1210f)
        val landscapeCard = refW * scale(1696f, 1210f)
        assertEquals(portraitCard, landscapeCard, 0.01f)
        assertTrue("양옆이 비어야 함", 1696f - landscapeCard > 0f)
    }

    @Test fun `가로 창에서 높이가 모자라면 높이 기준으로 줄인다`() {
        assertEquals(500f / 640f, scale(2000f, 500f), 0.0001f)
    }

    @Test fun `어느 방향이든 카드는 창 안에 완전히 들어온다`() {
        val windows = listOf(800f to 1280f, 1200f to 1900f, 800f to 576f, 1920f to 720f, 1280f to 600f, 700f to 650f, 1000f to 999f, 640f to 640f)
        for ((w, h) in windows) {
            val s = scale(w, h)
            assertTrue("너비 $w x $h", refW * s <= w + 0.01f)
            assertTrue("높이 $w x $h", refH * s <= h + 0.01f)
        }
    }

    @Test fun `가로 창은 너비가 높이보다 클 때다`() {
        assertTrue(WindowLayout.isLandscape(1920f, 720f))
        assertTrue(!WindowLayout.isLandscape(800f, 1280f))
        assertTrue(!WindowLayout.isLandscape(800f, 800f))
    }
}
