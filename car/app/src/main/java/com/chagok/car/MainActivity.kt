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
import com.chagok.car.ui.CardAlign
import com.chagok.car.ui.CardContent
import com.chagok.car.ui.CardMotion
import com.chagok.car.ui.DesignScale
import com.chagok.car.ui.DuckingPill
import com.chagok.car.ui.NextChip
import com.chagok.car.ui.NoticePill

/**
 * 차곡 화면: BriefingCard, 결과 한 줄, DuckingPill, 권한 설명 카드.
 * 주행 중에는 카드를 접고 화면에 아무것도 말하거나 띄우지 않는다(DO로 선언). 결과 한 줄과 권한 설명 카드·요청도 주행 중에는 미룬다.
 * 주행 중에 남는 것은 정적인 글자 하나인 다음 일정 칩([NextChip])뿐이다. 창 왼쪽 위에 놓이고, 결과 한 줄은 주행 중에 안 보여 겹치지 않는다.
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
    private lateinit var nextChip: NextChip
    private lateinit var column: FrameLayout
    private lateinit var notices: LinearLayout

    /** 마지막으로 그린 카드. 같은 내용이면 다시 그리지 않아 AutoDismissBar 같은 진행 중인 표시가 처음으로 돌아가지 않는다. */
    private var boundCard: CardContent? = null

    /** 카드가 화면에 있거나 들어오는 중인가 */
    private var cardShown = false
    private var permissionCardShown = false
    private var driving = false
    private var locationNeeded = false
    private var firstRender = true

    /** 지금 카드 열에 적용한 정렬. 가짜 내비(디버그)가 켜지고 꺼질 때만 바뀐다. */
    private var align: CardAlign? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        d = DesignScale.of(this)
        val margin = d.dimenInt(R.dimen.space_2xl)
        // 카드 그림자가 부모 밖으로 번지도록 자식 자르기를 끈다.
        val root = FrameLayout(this).apply { clipChildren = false; clipToPadding = false }
        setContentView(root)
        // 디버그 빌드에만 있는 가짜 길안내 지도. 맨 아래에 깐다. 릴리스에서는 null.
        FakeNavi.create(this, d, host.clock)?.let { root.addView(it, 0, FrameLayout.LayoutParams(-1, -1)) }

        // 카드·알약은 카드 너비의 열 안에 두고 그 열을 창 가로 가운데에 놓는다(정렬은 [applyAlign]).
        // 세로 창에서는 열이 창 너비와 같고, 가로 창에서는 높이 기준 크기라 양옆이 빈다.
        column = FrameLayout(this).apply { clipChildren = false; clipToPadding = false }
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
            onPick = { host.post(Event.CandidatePressed(it)) }
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

        // 주행 중 다음 일정 칩. 표시 전용이고 카드 열이 아니라 창 왼쪽 위 모서리에 둔다(release 포함).
        // 칩은 주행 중에만 보이고 그때는 카드가 접혀 있다. 정차로 바뀌는 같은 이벤트에서 칩을 숨기므로 카드와 겹치지 않는다.
        nextChip = NextChip(this, d)
        root.addView(
            nextChip,
            FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START).apply { setMargins(margin, margin, margin, margin) },
        )

        // 디버그 빌드에만 있는 버튼 줄. 릴리스에서는 null.
        DebugRow.create(this, host)?.let {
            root.addView(it, FrameLayout.LayoutParams(-2, -2, Gravity.END or Gravity.BOTTOM).apply { bottomMargin = d.dimenInt(R.dimen.size_card_h) / 4 })
        }

        applyAlign()
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
        FakeNavi.onResume(::applyAlign)
    }

    override fun onDestroy() {
        FakeNavi.onDestroy(this)
        super.onDestroy()
    }

    override fun onPause() {
        FakeNavi.onPause()
        host.onActivityPaused()
        host.listener = null
        super.onPause()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != PERMISSION_REQUEST) return
        // 거부하면(대략 위치만 허용한 경우 포함) 짧은 안내만 보여 주고 말하지 않는다. 기어·시동은 권한과 무관하게 늘 읽는다.
        if (!driving && missingPermissions().isNotEmpty()) showDeniedNoticeOnce()
        host.startPermissionGatedSources()
    }

    /**
     * 카드 열을 [FakeNavi.cardAlign]대로 놓는다. 릴리스는 늘 가운데이고, 디버그에서 가짜 내비를 켜면 왼쪽 위(시안)다.
     * 정렬이 바뀔 때만 다시 배치한다. 왼쪽 여백은 열 안쪽으로 둬서 카드가 시안의 여백만큼 안으로 들어온다.
     */
    private fun applyAlign() {
        val next = FakeNavi.cardAlign()
        if (next == align) return
        align = next
        val windowWidth = (resources.configuration.screenWidthDp * resources.displayMetrics.density).toInt()
        val inset = next.inset(windowWidth, d.cardWidth, d.dimenInt(R.dimen.space_2xl))
        column.layoutParams = FrameLayout.LayoutParams(
            d.cardWidth + inset, -1,
            Gravity.TOP or if (next == CardAlign.START) Gravity.START else Gravity.CENTER_HORIZONTAL,
        )
        for (v in listOf(card, permissionCard)) {
            (v.layoutParams as FrameLayout.LayoutParams).leftMargin = inset
            v.requestLayout()
        }
    }

    private fun render(state: UiState) {
        FakeNavi.render(state)
        applyAlign()
        if (state.driving != driving) {
            driving = state.driving
            if (driving) hidePermissionUi() else requestRuntimePermissions()
        }
        // 위치를 쓸 일이 생기면(일정·집을 받은 뒤) 권한 흐름을 다시 판단한다. 쓸 일이 없으면 권한도 묻지 않는다.
        if (state.locationNeeded != locationNeeded) {
            locationNeeded = state.locationNeeded
            if (locationNeeded && !driving) requestRuntimePermissions()
        }
        val view = state.card
        // 세션 카드가 뜨면 권한 설명 카드는 같은 자리에서 겹치지 않게 걷고, 세션 카드가 닫힌 뒤 다시 보인다.
        if (view != null && permissionCardShown) {
            permissionCardShown = false
            CardMotion.exit(permissionCard, d, instant = true)
        }
        val sessionCardClosed = view == null && cardShown
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
        if (sessionCardClosed && !driving) requestRuntimePermissions()
        card.speaking = state.speaking && view != null
        nextChip.show(state.nextChip)
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

    /** 거부 안내 한 줄은 한 번 본 뒤에는 그 실행 동안 다시 띄우지 않는다(세션 카드가 닫힐 때마다 되풀이되지 않게). 화면을 다시 만들어도 유지된다. */
    private fun showDeniedNoticeOnce() {
        if (deniedNoticeShown) return
        deniedNoticeShown = true
        showPermissionNotice(Phrases.PERMISSION_DENIED)
    }

    /** 지금 상태(권한 보유, 주행 중, 이미 물음)에 맞게 권한 흐름을 진행한다. 규칙은 [PermissionGate]. */
    private fun requestRuntimePermissions() {
        permissionNotice.show("")
        // 위치를 쓸 일이 없으면(집 좌표도, 오늘 남은 장소 있는 일정도 없음) 위치 권한을 묻지 않는다(가이드: 필요할 때 필요한 권한만).
        if (missingPermissions().isNotEmpty() && !host.ui.locationNeeded) return
        when (PermissionGate.next(missingPermissions().isNotEmpty(), driving, permissionAsked)) {
            PermissionStep.START_SOURCES -> host.startPermissionGatedSources()
            PermissionStep.DEFER -> Unit
            PermissionStep.SHOW_DENIED -> {
                showDeniedNoticeOnce()
                host.startPermissionGatedSources()
            }
            // 다른 카드가 떠 있으면 미루고, 그 카드가 닫힐 때([render]) 다시 판단한다.
            PermissionStep.EXPLAIN -> if (!permissionCardShown && host.ui.card == null) showPermissionCard()
        }
    }

    private companion object {
        const val PERMISSION_REQUEST = 1

        // 프로세스 안에서 권한 설명 카드를 이미 띄웠는지(화면을 다시 만들어도 유지)
        var permissionAsked = false

        // 거부 안내 한 줄을 이미 보였는지(프로세스 안에서 유지)
        var deniedNoticeShown = false
    }
}
