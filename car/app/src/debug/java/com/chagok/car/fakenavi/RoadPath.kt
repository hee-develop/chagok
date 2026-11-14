package com.chagok.car.fakenavi

import kotlin.math.atan2
import kotlin.math.hypot

/** 경로 위 한 점: 화면 좌표와 진행 방향([angleDeg], 위쪽이 0도, 시계 방향으로 커진다). */
data class Pose(val x: Float, val y: Float, val angleDeg: Float)

/**
 * 화면 좌표의 점열(x, y 번갈아)을 따라가는 경로. 안드로이드에 의존하지 않는다.
 * 위치는 전체 길이에 대한 진행 비율(0~1)로 정하고, 방향은 그 자리 선분의 방향이다.
 * 길이 0인 선분(겹친 점)은 방향을 직전 선분에서 이어받고, 맨 앞이 그런 선분이면 처음으로 방향이 있는 선분의 것을 쓴다.
 */
class RoadPath(private val xy: FloatArray) {
    val pointCount: Int = xy.size / 2
    val segmentCount: Int = if (pointCount > 1) pointCount - 1 else 0

    /** 점까지의 누적 길이 */
    private val cumulative = FloatArray(pointCount)

    /** 선분마다의 방향(도). 길이 0인 선분은 이웃에서 이어받는다. */
    private val angles = FloatArray(segmentCount)

    val length: Float

    init {
        require(xy.size % 2 == 0) { "좌표는 x, y 쌍이어야 합니다: ${xy.size}" }
        val known = BooleanArray(segmentCount)
        for (i in 0 until segmentCount) {
            val dx = xy[2 * i + 2] - xy[2 * i]
            val dy = xy[2 * i + 3] - xy[2 * i + 1]
            cumulative[i + 1] = cumulative[i] + hypot(dx, dy)
            if (dx != 0f || dy != 0f) {
                angles[i] = ((Math.toDegrees(atan2(dx.toDouble(), -dy.toDouble())).toFloat()) + 360f) % 360f
                known[i] = true
            }
        }
        for (i in 1 until segmentCount) if (!known[i] && known[i - 1]) { angles[i] = angles[i - 1]; known[i] = true }
        for (i in segmentCount - 2 downTo 0) if (!known[i] && known[i + 1]) { angles[i] = angles[i + 1]; known[i] = true }
        length = if (pointCount == 0) 0f else cumulative[pointCount - 1]
    }

    /** 진행 비율 [fraction](범위를 넘으면 양 끝으로 맞춤)의 위치와 방향 */
    fun poseAt(fraction: Float): Pose {
        if (segmentCount == 0) return if (pointCount == 0) Pose(0f, 0f, 0f) else Pose(xy[0], xy[1], 0f)
        val seg = segmentAt(fraction)
        val d = fraction.coerceIn(0f, 1f) * length
        val len = cumulative[seg + 1] - cumulative[seg]
        val t = if (len <= 0f) 1f else ((d - cumulative[seg]) / len).coerceIn(0f, 1f)
        val x = xy[2 * seg] + (xy[2 * seg + 2] - xy[2 * seg]) * t
        val y = xy[2 * seg + 1] + (xy[2 * seg + 3] - xy[2 * seg + 1]) * t
        return Pose(x, y, angles[seg])
    }

    /**
     * 현재 위치부터 끝까지의 점열을 [buffer]에 쓰고 쓴 float 수를 돌려준다(첫 점이 현재 위치). 객체를 새로 만들지 않는다.
     * [buffer]는 `2 * (pointCount + 1)` 이상이어야 한다([aheadCapacity]).
     */
    fun ahead(fraction: Float, buffer: FloatArray): Int {
        if (segmentCount == 0) {
            if (pointCount == 0) return 0
            buffer[0] = xy[0]; buffer[1] = xy[1]
            return 2
        }
        val seg = segmentAt(fraction)
        val here = poseAt(fraction)
        var n = 0
        buffer[n++] = here.x; buffer[n++] = here.y
        for (i in seg + 1 until pointCount) {
            buffer[n++] = xy[2 * i]; buffer[n++] = xy[2 * i + 1]
        }
        return n
    }

    val aheadCapacity: Int get() = 2 * (pointCount + 1)

    private fun segmentAt(fraction: Float): Int {
        val d = fraction.coerceIn(0f, 1f) * length
        var i = 0
        while (i < segmentCount - 1 && cumulative[i + 1] < d) i++
        return i
    }
}
