package com.chagok.car.runtime

import com.chagok.car.domain.Place

/** 말하기. 구현은 [VoiceAdapter]. */
interface Speaker {
    fun start()
    fun stop()
    fun speak(text: String)
    fun stopAll()
}

/** 목적지까지의 소요 시간 조회. 구현은 [NaviAdapter]. 결과는 세션 이벤트(TravelTimeResult)로 알린다. */
interface TravelTimeProvider {
    fun start()
    fun stop()
    fun requestTravelTime(requestId: Int, place: Place)
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
