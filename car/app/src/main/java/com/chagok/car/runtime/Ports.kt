package com.chagok.car.runtime

import com.chagok.car.domain.Place
import com.chagok.car.flow.Event

/**
 * 말하기와 듣기. 구현은 [VoiceAdapter].
 * [speak]의 thenListen이 true면 말이 끝난 뒤 듣고 결과를 세션 이벤트(Heard)로 알린다. [stopAll]은 말하기와 듣기를 모두 멈춘다.
 */
interface Speaker {
    fun start()
    fun stop()
    fun speak(text: String, thenListen: Boolean)
    fun stopAll()
}

/**
 * 내비게이션. 구현은 [NaviAdapter].
 * 소요 시간 조회 결과는 세션 이벤트(TravelTimeResult)로 알린다. [startRoute]는 요청을 내비에 보냈는지를 바로 돌려준다.
 */
interface Navigator {
    fun start()
    fun stop()
    fun requestTravelTime(requestId: Int, place: Place)
    fun startRoute(place: Place): Boolean

    /** 현재 위치를 한 번 묻는다(P단 도착 판단). 답은 세션 이벤트(LocationChanged)로 알리고, 내비에 연결 전이면 묻지 않는다. */
    fun requestLocation()
}

/**
 * 기어·시동·주행 제한 신호. 구현은 [CarSignals].
 * [start]는 주행 제한 신호를, [startPermissionGated]는 Car 속성(기어·시동)을 시작한다. 둘 다 위치 권한과 무관하게 앱 시작 때 켠다
 * (이름은 CAR_POWERTRAIN 같은 권한이 필요한 속성이라는 뜻이고, 런타임 동의는 없다. [PermissionGate.ALWAYS_ON]).
 */
interface VehicleSignals {
    fun start()
    fun startPermissionGated()
    fun stop()
}

/**
 * 차의 위치. 구현은 [LocationAdapter]. 실차의 Pleos FusedLocation으로 바꿀 때는 이 인터페이스만 새로 구현하면 된다.
 * 위치는 달린 뒤 P단에 넣을 때 일정 장소 도착·집 하차를 판정하는 데만 쓰고(세션 이벤트 [Event.LocationChanged]),
 * 권한이 없거나 못 읽으면 이벤트가 오지 않아 위치 판정만 빠진다(기어·시동·내비 도착은 그대로).
 */
interface Locator {
    /** 위치 권한이 있을 때 읽기를 시작한다. 권한이 없으면 아무것도 하지 않는다. 여러 번 불러도 된다. */
    fun start()

    /** 읽기를 모두 멈춘다. */
    fun stop()

    /** 앱 화면이 앞에 있는가. 앞에 있을 때만 주기 갱신을 하고, 뒤로 가면 멈춘다(배터리·리소스 가이드). */
    fun setForeground(foreground: Boolean)

    /**
     * 지금 위치를 쓸 일이 있는가(세션이 알린다: 집 좌표가 있거나 오늘 남은 일정 중 장소가 있는 것이 있음). false면 주기·수동 갱신을 켜지 않고 켜져 있던 것도 끈다.
     * 처음 값은 false라 일정·집을 받아 쓸 일이 생길 때까지 센서를 읽지 않는다.
     */
    fun setNeeded(needed: Boolean)

    /**
     * 시스템이 마지막으로 아는 위치(다른 앱·내비가 갱신해 둔 것 포함)를 지금 읽어 [deliver]로 바로 넘긴다. 메인 스레드에서 부르고 [deliver]도 그 자리에서 실행한다.
     * P단에 넣는 순간 부르면, 차곡이 뒤에 있어 주기 갱신을 못 받았어도 내비가 갱신해 둔 최근 위치로 판정할 수 있다.
     */
    fun refreshNow(deliver: (Event) -> Unit)

    /** 위치를 쓰지 않는 구성(테스트·미지원). */
    object None : Locator {
        override fun start() = Unit
        override fun stop() = Unit
        override fun setForeground(foreground: Boolean) = Unit
        override fun setNeeded(needed: Boolean) = Unit
        override fun refreshNow(deliver: (Event) -> Unit) = Unit
    }
}
