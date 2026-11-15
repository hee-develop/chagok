package com.chagok.car.fakenavi

import com.chagok.car.domain.Place
import java.time.Duration
import java.time.Instant

/**
 * 가짜 경로를 달리는 중인 차의 진행. 시연용 시간 압축으로 전체 경로를 [driveMillis]밀리초에 지나간다.
 * 앞으로 가는 것은 주행 중일 때뿐이다([advance]의 driving). 도착 여부는 [arrived] 하나로만 판정한다.
 * [travelTime]을 주면(디버그 신호 `trip`) 패널의 남은 시간·도착 예정은 경로 길이로 구한 값 대신 그 값을 쓴다. 지나가는 실제 시간은 그대로 [driveMillis]다.
 *
 * 도착 예정 시각([arrivalAt])은 출발 시각([departedAt], 데모 시계) + 경로 전체 소요 시간으로 **경로를 시작할 때 한 번 정해져 고정**이다.
 * 달리는 동안 줄어드는 것은 [remainingMeters]·[remainingDuration]뿐이다. (남은 시간 + 지금 시각으로 매번 다시 구하면, 시연용으로 경로를 몇 초에 압축해 달릴 때
 * 남은 시간은 수십 분씩 줄고 시계는 몇 초만 가서 도착 예정이 계속 앞당겨져 보인다.)
 */
class FakeTrip(
    val route: FakeRoute,
    val driveMillis: Long,
    val departedAt: Instant,
    travelTime: Duration? = null,
    /** 에너지 제안을 수락해 넣은 경유지(충전소·주유소). 패널에 "경유 · {이름} → {목적지}"로만 보이고 경로 모양은 바꾸지 않는다. */
    val via: Place? = null,
) {
    init {
        require(driveMillis > 0) { "drive는 양수여야 합니다: ${driveMillis}ms" }
    }

    private val totalMillis = driveMillis.toDouble()

    /** 경로 전체의 소요 시간. 주입값이 없으면 경로 길이로 구한 값 */
    val totalDuration: Duration = travelTime ?: route.duration

    /** 도착 예정 시각 = 출발 시각 + 경로 전체 소요 시간. 달리는 중에도 [advance]·[seek]로 바뀌지 않는다. */
    val arrivalAt: Instant = departedAt + totalDuration

    /** 출발점에서 지금까지 간 거리(미터) */
    var traveledMeters = 0.0
        private set

    /** 도착을 이미 알렸는가. 길이 0인 경로처럼 움직이기 전에 도착한 경우에도 알림이 정확히 한 번 가게 한다. */
    private var arrivalReported = false

    /** 경로 끝에 닿았는가. 도착 판정은 여기서만 한다. */
    val arrived: Boolean get() = traveledMeters >= route.lengthMeters

    /** 남은 비율 0.0~1.0 */
    val remainingRatio: Double
        get() = if (route.lengthMeters <= 0.0) 0.0 else (1.0 - traveledMeters / route.lengthMeters).coerceIn(0.0, 1.0)

    val remainingMeters: Double get() = route.lengthMeters * remainingRatio

    /** 남은 시간 = 경로 소요 시간 × 남은 비율 */
    val remainingDuration: Duration get() = Duration.ofMillis((totalDuration.toMillis() * remainingRatio).toLong())

    val position: RoutePoint get() = route.pointAt(traveledMeters)

    /**
     * [deltaMillis]만큼 시간이 흘렀다고 알린다. [driving]이 아니거나 이미 도착했으면 움직이지 않는다.
     * 도착을 아직 알리지 않았고 도착한 상태면 true를 돌려준다([consumeArrival]).
     */
    fun advance(deltaMillis: Long, driving: Boolean): Boolean {
        if (driving && !arrived && deltaMillis > 0) {
            traveledMeters = (traveledMeters + route.lengthMeters * deltaMillis / totalMillis).coerceAtMost(route.lengthMeters)
        }
        return consumeArrival()
    }

    /** 진행률(0~1)로 바로 옮긴다(시연자가 중간 장면으로 건너뛸 때). 도착 전으로 돌아가면 다시 도착을 알릴 수 있다. */
    fun seek(ratio: Double): Boolean {
        traveledMeters = route.lengthMeters * ratio.coerceIn(0.0, 1.0)
        if (!arrived) arrivalReported = false
        return consumeArrival()
    }

    /** 도착했고 아직 알리지 않았으면 true를 한 번만 돌려준다. */
    fun consumeArrival(): Boolean {
        if (!arrived || arrivalReported) return false
        arrivalReported = true
        return true
    }
}
