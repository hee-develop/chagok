package com.chagok.car.runtime

import android.util.Log
import com.chagok.car.flow.Logger

/** [Logger]를 android.util.Log로 남긴다. */
object AndroidLogger : Logger {
    override fun warn(tag: String, message: String, error: Throwable?) {
        Log.w(tag, message, error)
    }
}
