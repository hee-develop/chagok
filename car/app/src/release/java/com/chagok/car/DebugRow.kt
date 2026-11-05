package com.chagok.car

import android.app.Activity
import android.view.View
import com.chagok.car.runtime.SessionHost

/** 릴리스 빌드에는 디버그 버튼 줄이 없다. */
object DebugRow {
    @Suppress("UNUSED_PARAMETER")
    fun create(activity: Activity, host: SessionHost): View? = null
}
