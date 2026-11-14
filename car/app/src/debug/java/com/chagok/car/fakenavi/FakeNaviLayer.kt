package com.chagok.car.fakenavi

import android.content.Context
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.chagok.car.R
import com.chagok.car.ui.DesignScale
import java.time.Clock

/**
 * MainActivity 맨 아래에 깔리는 가짜 길안내 층(화면 시안 Drive·Main·Arrive): 창 전체를 채우는 지도, 카드가 뜰 때의 검정 50% 덮개(하차 카드는 72%),
 * 왼쪽 아래 길안내 패널, 오른쪽 위 "시연용 가짜 지도" 표시.
 *
 * 크기: 시안 1600×640의 px는 이 앱의 디자인 px(창 한 칸 너비 800 기준)와 같은 단위다. 시안의 카드가 800×592로 앱의 카드 규격과 같고
 * 칩 높이 60·모서리 24·여백 24도 토큰과 같기 때문이다. 그래서 시안 px를 [DesignScale]에 그대로 넣어
 * 창 크기에 맞는 배율로 키우고 같은 모서리에 둔다(창은 시안과 비율이 달라 지도만 창 전체로 늘린다).
 *
 * 패널은 왼쪽 아래 모서리이고 카드가 떠 있으면 숨긴다(시안 Main에는 패널이 없다). 볼륨 낮춤 알약(왼쪽 아래)이 떠 있는 동안은
 * 겹치지 않게 패널을 알약 위로 올린다. 오른쪽 아래는 디버그 버튼 줄 자리다.
 */
class FakeNaviLayer(context: Context, private val d: DesignScale, private val clock: Clock) : FrameLayout(context) {
    private val map = FakeMapView(context, d)
    private val scrim = View(context)
    private var appliedScrimColor = d.color(R.color.scrim)

    // 시안 패널: 1줄 17px ink-3, 2줄 큰 시각 38px(이 앱은 400·600만 써서 600)과 20px ink-2를 기준선에 맞춰 나란히
    private val destination: TextView = d.text(R.style.t_status, d.color(R.color.ink_3)).apply {
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }
    private val headline: TextView = d.text(R.style.t_voice, d.color(R.color.ink)).apply {
        // 한 줄 고정. 긴 장소 이름은 문구를 만들 때 줄인다([FakeNaviPhrases.arrived]).
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }
    private val detail: TextView = d.text(R.style.t_chip, d.color(R.color.ink_2)).apply { maxLines = 1 }
    private val bigRow = LinearLayout(context)
    private val panel = LinearLayout(context)

    /** 카드가 떠 있는가. 떠 있으면 덮개를 깔고 패널을 숨긴다. */
    var cardShown = false
        set(value) {
            if (field == value) return
            field = value
            refresh()
        }

    /** 떠 있는 카드가 하차 카드인가. 맞으면 덮개를 72%로 더 어둡게 한다([FakeNaviScrim]). */
    var exitCardShown = false
        set(value) {
            if (field == value) return
            field = value
            refresh()
        }

    /** 볼륨 낮춤 알약이 떠 있는가. 떠 있으면 패널을 알약 위로 올린다. */
    var duckingShown = false
        set(value) {
            if (field == value) return
            field = value
            applyPanelMargin()
        }

    init {
        addView(map, LayoutParams(-1, -1))
        scrim.setBackgroundColor(d.color(R.color.scrim))
        scrim.visibility = GONE
        addView(scrim, LayoutParams(-1, -1))

        panel.apply {
            orientation = LinearLayout.VERTICAL
            background = d.shape(d.color(R.color.surface_100), d.dimen(R.dimen.radius_xl))
            setPadding(d.px(26f).toInt(), d.px(22f).toInt(), d.px(26f).toInt(), d.px(22f).toInt())
            addView(destination)
            bigRow.orientation = LinearLayout.HORIZONTAL
            bigRow.addView(headline)
            bigRow.addView(detail, LinearLayout.LayoutParams(-2, -2).apply { marginStart = d.dimenInt(R.dimen.space_m) })
            addView(bigRow, LinearLayout.LayoutParams(-2, -2).apply { topMargin = d.dimenInt(R.dimen.space_2xs) })
            visibility = View.GONE
        }
        addView(panel, LayoutParams(d.px(PANEL_W).toInt(), -2, Gravity.BOTTOM or Gravity.START))
        applyPanelMargin()

        val margin = d.dimenInt(R.dimen.space_2xl)
        val badge = d.text(R.style.t_chip, d.color(R.color.ink_4)).apply { text = FakeNaviPhrases.BADGE }
        addView(badge, LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(margin, margin, margin, margin) })
    }

    private fun applyPanelMargin() {
        val margin = d.dimenInt(R.dimen.space_2xl)
        // 알약(볼륨 낮춤)은 같은 모서리에 있다. 높이는 세로 패딩 둘 + 아이콘, 간격은 space-s로 잡아 그 위로 올린다.
        val raise = if (duckingShown) 2 * d.dimenInt(R.dimen.status_pad_v) + d.dimenInt(R.dimen.ducking_icon) + d.dimenInt(R.dimen.space_s) else 0
        val lp = panel.layoutParams as LayoutParams
        if (lp.leftMargin != margin || lp.bottomMargin != margin + raise) {
            lp.setMargins(margin, 0, 0, margin + raise)
            panel.requestLayout()
        }
    }

    /**
     * 켜고 끔, 경로, 차 위치, 카드 유무가 바뀔 때 다시 채운다.
     * 지도는 차의 화면 좌표가 1px 이상 바뀔 때만, 패널은 문구가 바뀔 때만 갱신한다.
     */
    fun refresh() {
        val shown = if (FakeNaviSession.shared.enabled) View.VISIBLE else View.GONE
        if (visibility != shown) visibility = shown
        val trip = FakeNaviSession.shared.trip
        map.trip = trip
        map.syncCar()
        // 덮개는 카드가 있을 때만(시안 Main). 카드가 없으면 지도가 그대로 보인다.
        val scrimShown = if (cardShown) View.VISIBLE else View.GONE
        if (scrim.visibility != scrimShown) scrim.visibility = scrimShown
        val scrimColor = FakeNaviScrim.color(d.color(R.color.scrim), exitCardShown)
        if (scrimColor != appliedScrimColor) {
            appliedScrimColor = scrimColor
            scrim.setBackgroundColor(scrimColor)
        }
        if (trip == null || cardShown) {
            if (panel.visibility != View.GONE) panel.visibility = View.GONE
            return
        }
        val content = FakeNaviPhrases.panel(trip, clock.instant(), clock.zone)
        var changed = setText(destination, content.destination ?: "")
        changed = setText(headline, content.headline) or changed
        changed = setText(detail, content.detail ?: "") or changed
        val destinationVisibility = if (content.destination == null) View.GONE else View.VISIBLE
        if (destination.visibility != destinationVisibility) {
            destination.visibility = destinationVisibility
            changed = true
        }
        val detailVisibility = if (content.detail == null) View.GONE else View.VISIBLE
        if (detail.visibility != detailVisibility) {
            detail.visibility = detailVisibility
            changed = true
        }
        if (panel.visibility != View.VISIBLE) {
            panel.visibility = View.VISIBLE
            changed = true
        }
        // 문구나 줄 수가 바뀌면 패널 높이를 다시 잰다.
        if (changed) panel.requestLayout()
    }

    private fun setText(view: TextView, text: String): Boolean {
        if (view.text.toString() == text) return false
        view.text = text
        return true
    }

    private companion object {
        /** 시안 패널 폭(디자인 px) */
        const val PANEL_W = 420f
    }
}
