package com.chagok.car

import android.app.Activity
import android.os.Bundle
import android.util.Log

/**
 * 화면 없이 신호만 주입하고 바로 닫힌다. 주소의 쿼리(`chagok-debug://signal?gear=D`)나
 * `am start -n com.chagok.car/.SignalInjectActivity --es gear D` 의 extra로 [DebugSignals]의 값을 준다.
 */
class SignalInjectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri = intent.data
        try {
            DebugSignals.apply((application as ChagokApp).host) { key ->
                uri?.getQueryParameter(key) ?: intent.getStringExtra(key)
            }
        } catch (e: RuntimeException) {
            Log.w("ChagokDebug", "신호 주입 실패: $uri", e)
        }
        finish()
    }
}
