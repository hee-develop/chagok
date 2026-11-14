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
        // 기어·시동은 host.start()가 위치 권한과 무관하게 늘 켠다. 위치만 권한이 모두 있을 때 켠다(없으면 설명 카드 뒤 MainActivity가 요청한다).
        if (runtimePermissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) {
            host.startPermissionGatedSources()
        }
    }

    companion object {
        /**
         * 런타임(dangerous) 동의가 필요한 권한: 위치(일정 장소 도착·집 하차). Android 12 이상은 정밀 위치(FINE)를 요청할 때 대략 위치(COARSE)도 한 번에 요청해야 한다.
         * 백그라운드 위치 권한은 쓰지 않는다. 지금 쓰는 CAR_POWERTRAIN·NAVI_ROUTE·NAVI_ROUTE_SEARCH·TTS_SERVICE·STT_SERVICE는 모두 normal이다.
         * 거부하거나 대략 위치만 허용하면 위치 판정만 빠지고 나머지(기어·시동·내비 도착)는 그대로 동작한다.
         * 다른 dangerous 권한을 쓰는 기능(예: CAR_SPEED)이 생기면 여기에 더한다.
         */
        val RUNTIME_PERMISSIONS = listOf(
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.ACCESS_COARSE_LOCATION,
        )
    }
}
