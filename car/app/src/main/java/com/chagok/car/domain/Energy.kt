package com.chagok.car.domain

import java.time.Duration
import kotlin.math.roundToInt

/**
 * 차의 연료 종류(정책서 9장 '차종 판단'). 서버 `POST /energy/options`의 `fuel` 값([server])과 같은 이름으로 고른다.
 * 하이브리드는 주유소 후보를 받으므로 [electric]이 false다.
 */
enum class EnergyKind(val server: String, val electric: Boolean) {
    EV("ev", true),
    GASOLINE("gasoline", false),
    DIESEL("diesel", false),
    HYBRID("hybrid", false),
    ;

    companion object {
        // AAOS VehicleFuelType(INFO_FUEL_TYPE의 값). 공개 상수에 기대지 않으려고 값을 그대로 둔다.
        private const val UNLEAD = 1
        private const val LEADED = 2
        private const val DIESEL_1 = 3
        private const val DIESEL_2 = 4
        private const val BIODIESEL = 5
        private const val E85 = 6
        private const val LPG = 7
        private const val CNG = 8
        private const val LNG = 9
        private const val ELECTRIC = 10

        /**
         * INFO_FUEL_TYPE(차가 쓸 수 있는 연료 목록)을 연료 종류로 바꾼다. 전기만 있으면 [EV], 전기와 다른 연료가 함께 있으면 [HYBRID],
         * 경유 계열이 있으면 [DIESEL], 그 밖의 주유 연료(휘발유·LPG·E85 등)는 [GASOLINE]. 수소·알 수 없는 값뿐이거나 비어 있으면 null(모름 → 에너지 체크를 하지 않는다).
         */
        fun fromFuelTypes(types: Collection<Int>): EnergyKind? {
            val fuels = types.filter { it in UNLEAD..ELECTRIC }
            if (fuels.isEmpty()) return null
            val electric = ELECTRIC in fuels
            val others = fuels.filter { it != ELECTRIC }
            return when {
                electric && others.isEmpty() -> EV
                electric -> HYBRID
                others.any { it == DIESEL_1 || it == DIESEL_2 || it == BIODIESEL } -> DIESEL
                others.any { it in setOf(UNLEAD, LEADED, E85, LPG, CNG, LNG) } -> GASOLINE
                else -> null
            }
        }
    }
}

/** 필요 거리를 센 끝이 어디인가. 문구가 "집까지"인지 "오늘 일정까지"인지 가른다. */
enum class EnergyGoal { HOME, LAST_SCHEDULE }

/** 필요 거리 계산 결과. [km]는 직선거리 합 × [Rules.ROAD_DETOUR_FACTOR]. */
data class EnergyNeed(val km: Double, val goal: EnergyGoal) {
    /** 말하는 거리(km, 반올림). */
    val spokenKm: Int get() = km.roundToInt()

    /** 필요 거리가 주행 가능 거리([rangeKm])의 [Rules.ENERGY_MARGIN]을 넘으면 모자람(정확히 같으면 모자라지 않다). */
    fun isShort(rangeKm: Double): Boolean = km > rangeKm * Rules.ENERGY_MARGIN

    companion object {
        /**
         * 정책서 9장: 필요 거리 = 남은 일정을 순서대로 도는 거리 + 마지막 일정에서 집까지.
         * [here]가 있으면 지금 위치에서 첫 일정 장소로 가는 구간부터 세고, 모르면 그 구간은 뺀다.
         * [stops]는 도착·건너뜀이 아니고 장소를 아는 일정의 장소를 시작 순으로 늘어놓은 것이다. [home]이 없으면 마지막 일정까지만 센다.
         * 세어 볼 구간이 하나도 없으면(점이 하나뿐) null: 판단할 거리가 없다.
         */
        fun of(here: LatLng?, stops: List<LatLng>, home: LatLng?): EnergyNeed? {
            val chain = listOfNotNull(here) + stops + listOfNotNull(home)
            if (chain.size < 2) return null
            val meters = chain.zipWithNext { a, b -> a.distanceTo(b) }.sum()
            val goal = if (home != null) EnergyGoal.HOME else EnergyGoal.LAST_SCHEDULE
            return EnergyNeed(meters / 1000.0 * Rules.ROAD_DETOUR_FACTOR, goal)
        }
    }
}

/** 에너지를 채울 곳의 종류(서버 후보의 `kind`). */
enum class EnergyStopKind { SLOW_CHARGER, FAST_CHARGER, GAS_STATION }

/** 서버가 준 충전소·주유소 후보 하나. 길안내 경유지로 넣을 좌표는 [place]다. 모르는 값은 null. */
data class EnergyStop(
    val id: String,
    val kind: EnergyStopKind,
    val place: Place,
    /** 충전 후보의 빈 충전기 수. 모르면 null */
    val availableCount: Int? = null,
    val totalCount: Int? = null,
    val powerKw: Int? = null,
    /** 주유 후보의 가격(원/L)과 연료(gasoline·diesel) */
    val priceWon: Int? = null,
    val priceFuel: String? = null,
)

/** 서버 `POST /energy/options` 응답에서 차가 쓰는 것. [stops]가 비어 있으면(조회 실패·후보 없음) 에너지 제안은 하지 않는다. */
data class EnergyOptions(
    val stops: List<EnergyStop>,
    /** 맨 앞 후보가 식사할 수 있는 휴게소라 '식사 + 급속 충전'으로 묶는가 */
    val mealBundle: Boolean = false,
    /** 충전기 상태를 새로 받지 못해 낡은 데이터로 답했는가(빈 충전기 수를 단정하지 않는다) */
    val stale: Boolean = false,
    val partial: Boolean = false,
)

/** 서버에 묻는 값. 차는 필요 거리·90% 판단을 먼저 하고 모자랄 때만 묻는다. */
data class EnergyRequest(
    val fuel: EnergyKind,
    val origin: LatLng,
    val destination: LatLng,
    /** 대상 일정이 머무는 시간(전기차만 보낸다). 모르면 null */
    val stay: Duration?,
    val at: java.time.ZonedDateTime,
)
