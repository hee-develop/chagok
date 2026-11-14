package com.chagok.car.domain

import java.time.Instant

data class LatLng(val lat: Double, val lng: Double) {
    /** 두 점 사이 거리(미터). 지구를 반지름 6,371km 공으로 본 대원 거리(haversine)라 도착 판정(수백 m)에는 충분하다. */
    fun distanceTo(other: LatLng): Double {
        val dLat = Math.toRadians(other.lat - lat)
        val dLng = Math.toRadians(other.lng - lng)
        val a = Math.sin(dLat / 2).let { it * it } +
            Math.cos(Math.toRadians(lat)) * Math.cos(Math.toRadians(other.lat)) * Math.sin(dLng / 2).let { it * it }
        return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a.coerceIn(0.0, 1.0)))
    }

    private companion object {
        const val EARTH_RADIUS_M = 6_371_000.0
    }
}

data class Place(val name: String, val position: LatLng)

/** 폰 첫 설정 2단계에서 정한 자주 가는 곳의 자리. */
enum class FavoriteKind { HOME, WORK, OTHER }

/** 자주 가는 곳 하나. 서버 `GET /schedules/today`의 favorites로 받는다(집 → 회사 → 추가한 순서). */
data class Favorite(val kind: FavoriteKind, val place: Place, val address: String? = null)

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
    /** 폰 앱에서 이 일정에 적은 채비 한 줄. 캘린더에는 없고 차곡 서버에만 있다. 메모보다 먼저 읽는다. */
    val care: String? = null,
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
