package com.chagok.car

import android.app.Activity
import android.view.View
import com.chagok.car.runtime.UiState
import com.chagok.car.ui.CardAlign
import com.chagok.car.ui.DesignScale
import java.time.Clock

/** 릴리스 빌드에는 가짜 길안내 지도가 없다. 아무것도 하지 않는다. */
@Suppress("UNUSED_PARAMETER")
object FakeNavi {
    fun create(activity: Activity, d: DesignScale, clock: Clock): View? = null

    /** 카드 열 정렬: 릴리스는 늘 가로 가운데(지금 배치 그대로). */
    fun cardAlign(): CardAlign = CardAlign.CENTER

    fun render(state: UiState) = Unit

    fun onResume(onChanged: () -> Unit) = Unit

    fun onPause() = Unit

    fun onDestroy(activity: Activity) = Unit
}
