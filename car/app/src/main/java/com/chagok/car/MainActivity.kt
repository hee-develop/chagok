package com.chagok.car

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.window.OnBackInvokedDispatcher
import com.chagok.car.flow.Event
import com.chagok.car.flow.Phrases
import com.chagok.car.runtime.PermissionGate
import com.chagok.car.runtime.PermissionStep
import com.chagok.car.runtime.SessionHost
import com.chagok.car.runtime.UiState
import com.chagok.car.ui.BriefingCardView
import com.chagok.car.ui.CardContent
import com.chagok.car.ui.CardMotion
import com.chagok.car.ui.DesignScale
import com.chagok.car.ui.DuckingPill
import com.chagok.car.ui.NoticePill

/**
 * 차곡 화면: BriefingCard, 결과 한 줄, DuckingPill, 권한 설명 카드.
 * 주행 중에는 카드를 접고 화면에 아무것도 말하거나 띄우지 않는다(DO로 선언). 결과 한 줄과 권한 설명 카드·요청도 주행 중에는 미룬다.
 * 상태와 흐름은 [SessionHost]가 갖고, 여기서는 그리고 버튼을 이벤트로 넘기기만 한다.
 * 최상위 화면이므로 Back은 종료하지 않고 숨긴다(moveTaskToBack, CCP 가이드).
 */
class MainActivity : Activity() {

    private val host: SessionHost get() = (application as ChagokApp).host

    private lateinit var d: DesignScale
    private lateinit var card: BriefingCardView
    private lateinit var result: NoticePill
    private lateinit var permissionNotice: NoticePill
    private lateinit var permissionCard: BriefingCardView
    private lateinit var ducking: DuckingPill
    private lateinit var notices: LinearLayout

    /** 마지막으로 그린 카드. 같은 내용이면 다시 그리지 않아 AutoDismissBar 같은 진행 중인 표시가 처음으로 돌아가지 않는다. */
    private var boundCard: CardContent? = null

    /** 카드가 화면에 있거나 들어오는 중인가 */
    private var cardShown = false
    private var permissionCardShown = false
    private var driving = false
    private var firstRender = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        d = DesignScale.of(this)
        val margin = d.dimenInt(R.dimen.space_2xl)
        // 카드 그림자가 부모 밖으로 번지도록 자식 자르기를 끈다.
        val root = FrameLayout(this).apply { clipChildren = false; clipToPadding = false }
        setContentView(root)

        // 카드·알약은 카드 너비의 열 안에 두고 그 열을 창 가로 가운데에 놓는다.
        // 세로 창에서는 열이 창 너비와 같고, 가로 창에서는 높이 기준 크기라 양옆이 빈다.
        val column = FrameLayout(this).apply { clipChildren = false; clipToPadding = false }
        root.addView(column, FrameLayout.LayoutParams(d.cardWidth, -1, Gravity.TOP or Gravity.CENTER_HORIZONTAL))

        fun cardParams() = FrameLayout.LayoutParams(d.cardWidth, d.dimenInt(R.dimen.size_card_h), Gravity.TOP or Gravity.START)
            .apply { topMargin = margin }

        permissionCard = BriefingCardView(this, d).apply {
            visibility = View.GONE
            onPrimary = ::onPermissionConfirmed
        }
        column.addView(permissionCard, cardParams())

        card = BriefingCardView(this, d).apply {
            visibility = View.GONE
            onPrimary = { host.post(Event.PrimaryPressed) }
            onSecondary = { host.post(Event.SecondaryPressed) }
        }
        column.addView(card, cardParams())

        result = NoticePill(this, d)
        permissionNotice = NoticePill(this, d)
        notices = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(result)
            addView(permissionNotice, LinearLayout.LayoutParams(-2, -2).apply { topMargin = d.dimenInt(R.dimen.space_s) })
        }
        column.addView(
            notices,
            FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START).apply { setMargins(margin, margin, margin, margin) },
        )

        ducking = DuckingPill(this, d, Phrases.DUCKING)
        column.addView(
            ducking,
            FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START).apply { setMargins(margin, margin, margin, margin) },
        )

        // 디버그 빌드에만 있는 버튼 줄. 릴리스에서는 null.
        DebugRow.create(this, host)?.let {
            root.addView(it, FrameLayout.LayoutParams(-2, -2, Gravity.END or Gravity.BOTTOM).apply { bottomMargin = d.dimenInt(R.dimen.size_card_h) / 4 })
        }

        registerBackToHide()
        driving = host.ui.driving
        requestRuntimePermissions()
    }

    /** 최상위 화면에서 Back이 오면 종료하지 않고 숨긴다. API 33 이상은 OnBackInvokedCallback으로 받는다. */
    private fun registerBackToHide() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) {
                moveTaskToBack(true)
            }
        }
    }

    @Deprecated("API 33 미만에서만 불린다. 33 이상은 OnBackInvokedCallback")
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        moveTaskToBack(true)
    }

    override fun onResume() {
        super.onResume()
        host.listener = ::render
        host.onActivityResumed()
    }

    override fun onPause() {
        host.onActivityPaused()
        host.listener = null
        super.onPause()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != PERMISSION_REQUEST) return
        // 거부하면 짧은 안내만 보여 주고 말하지 않는다. 허용된 신호(기어 등)는 그대로 쓴다.
        if (!driving && missingPermissions().isNotEmpty()) showPermissionNotice(Phrases.PERMISSION_DENIED)
        host.startPermissionGatedSources()
    }

    private fun render(state: UiState) {
        if (state.driving != driving) {
            driving = state.driving
            if (driving) hidePermissionUi() else requestRuntimePermissions()
        }
        val view = state.card
        if (view != null) {
            if (view != boundCard) card.bind(view, freshlyShown = !cardShown)
            boundCard = view
            if (!cardShown) {
                cardShown = true
                // 화면을 다시 만든 뒤 첫 그리기에서 이미 떠 있던 카드는 애니메이션 없이 보인다.
                if (firstRender) showWithoutMotion(card) else CardMotion.enter(card, d)
            }
        } else if (cardShown) {
            cardShown = false
            boundCard = null
            // 주행 제한으로 접을 때는 애니메이션 없이 바로 접는다.
            CardMotion.exit(card, d, instant = state.collapseInstantly || firstRender)
        }
        firstRender = false
        card.speaking = state.speaking && view != null
        ducking.visibility = if (state.ducking) View.VISIBLE else View.GONE
        val resultText = if (driving || view != null) "" else state.result
        result.show(resultText)
        (permissionNotice.layoutParams as LinearLayout.LayoutParams).topMargin =
            if (resultText.isEmpty()) 0 else d.dimenInt(R.dimen.space_s)
        permissionNotice.requestLayout()
    }

    private fun showWithoutMotion(view: View) {
        view.animate().cancel()
        view.alpha = 1f
        view.translationX = 0f
        view.visibility = View.VISIBLE
    }

    /** 권한을 요청하기 전에 쓰임새를 먼저 설명하는 카드. 버튼을 누르면 요청한다. */
    private fun showPermissionCard() {
        permissionCard.bind(
            CardContent(
                status = "",
                voice = Phrases.PERMISSION_VOICE,
                sub = Phrases.PERMISSION_SUB,
                primary = Phrases.PERMISSION_CONFIRM,
            ),
        )
        permissionCardShown = true
        CardMotion.enter(permissionCard, d)
    }

    /** 주행이 시작되면 권한 설명 카드와 안내를 바로 걷는다. 정차하면 [requestRuntimePermissions]가 다시 판단한다. */
    private fun hidePermissionUi() {
        permissionNotice.show("")
        if (permissionCardShown) {
            permissionCardShown = false
            CardMotion.exit(permissionCard, d, instant = true)
        }
    }

    private fun onPermissionConfirmed() {
        permissionCardShown = false
        CardMotion.exit(permissionCard, d, instant = false)
        permissionAsked = true
        requestPermissions(missingPermissions().toTypedArray(), PERMISSION_REQUEST)
    }

    private fun missingPermissions() =
        (application as ChagokApp).runtimePermissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

    private fun showPermissionNotice(message: String) {
        permissionNotice.show(message)
    }

    /** 지금 상태(권한 보유, 주행 중, 이미 물음)에 맞게 권한 흐름을 진행한다. 규칙은 [PermissionGate]. */
    private fun requestRuntimePermissions() {
        permissionNotice.show("")
        when (PermissionGate.next(missingPermissions().isNotEmpty(), driving, permissionAsked)) {
            PermissionStep.START_SOURCES -> host.startPermissionGatedSources()
            PermissionStep.DEFER -> Unit
            PermissionStep.SHOW_DENIED -> {
                showPermissionNotice(Phrases.PERMISSION_DENIED)
                host.startPermissionGatedSources()
            }
            PermissionStep.EXPLAIN -> if (!permissionCardShown) showPermissionCard()
        }
    }

    private companion object {
        const val PERMISSION_REQUEST = 1

        // 프로세스 안에서 권한 설명 카드를 이미 띄웠는지(화면을 다시 만들어도 유지)
        var permissionAsked = false
    }
}
