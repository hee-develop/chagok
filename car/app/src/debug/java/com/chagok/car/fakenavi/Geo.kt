package com.chagok.car.fakenavi

import com.chagok.car.domain.LatLng
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** 지도 위 평면 좌표(미터). x는 동쪽, y는 북쪽. */
data class LocalPoint(val x: Double, val y: Double)

/** 가짜 내비가 쓰는 지리 계산. 안드로이드에 의존하지 않는다. */
object Geo {
    private const val EARTH_RADIUS_M = 6_371_008.8
    private const val M_PER_DEG_LAT = 110_574.0
    private const val M_PER_DEG_LNG_EQUATOR = 111_320.0

    /** 두 위경도 사이 실제 거리(미터). haversine. */
    fun haversineMeters(a: LatLng, b: LatLng): Double {
        val p1 = Math.toRadians(a.lat)
        val p2 = Math.toRadians(b.lat)
        val dp = p2 - p1
        val dl = Math.toRadians(b.lng - a.lng)
        val h = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * EARTH_RADIUS_M * atan2(sqrt(h), sqrt(1 - h))
    }

    /** [anchor]를 원점으로 하는 평면 좌표. 수 km 안에서는 오차가 무시할 만하다. */
    fun toLocal(p: LatLng, anchor: LatLng): LocalPoint = LocalPoint(
        (p.lng - anchor.lng) * M_PER_DEG_LNG_EQUATOR * cos(Math.toRadians(anchor.lat)),
        (p.lat - anchor.lat) * M_PER_DEG_LAT,
    )

    /** [toLocal]의 역변환 */
    fun fromLocal(p: LocalPoint, anchor: LatLng): LatLng = LatLng(
        anchor.lat + p.y / M_PER_DEG_LAT,
        anchor.lng + p.x / (M_PER_DEG_LNG_EQUATOR * cos(Math.toRadians(anchor.lat))),
    )

    /** a에서 b로 가는 방위(도). 북쪽이 0, 시계 방향으로 커진다. */
    fun bearingDeg(a: LatLng, b: LatLng): Double {
        val l = toLocal(b, a)
        return (Math.toDegrees(atan2(l.x, l.y)) + 360.0) % 360.0
    }

    /** 방위 차이를 (-180, 180]로 맞춘다. 양수는 시계 방향(우회전) */
    fun turnAngle(from: Double, to: Double): Double {
        var d = (to - from) % 360.0
        if (d > 180.0) d -= 360.0
        if (d <= -180.0) d += 360.0
        return d
    }
}
