package com.chagok.car.runtime

import com.chagok.car.domain.Place

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
}

/**
 * 기어·시동·주행 제한 신호. 구현은 [CarSignals].
 * [start]는 런타임 권한과 무관한 주행 제한 신호를 시작하고, [startPermissionGated]는 권한이 필요한 속성(기어·시동)을 시작한다.
 */
interface VehicleSignals {
    fun start()
    fun startPermissionGated()
    fun stop()
}
