package com.chagok.car

import android.app.Application
import android.content.pm.PackageManager
import com.chagok.car.runtime.SessionHost

/** 세션과 신호 어댑터를 Application 범위에 둔다. 앱이 뒤에 있어도 P단 시각 기록이 이어진다. */
open class ChagokApp : Application() {
    lateinit var host: SessionHost
        private set

    /** 런타임 동의가 필요한 권한. 모두 받았으면 설명 카드 없이 신호를 시작한다. 비어 있으면 카드를 띄우지 않는다. */
    open val runtimePermissions: List<String> = RUNTIME_PERMISSIONS

    protected open fun createHost(): SessionHost = SessionHost(this)

    override fun onCreate() {
        super.onCreate()
        host = createHost()
        host.start()
        if (runtimePermissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) {
            host.startPermissionGatedSources()
        }
    }

    companion object {
        /**
         * 런타임(dangerous) 동의가 필요한 권한. 탑승 브리핑이 쓰는 CAR_POWERTRAIN·NAVI_ROUTE·TTS_SERVICE 등은
         * 모두 normal이라 비어 있다. dangerous 권한을 쓰는 기능(예: CAR_SPEED, FUSED_LOCATION)이 생기면 여기에 더한다.
         */
        val RUNTIME_PERMISSIONS = emptyList<String>()
    }
}
