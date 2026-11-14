package com.chagok.car.fakenavi

/**
 * 가짜 지도의 배경 도로망. 화면 시안(Drive) 1600×640 좌표의 3차 베지어 곡선 다섯 줄이고 고정 값이라 늘 같다.
 * 화면을 가로지르는 완만한 곡선 네 줄에 하나가 비스듬히 지나간다. 창 크기에 맞춰 늘려 그린다([FakeMapView]).
 * 안드로이드에 의존하지 않는다.
 *
 * [coords]는 시작점(x, y)에 이어 구간마다 조절점 둘과 끝점(c1x, c1y, c2x, c2y, x, y)이다.
 * [width]는 디자인 px, [major]는 큰 도로(#1E1E1E)·아니면 작은 도로(#1A1A1A), [round]는 둥근 끝이다.
 */
class MapRoad(val width: Float, val major: Boolean, val round: Boolean, val coords: FloatArray) {
    init {
        require(coords.size >= 8 && (coords.size - 2) % 6 == 0) { "도로 좌표는 시작점과 구간마다 6개여야 합니다: ${coords.size}" }
    }

    val segmentCount: Int get() = (coords.size - 2) / 6
}

object MapRoads {
    /** 시안 좌표계의 크기 */
    const val DESIGN_W = 1600f
    const val DESIGN_H = 640f

    val ALL: List<MapRoad> = listOf(
        MapRoad(22f, major = true, round = true, coords = floatArrayOf(-20f, 520f, 300f, 480f, 520f, 560f, 820f, 470f, 1120f, 380f, 1300f, 300f, 1640f, 330f)),
        MapRoad(16f, major = true, round = false, coords = floatArrayOf(300f, -20f, 340f, 160f, 420f, 300f, 380f, 660f)),
        MapRoad(14f, major = true, round = false, coords = floatArrayOf(1120f, -20f, 1080f, 140f, 1200f, 260f, 1170f, 660f)),
        MapRoad(12f, major = false, round = false, coords = floatArrayOf(-20f, 180f, 400f, 220f, 900f, 120f, 1640f, 170f)),
        MapRoad(10f, major = false, round = false, coords = floatArrayOf(640f, 660f, 700f, 520f, 900f, 420f, 1000f, 300f, 1100f, 180f, 1240f, 120f, 1400f, -20f)),
    )

    /**
     * 카메라가 차를 따라가므로 화면 바깥도 도로로 채운 지도 세계. 차를 중심으로 반지름 [COVER_RADIUS]인 원은
     * (경로가 시안 화면 [DESIGN_W]×[DESIGN_H] 안에 있는 한) 어떤 회전 각도에서도 도로망 안이라 빈 모서리가 보이지 않는다.
     * 화면의 가장 먼 모서리가 차에서 [COVER_RADIUS]를 넘으면 [MapCamera.scaleFor]가 배율을 키워 막는다.
     */
    const val COVER_RADIUS = 700f

    /** 경로가 시안 화면 밖으로 살짝 넘어갈 수 있는 여유(선분 한두 개 길이) */
    const val ROUTE_SLACK = 100f

    /** 생성하는 도로가 채우는 바깥 범위: 시안 화면 둘레로 [COVER_RADIUS] + [ROUTE_SLACK] */
    const val EXTENT = COVER_RADIUS + ROUTE_SLACK
    const val WORLD_MIN_X = -EXTENT
    const val WORLD_MAX_X = DESIGN_W + EXTENT
    const val WORLD_MIN_Y = -EXTENT
    const val WORLD_MAX_Y = DESIGN_H + EXTENT

    /** 기존 도로 양 끝을 곧게 이어 바깥으로 뻗는 길이 */
    private const val EXTEND_LENGTH = 900f

    /**
     * 기존 다섯 줄의 양 끝을 끝 방향 그대로 곧게 연장한 도로(같은 굵기). 시안 화면 밖에서도 같은 길이 이어진다.
     */
    val EXTENSIONS: List<MapRoad> = ALL.flatMap { road ->
        val c = road.coords
        val n = c.size
        val head = extension(c[0], c[1], c[0] - c[2], c[1] - c[3], reverse = true, road = road)
        val tail = extension(c[n - 2], c[n - 1], c[n - 2] - c[n - 4], c[n - 1] - c[n - 3], reverse = false, road = road)
        listOf(head, tail)
    }

    /**
     * 시안 화면 바깥(위·아래·좌·우)을 채우는 작은 도로. 가로길 여섯 줄(y -700, -400, -100, 740, 1040, 1340)과 세로길 여섯 줄(x -700, -400, -100, 1700, 2000, 2300)이
     * 범위 끝에서 끝까지 이어지고, 완만하게 휘도록 번호마다 정해진 값으로 흔든다(고정 값이라 늘 같다).
     */
    val OUTER: List<MapRoad> = buildList {
        val ys = floatArrayOf(-700f, -400f, -100f, 740f, 1040f, 1340f)
        val xs = floatArrayOf(-700f, -400f, -100f, 1700f, 2000f, 2300f)
        ys.forEachIndexed { i, y -> add(wavy(horizontal = true, base = y, index = i, width = if (i % 3 == 0) 12f else 10f)) }
        xs.forEachIndexed { i, x -> add(wavy(horizontal = false, base = x, index = i + ys.size, width = if (i % 3 == 0) 12f else 10f)) }
    }

    /** 화면에 그리는 도로 전부: 시안 도로, 그 연장, 바깥 도로 순. 앞쪽이 아래에 깔린다. */
    val WORLD: List<MapRoad> = ALL + EXTENSIONS + OUTER

    private fun extension(px: Float, py: Float, dx: Float, dy: Float, reverse: Boolean, road: MapRoad): MapRoad {
        val len = kotlin.math.hypot(dx, dy)
        val ux = dx / len * EXTEND_LENGTH
        val uy = dy / len * EXTEND_LENGTH
        // 곧은 3차 곡선: 끝점 연장은 p에서 바깥으로, 시작점 연장은 바깥에서 p로(그리는 방향만 다르다)
        return if (reverse) {
            MapRoad(road.width, road.major, false, floatArrayOf(px + ux, py + uy, px + ux * 2 / 3, py + uy * 2 / 3, px + ux / 3, py + uy / 3, px, py))
        } else {
            MapRoad(road.width, road.major, false, floatArrayOf(px, py, px + ux / 3, py + uy / 3, px + ux * 2 / 3, py + uy * 2 / 3, px + ux, py + uy))
        }
    }

    /** 범위 끝에서 끝까지 이어지는 완만한 S자 도로. 가로길이면 y(세로길이면 x)가 [base] 둘레로 흔들린다. */
    private fun wavy(horizontal: Boolean, base: Float, index: Int, width: Float): MapRoad {
        val from = (if (horizontal) WORLD_MIN_X else WORLD_MIN_Y) - 100f
        val to = (if (horizontal) WORLD_MAX_X else WORLD_MAX_Y) + 100f
        val steps = 3
        val coords = ArrayList<Float>()
        fun along(k: Int) = from + (to - from) * k / steps
        fun across(k: Int) = base + 60f * kotlin.math.sin(index * 1.7f + k * 1.3f)
        fun put(a: Float, b: Float) {
            if (horizontal) { coords.add(a); coords.add(b) } else { coords.add(b); coords.add(a) }
        }
        put(along(0), across(0))
        for (k in 1..steps) {
            val third = (along(k) - along(k - 1)) / 3f
            put(along(k - 1) + third, across(k - 1))
            put(along(k) - third, across(k))
            put(along(k), across(k))
        }
        return MapRoad(width, major = false, round = false, coords = coords.toFloatArray())
    }
}

/**
 * 지도 도로 위를 지나가는 경로. 시안(Drive)처럼 경로선이 도로 곡선 위에 얹힌다.
 * 도로를 짧은 선분들로 편 점열에서, 한 도로를 따라가다가 다음 도로와 만나는 곳(교차점)에서 갈아타고
 * 마지막 도로는 화면 밖으로 나가기 직전까지 간다. 시안 좌표(1600×640)의 점열을 돌려주고 창 크기에 맞춰 늘리는 것은 [FakeMapView]가 한다.
 * 같은 [variant]면 늘 같은 점열이다(결정적). 안드로이드에 의존하지 않는다.
 */
object RoadRoutes {
    /** 도로 구간(3차 베지어) 하나를 몇 개의 선분으로 펴는가 */
    const val SAMPLES = 48

    /** 도로 [road]를 [dir](+1은 도로를 그린 방향, -1은 반대)으로 따라간다. */
    class Leg(val road: Int, val dir: Int)

    /** 첫 도로에서 시작하는 위치는 도로 점열의 [startFraction](0~1) 지점이다. 첫 다리의 도로가 시작 도로다. */
    class Variant(val startFraction: Float, val legs: List<Leg>)

    /** 지도 도로 번호: 0 아래쪽 큰 가로길, 1·2 큰 세로길, 3 위쪽 가로길, 4 비스듬한 길([MapRoads.ALL] 순서) */
    val VARIANTS: List<Variant> = listOf(
        // 아래쪽 가로길을 오른쪽으로 → 비스듬한 길로 갈아타 오른쪽 위 모서리로
        Variant(0.15f, listOf(Leg(0, +1), Leg(4, +1))),
        // 왼쪽 세로길을 아래로 → 아래쪽 가로길을 오른쪽으로 → 오른쪽 세로길을 위로
        Variant(0.7f, listOf(Leg(1, +1), Leg(0, +1), Leg(2, -1))),
        // 비스듬한 길을 오른쪽 위로 → 위쪽 가로길을 왼쪽으로
        Variant(0.3f, listOf(Leg(4, +1), Leg(3, -1))),
    )

    private val dense: List<FloatArray> by lazy { MapRoads.ALL.map(::sample) }

    /** 도로 하나의 점열(x, y 번갈아). 시안 좌표 */
    fun sample(road: MapRoad): FloatArray {
        val c = road.coords
        val out = FloatArray(2 * (1 + SAMPLES * road.segmentCount))
        out[0] = c[0]; out[1] = c[1]
        var n = 2
        for (s in 0 until road.segmentCount) {
            // 구간 시작점: 첫 구간은 시작점, 이후는 앞 구간의 끝점
            val sx = if (s == 0) c[0] else c[2 + 6 * (s - 1) + 4]
            val sy = if (s == 0) c[1] else c[2 + 6 * (s - 1) + 5]
            val b = 2 + 6 * s
            for (k in 1..SAMPLES) {
                val t = k.toFloat() / SAMPLES
                val m = 1f - t
                out[n++] = m * m * m * sx + 3 * m * m * t * c[b] + 3 * m * t * t * c[b + 2] + t * t * t * c[b + 4]
                out[n++] = m * m * m * sy + 3 * m * m * t * c[b + 1] + 3 * m * t * t * c[b + 3] + t * t * t * c[b + 5]
            }
        }
        return out
    }

    /** [variant]번(범위를 넘으면 나머지)의 경로 점열. 시안 좌표. 점이 둘 이상이다. */
    fun build(variant: Int): FloatArray {
        val v = VARIANTS[Math.floorMod(variant, VARIANTS.size)]
        val out = ArrayList<Float>()
        val first = dense[v.legs[0].road]
        // 현재 위치: 도로 점열의 선분 [seg](seg → seg+1) 위의 점 (cx, cy)
        var seg = (v.startFraction * (first.size / 2 - 1)).toInt().coerceIn(0, first.size / 2 - 2)
        var cx = first[2 * seg]
        var cy = first[2 * seg + 1]
        out.add(cx); out.add(cy)
        for ((li, leg) in v.legs.withIndex()) {
            val pts = dense[leg.road]
            val n = pts.size / 2
            val next = v.legs.getOrNull(li + 1)?.let { dense[it.road] }
            var i = seg
            var switched = false
            while (true) {
                val endIdx = if (leg.dir > 0) i + 1 else i
                val ex = pts[2 * endIdx]
                val ey = pts[2 * endIdx + 1]
                if (next != null) {
                    val hit = firstHit(cx, cy, ex, ey, next)
                    if (hit != null) {
                        cx = hit[0]; cy = hit[1]; seg = hit[2].toInt()
                        out.add(cx); out.add(cy)
                        switched = true
                        break
                    }
                } else if (ex < 0f || ex > MapRoads.DESIGN_W || ey < 0f || ey > MapRoads.DESIGN_H) {
                    return out.toFloatArray()
                }
                out.add(ex); out.add(ey)
                cx = ex; cy = ey
                i += leg.dir
                if (i < 0 || i >= n - 1) break
            }
            if (!switched && next != null) return out.toFloatArray() // 갈아탈 곳을 못 찾음: 여기까지
        }
        return out.toFloatArray()
    }

    /** 선분 (ax,ay)→(bx,by)가 점열 [pts]와 처음 만나는 곳: [x, y, 만난 선분 번호]. 없으면 null. */
    private fun firstHit(ax: Float, ay: Float, bx: Float, by: Float, pts: FloatArray): FloatArray? {
        val rx = bx - ax
        val ry = by - ay
        var bestT = Float.MAX_VALUE
        var best: FloatArray? = null
        for (j in 0 until pts.size / 2 - 1) {
            val cx = pts[2 * j]; val cy = pts[2 * j + 1]
            val sx = pts[2 * j + 2] - cx
            val sy = pts[2 * j + 3] - cy
            val den = rx * sy - ry * sx
            if (den > -1e-9f && den < 1e-9f) continue
            val qx = cx - ax
            val qy = cy - ay
            val t = (qx * sy - qy * sx) / den
            val u = (qx * ry - qy * rx) / den
            if (t > 1e-4f && t <= 1f && u >= 0f && u <= 1f && t < bestT) {
                bestT = t
                best = floatArrayOf(ax + rx * t, ay + ry * t, j.toFloat())
            }
        }
        return best
    }
}
