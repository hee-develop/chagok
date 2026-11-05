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

/** 권한 설명 카드·요청을 언제 띄울지 정하는 규칙. 주행 중에는 동의 흐름을 띄우지 않는다. */
object PermissionGate {
    fun next(missingAny: Boolean, driving: Boolean, alreadyAsked: Boolean): PermissionStep = when {
        !missingAny -> PermissionStep.START_SOURCES
        driving -> PermissionStep.DEFER
        alreadyAsked -> PermissionStep.SHOW_DENIED
        else -> PermissionStep.EXPLAIN
    }
}
