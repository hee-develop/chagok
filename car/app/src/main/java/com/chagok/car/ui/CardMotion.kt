package com.chagok.car.ui

import android.animation.ValueAnimator
import android.view.View
import android.view.animation.DecelerateInterpolator
import com.chagok.car.R

/**
 * 카드 등장·퇴장 움직임. 등장은 왼쪽에서 90px(환산) 밀려 들어오며 나타나고 500ms, 퇴장은 같은 방향(왼쪽)으로 400ms.
 * 곡선은 cubic ease-out(DecelerateInterpolator 1.5 = 1-(1-t)^3). 반복 장식 애니메이션은 없다.
 * 시스템 애니메이션이 꺼져 있으면 밀림 없이 페이드만 쓴다. 주행 제한으로 접을 때는 [exit]에 instant=true.
 */
object CardMotion {
    private const val ENTER_MS = 500L
    private const val EXIT_MS = 400L
    private const val FADE_ONLY_MS = 200L
    private val ease = DecelerateInterpolator(1.5f)

    fun enter(view: View, d: DesignScale) {
        cancel(view)
        view.visibility = View.VISIBLE
        val offset = d.dimen(R.dimen.card_enter_offset)
        if (ValueAnimator.areAnimatorsEnabled()) {
            view.translationX = -offset
            view.alpha = 0f
            view.animate().translationX(0f).alpha(1f).setDuration(ENTER_MS).setInterpolator(ease).start()
        } else {
            view.translationX = 0f
            fade(view, 0f, 1f, null)
        }
    }

    fun exit(view: View, d: DesignScale, instant: Boolean, onEnd: () -> Unit = {}) {
        cancel(view)
        if (instant || view.visibility != View.VISIBLE) {
            view.visibility = View.GONE
            onEnd()
            return
        }
        if (ValueAnimator.areAnimatorsEnabled()) {
            view.animate().translationX(-d.dimen(R.dimen.card_enter_offset)).alpha(0f)
                .setDuration(EXIT_MS).setInterpolator(ease)
                .withEndAction { view.visibility = View.GONE; onEnd() }
                .start()
        } else {
            fade(view, 1f, 0f) { view.visibility = View.GONE; onEnd() }
        }
    }

    private fun cancel(view: View) {
        view.animate().cancel()
        view.setTag(R.id.card_fade, null)
    }

    /** 애니메이터가 꺼진 상태에서도 보이는 짧은 페이드. 프레임 콜백으로 직접 알파를 바꾼다. */
    private fun fade(view: View, from: Float, to: Float, end: (() -> Unit)?) {
        val token = Any()
        view.setTag(R.id.card_fade, token)
        val start = System.nanoTime()
        view.alpha = from
        val step = object : Runnable {
            override fun run() {
                if (view.getTag(R.id.card_fade) !== token) return
                val t = ((System.nanoTime() - start) / 1e6f / FADE_ONLY_MS).coerceIn(0f, 1f)
                view.alpha = from + (to - from) * t
                if (t < 1f) view.postOnAnimation(this) else end?.invoke()
            }
        }
        view.postOnAnimation(step)
    }
}
