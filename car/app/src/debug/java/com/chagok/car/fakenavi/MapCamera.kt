package com.chagok.car.fakenavi

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.hypot

/** 각도(도) 계산. 안드로이드에 의존하지 않는다. */
object Angles {
    /** [0, 360)으로 맞춘다. */
    fun normalize(deg: Float): Float {
        val r = deg % 360f
        return if (r < 0f) r + 360f else r
    }

    /** [from]에서 [to]로 가는 가장 짧은 회전량. (-180, 180]이고 양수는 시계 방향. 350°→10°는 +20이다. */
    fun shortestDelta(from: Float, to: Float): Float {
        var d = (to - from) % 360f
        if (d > 180f) d -= 360f
        if (d <= -180f) d += 360f
        return d
    }

    /** 두 각도 사이의 크기(0~180) */
    fun distance(a: Float, b: Float): Float = abs(shortestDelta(a, b))
}

/**
 * 목표 각도를 최단 방향으로 지수 감쇠로 따라가는 값. 시간 기반이라 틱 간격과 무관하다(같은 시간이 흐르면 틱을 몇 번으로 쪼개도 같은 결과).
 * 꺾이는 길에서 목표가 순간 90° 바뀌어도 지도가 [tauMillis]쯤의 시정수로 부드럽게 돈다. 안드로이드에 의존하지 않는다.
 */
class HeadingFollower(private val tauMillis: Float = TAU_MS) {
    /** 지금 각도 [0, 360) */
    var angle = 0f
        private set
    private var lastMs = Long.MIN_VALUE

    /** 바로 [target]으로 맞춘다(경로를 새로 시작하거나 진행률로 건너뛸 때). */
    fun snap(target: Float, nowMs: Long): Float {
        angle = Angles.normalize(target)
        lastMs = nowMs
        return angle
    }

    /** [nowMs] 시각까지 [target]으로 다가간다. 처음 부르면 바로 맞춘다. 남은 각이 [SETTLE_DEG] 아래면 정확히 맞춘다. */
    fun update(target: Float, nowMs: Long): Float {
        if (lastMs == Long.MIN_VALUE) return snap(target, nowMs)
        val goal = Angles.normalize(target)
        val dt = (nowMs - lastMs).coerceAtLeast(0L)
        lastMs = nowMs
        val delta = Angles.shortestDelta(angle, goal)
        angle = if (abs(delta) < SETTLE_DEG) goal else Angles.normalize(angle + delta * (1f - exp(-dt / tauMillis)))
        return angle
    }

    /** [target]에 이미 닿았는가 */
    fun isSettled(target: Float): Boolean = angle == Angles.normalize(target)

    companion object {
        /** 시정수. 꺾이는 곳에서 약 0.2초에 3분의 2, 0.6초쯤에 95%를 돈다. */
        const val TAU_MS = 200f

        /** 이보다 가까워지면 목표에 붙인다. */
        const val SETTLE_DEG = 0.05f
    }
}

/**
 * 차를 화면 중앙에 두고 진행 방향이 위가 되게 세계를 옮기고 돌리는 카메라. 화면 좌표는 y가 아래로 커진다.
 * 세계 좌표는 시안 좌표(1600×640)다. [scale]은 세계 1단위가 화면 몇 px인가.
 * 변환은 세계 → (차 위치를 원점으로) → 진행 방향의 반대로 회전([headingDeg]는 위가 0도, 시계 방향) → 확대 → 화면 중앙으로 옮김이다.
 * 안드로이드에 의존하지 않고, [FakeMapView]는 같은 순서로 Canvas 행렬(translate·rotate·scale·translate)을 쓴다.
 */
class MapCamera {
    var screenW = 0f
        private set
    var screenH = 0f
        private set
    var scale = 1f
        private set
    var centerX = 0f
        private set
    var centerY = 0f
        private set
    var headingDeg = 0f
        private set

    fun setScreen(w: Float, h: Float, scale: Float) {
        screenW = w; screenH = h; this.scale = scale
    }

    fun follow(worldX: Float, worldY: Float, headingDeg: Float) {
        centerX = worldX; centerY = worldY; this.headingDeg = headingDeg
    }

    /** 세계 좌표 ([wx], [wy])의 화면 좌표를 [out]의 0·1번에 쓴다(할당 없음). */
    fun toScreen(wx: Float, wy: Float, out: FloatArray) {
        val rad = Math.toRadians(headingDeg.toDouble())
        val c = Math.cos(rad).toFloat()
        val s = Math.sin(rad).toFloat()
        val dx = wx - centerX
        val dy = wy - centerY
        // 진행 방향이 위가 되도록 -heading만큼 시계 방향 회전
        out[0] = screenW / 2f + scale * (dx * c + dy * s)
        out[1] = screenH / 2f + scale * (-dx * s + dy * c)
    }

    /** 화면 모서리가 차에서 가장 멀리 떨어진 거리(세계 단위). 어떤 회전 각도에서도 화면은 이 반지름의 원 안이다. */
    fun visibleRadius(): Float = hypot(screenW, screenH) / 2f / scale

    companion object {
        /**
         * 지도 확대 배율(디자인 px 대비). 경로 길이는 변형 셋이 1290·1306·1596(시안 좌표)이다. 두 칸 창(1682×1210)은 시안 단위로 약 1600×1150이라
         * 확대가 1이면 경로가 화면 가로 한 장(0.8~1.0장)뿐이라 4.5초 주행에서 지도가 크게 움직이지 않고 차가 화면 밖으로 거의 나가지도 않는다.
         * 2배로 두면 화면이 800×575 세계 단위만 보여 경로가 가로로 1.6~2.0장(한 칸 세로 창은 보이는 세로 570이라 2.3~2.8장) 길이가 되어
         * 4.5초 동안 도로·교차점이 뚜렷하게 흐르고 커브에서 회전이 잘 읽힌다. 더 키우면(3배 이상) 교차점 사이가 너무 빨리 지나가 어지럽다고 판단했다(실제 화면 확인 필요).
         * 도로·경로·마커의 굵기는 확대와 상관없이 화면 기준 디자인 px 그대로다.
         */
        const val ZOOM = 2f

        /**
         * 화면 크기 [w]×[h](px)와 디자인 px 1단위의 실제 px [pxPerDesign]에서 쓸 배율. 기본은 [ZOOM] × [pxPerDesign]이고,
         * 화면 모서리가 [MapRoads.COVER_RADIUS]를 넘게 보이면(아주 큰 창) 빈 모서리가 안 보이도록 그만큼 확대한다.
         */
        fun scaleFor(w: Float, h: Float, pxPerDesign: Float): Float =
            maxOf(pxPerDesign * ZOOM, hypot(w, h) / 2f / MapRoads.COVER_RADIUS)
    }
}

/**
 * 목적지 마커 모양(디자인 px). 흰 물방울 핀이고 끝(뾰족한 곳)이 목적지 점, 몸통은 그 위(화면 위쪽)다. 안에 어두운 점이 있다.
 * 지도가 돌아도 마커는 화면 기준으로 똑바로 서 있다. 도착해 차(반지름 [CAR_OUTER_RADIUS])가 같은 점에 오면 차가 핀 끝을 덮지만 몸통은 차 위로 드러난다.
 */
object DestinationPin {
    /** 핀 끝에서 몸통 원 중심까지의 높이 */
    /** 처음 36·15·6이었는데 차 마커(바깥 20)보다 작고 도착 때 차와 1px만 떨어져 읽히지 않아 키우고 띄웠다(2026-11-12 화면 확인). */
    const val HEAD_CENTER = 64f
    const val HEAD_RADIUS = 24f

    /** 몸통 안쪽 어두운 점 반지름 */
    const val DOT_RADIUS = 9f

    /** 핀 둘레의 어두운 테두리 굵기(경로선·도로와 구분) */
    const val OUTLINE = 3f

    /** 차 마커 반지름 18 + 고리 굵기 4의 바깥 절반 */
    const val CAR_OUTER_RADIUS = 20f

    /** 몸통 원이 차 마커에 닿지 않고 위로 드러나는 여유(디자인 px). 양수면 겹쳐도 몸통이 읽힌다. */
    const val CLEARANCE = HEAD_CENTER - HEAD_RADIUS - CAR_OUTER_RADIUS
}
