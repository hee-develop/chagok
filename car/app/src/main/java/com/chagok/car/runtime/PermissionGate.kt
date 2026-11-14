package com.chagok.car.runtime

/** 런타임 권한 흐름에서 지금 할 일. */
enum class PermissionStep {
    /** 필요한 권한이 모두 있다. 권한이 필요한 신호를 시작한다. */
    START_SOURCES,

    /** 주행 중이라 권한 설명 카드와 요청을 미룬다. 정차·제한 해제 때 다시 판단한다. */
    DEFER,

    /** 이미 물었는데 거부된 상태. 거부 안내를 보이고 허용된 신호는 시작한다. */
    SHOW_DENIED,

    /** 쓰임새를 설명하는 카드를 띄운다. */
    EXPLAIN,
}

/** 세션 신호원. */
enum class Source { VEHICLE_SIGNALS, LOCATION }

/** 권한 설명 카드·요청을 언제 띄울지 정하는 규칙. 주행 중에는 동의 흐름을 띄우지 않는다. */
object PermissionGate {
    /**
     * 권한 결정과 무관하게 앱 시작 때 켜는 신호원. 기어·시동(CAR_POWERTRAIN)은 normal 권한이라 런타임 동의가 없고,
     * 위치 권한을 묻는 중이거나 거부해도 정차·탑승 판단이 되어야 한다.
     */
    val ALWAYS_ON: Set<Source> = setOf(Source.VEHICLE_SIGNALS)

    /** 런타임 권한(위치) 결정 뒤에만 켜는 신호원. 권한이 있을 때만 켜진다. */
    val AFTER_PERMISSION: Set<Source> = setOf(Source.LOCATION)

    fun next(missingAny: Boolean, driving: Boolean, alreadyAsked: Boolean): PermissionStep = when {
        !missingAny -> PermissionStep.START_SOURCES
        driving -> PermissionStep.DEFER
        alreadyAsked -> PermissionStep.SHOW_DENIED
        else -> PermissionStep.EXPLAIN
    }
}

/**
 * 앱 시작과 권한 결정 때 어떤 신호원을 켤지 [PermissionGate]의 구분대로 실행한다. [SessionHost]가 쓴다.
 * 기어·시동은 위치 권한과 무관하게 앱 시작 때 늘 켜고([startAtLaunch]), 위치만 권한 결정 뒤에 켠다([startAfterPermission]: 어댑터가 권한을 다시 확인해 없으면 아무것도 하지 않는다).
 */
class SourceStarter(private val signals: VehicleSignals, private val location: Locator) {
    /** 앱 시작 때 부른다. 권한을 묻는 중이거나 거부해도 기어·시동은 켠다. */
    fun startAtLaunch() {
        signals.start()
        if (Source.VEHICLE_SIGNALS in PermissionGate.ALWAYS_ON) signals.startPermissionGated()
    }

    /** 위치 권한 결정 뒤(또는 이미 받았을 때) 부른다. */
    fun startAfterPermission() {
        if (Source.LOCATION in PermissionGate.AFTER_PERMISSION) location.start()
    }
}
