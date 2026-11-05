package com.chagok.car.ui

import android.content.Context
import android.content.res.Resources
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.text.LineBreakConfig
import android.os.Build
import android.util.TypedValue
import android.widget.TextView
import androidx.annotation.ColorRes
import androidx.annotation.DimenRes
import androidx.annotation.StyleRes
import com.chagok.car.R

/**
 * 디자인 px → 실제 px 환산. 디자인 px는 "차곡 창 너비 800px 기준"이고(README '레이아웃'),
 * 이 클래스가 실제 창 크기에서 배율을 한 번만 계산해 모든 크기·글자에 적용한다.
 *
 * 배율은 [WindowLayout.scale]이 정한다: 세로 창은 창 너비 기준(높이가 모자라면 창 높이 / 640으로 줄임),
 * 가로 창은 한 칸 폭(창 너비의 절반)을 기준으로 해 세로 창과 같은 크기가 된다. 카드 너비([cardWidth])는 어느 창에서나 창 너비를 넘지 않는다.
 * 값은 [Context.getResources]의 창 설정(screenWidthDp·screenHeightDp)에서 읽으므로
 * 분할 화면처럼 앱 창이 화면보다 작아도 그 창 기준이다.
 */
class DesignScale private constructor(private val context: Context, val scale: Float) {
    private val res: Resources = context.resources

    /** 카드 너비(실제 px). 800 디자인 px × 배율. 화면에 놓을 때 가로 가운데로 둔다. */
    val cardWidth: Int get() = dimenInt(R.dimen.size_card_w)

    /** dimens.xml의 디자인 토큰 하나를 실제 px로 */
    fun dimen(@DimenRes id: Int): Float = res.getDimension(id) * scale

    fun dimenInt(@DimenRes id: Int): Int = dimen(id).toInt()

    /** 디자인 px를 직접 쓸 때(토큰에 없는 값) */
    fun px(designPx: Float): Float = designPx * scale * res.displayMetrics.density

    fun color(@ColorRes id: Int): Int = context.getColor(id)

    /** 토큰 글자 스타일(styles.xml)로 만든 TextView. 크기와 줄 높이에 배율을 곱한다. */
    fun text(@StyleRes style: Int, color: Int): TextView {
        val tv = TextView(context, null, 0, style)
        val attrs = context.obtainStyledAttributes(style, intArrayOf(android.R.attr.textSize, android.R.attr.lineHeight))
        try {
            tv.setTextSize(TypedValue.COMPLEX_UNIT_PX, attrs.getDimension(0, 0f) * scale)
            val lineHeight = attrs.getDimension(1, 0f) * scale
            if (lineHeight > 0f) tv.lineHeight = lineHeight.toInt()
        } finally {
            attrs.recycle()
        }
        tv.setTextColor(color)
        phraseBreak(tv)
        return tv
    }

    /**
     * 줄바꿈을 낱말 중간이 아니라 문구 단위로 한다(API 33 이상 lineBreakWordStyle=phrase).
     * 그 미만은 지금 동작을 유지한다.
     */
    fun phraseBreak(tv: TextView) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            tv.lineBreakWordStyle = LineBreakConfig.LINE_BREAK_WORD_STYLE_PHRASE
        }
    }

    /**
     * "12시 50분", "3시간 40분"처럼 숫자와 단위로 된 시각·시간은 줄바꿈이 사이에서 나지 않게 화면 글자에서만
     * 공백을 줄바꿈 없는 공백(NBSP)으로 바꾼다. 문구 데이터(와 TTS 문장)는 그대로 둔다.
     */
    fun keepTimesTogether(text: String): String = TIME_GAP.replace(text) { "${it.groupValues[1]}\u00A0${it.groupValues[2]}" }

    /** 굵기 600 */
    fun semibold(tv: TextView) {
        tv.typeface = Typeface.create(tv.typeface, 600, false)
    }

    /** 둥근 사각형 바탕. stroke가 0이면 테두리 없음 */
    fun shape(fill: Int?, radius: Float, strokeColor: Int = 0, strokeWidth: Float = 0f): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radius
            if (fill != null) setColor(fill)
            if (strokeWidth > 0f) setStroke(strokeWidth.coerceAtLeast(1f).toInt(), strokeColor)
        }

    companion object {
        private val TIME_GAP = Regex("(\\d+시간?) (\\d+분)")

        fun of(context: Context): DesignScale {
            val res = context.resources
            val density = res.displayMetrics.density
            val config = res.configuration
            val refW = res.getDimension(R.dimen.ref_window_w)
            val refH = res.getDimension(R.dimen.ref_window_h)
            val windowW = config.screenWidthDp * density
            val windowH = config.screenHeightDp * density
            val scale = WindowLayout.scale(windowW, windowH, refW, refH).coerceAtLeast(0.1f)
            return DesignScale(context, scale)
        }
    }
}
