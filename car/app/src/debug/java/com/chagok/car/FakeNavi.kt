package com.chagok.car

import android.app.Activity
import android.view.View
import com.chagok.car.fakenavi.FakeNaviLayer
import com.chagok.car.fakenavi.FakeNaviScrim
import com.chagok.car.fakenavi.FakeNaviSession
import com.chagok.car.runtime.UiState
import com.chagok.car.ui.CardAlign
import com.chagok.car.ui.DesignScale
import java.time.Clock

/**
 * 디버그 빌드 전용 가짜 길안내 지도 층의 MainActivity 연결 창구. 릴리스 소스셋에는 아무것도 하지 않는 같은 이름의 객체가 있다.
 * 지도는 [DebugInjection.fakeNavi]가 켜져 있을 때만 보인다.
 */
object FakeNavi {
    private var layer: FakeNaviLayer? = null

    /** MainActivity 루트 맨 아래에 깔 지도 층. 화면을 만들 때 한 번 부른다. */
    fun create(activity: Activity, d: DesignScale, clock: Clock): View? =
        FakeNaviLayer(activity, d, clock).also {
            it.refresh()
            layer = it
        }

    /**
     * 카드 열의 정렬. 가짜 내비가 켜져 있으면 시안처럼 왼쪽 위([CardAlign.START]), 꺼져 있으면 가로 가운데.
     * (릴리스 소스셋의 같은 이름 함수는 늘 가운데다.)
     */
    fun cardAlign(): CardAlign = alignFor(FakeNaviSession.shared.enabled)

    /** [cardAlign]의 규칙: 켜짐 여부만 본다. */
    internal fun alignFor(enabled: Boolean): CardAlign = if (enabled) CardAlign.START else CardAlign.CENTER

    /** 화면 상태를 알린다. 주행 중일 때만 차가 가고, 카드가 있으면 패널을 숨기고 덮개를 깐다. */
    fun render(state: UiState) {
        FakeNaviSession.shared.setDriving(state.driving)
        layer?.duckingShown = state.ducking
        layer?.exitCardShown = FakeNaviScrim.isExitCard(state.card)
        layer?.cardShown = state.card != null
    }

    /** [onChanged]는 가짜 내비가 켜지거나 꺼지는 등 상태가 바뀔 때 불린다(MainActivity가 카드 열 정렬을 다시 정한다). */
    fun onResume(onChanged: () -> Unit) {
        FakeNaviSession.shared.onChanged = {
            layer?.refresh()
            onChanged()
        }
        FakeNaviSession.shared.onResume()
        layer?.refresh()
    }

    /**
     * Activity를 붙잡지 않게 층과 콜백을 비운다. 지금 층이 [activity]의 것일 때만 비운다
     * (새 Activity가 이미 자기 층과 콜백을 등록했다면 건드리지 않는다).
     */
    fun onDestroy(activity: Activity) {
        if (layer?.context !== activity) return
        layer = null
        FakeNaviSession.shared.onChanged = null
        FakeNaviSession.shared.onModeChanged = null
        DebugInjection.heardProcessed = null
    }

    fun onPause() {
        FakeNaviSession.shared.onPause()
        FakeNaviSession.shared.onChanged = null
    }
}
