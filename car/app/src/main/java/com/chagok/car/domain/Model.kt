package com.chagok.car.domain

import java.time.Instant

data class LatLng(val lat: Double, val lng: Double)

data class Place(val name: String, val position: LatLng)

/** 정책서 11장: 폰 앱이 보내고 서버가 그날까지 맡아 두는 일정 한 건. */
data class Schedule(
    val id: String,
    val title: String,
    val start: Instant,
    val end: Instant,
    /** 캘린더 장소 칸 원문 */
    val locationText: String? = null,
    /** 8장 장소 해석으로 좌표를 정한 곳. 아직 못 정했으면 null */
    val place: Place? = null,
    val memo: String? = null,
    val attendees: List<String> = emptyList(),
    /** 종일 일정. 길안내 대상이 아니고 첫 탑승 인사에만 쓴다(screens.md). */
    val allDay: Boolean = false,
)

/** 3장: 예정 → (늦음) → 도착, 또는 예정 → 건너뜀. 도착과 건너뜀은 되돌아가지 않는다. */
enum class ScheduleStatus {
    PLANNED, LATE, ARRIVED, SKIPPED;

    val isFinal get() = this == ARRIVED || this == SKIPPED
}

enum class Gear { PARK, NEUTRAL, REVERSE, DRIVE, UNKNOWN }

enum class Motion {
    STOPPED, DRIVING, UNKNOWN;

    companion object {
        /**
         * 정차 판정 규칙. 차곡은 정차 중에만 먼저 말하므로 정차는 기어로 정한다: P·N이면 [STOPPED]
         * (D에서 속도가 0이어도 정차가 아니다). D·R이거나 주행 제한 알림(distraction optimization 필요)이 켜져 있으면
         * [DRIVING]이고, 기어와 제한이 서로 다르면 주행으로 본다. 기어를 모르고 제한도 없으면 [UNKNOWN].
         */
        fun of(gear: Gear, requiresDistractionOptimization: Boolean): Motion = when {
            gear == Gear.DRIVE || gear == Gear.REVERSE || requiresDistractionOptimization -> DRIVING
            gear == Gear.PARK || gear == Gear.NEUTRAL -> STOPPED
            else -> UNKNOWN
        }
    }
}

/** 시동 상태. 차량 값(AAOS VehicleIgnitionState)을 어댑터가 이 값으로 바꿔 넣는다. */
enum class Ignition { UNDEFINED, LOCK, OFF, ACC, ON, START }
