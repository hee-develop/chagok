package com.chagok.car.fakenavi

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.os.SystemClock
import android.view.View
import com.chagok.car.R
import com.chagok.car.ui.DesignScale
import kotlin.math.hypot
import kotlin.math.sqrt

/**
 * Canvas로 직접 그린 단순 지도(타일·지도 라이브러리 없음). 화면 시안(Drive)대로 어두운 바탕에 곡선 도로([MapRoads]),
 * 그 도로 위를 지나는 흰 경로선, 원형 차 마커(안에 진행 방향 화살촉), 목적지 마커를 그린다. 흑백 토큰만 쓰고 주황(care)은 쓰지 않는다.
 *
 * 카메라: **차는 늘 이 View의 정중앙에 고정**이고 차가 움직이는 대신 지도가 움직인다. 지도는 **진행 방향이 위**(heading-up)라 화살촉은 늘 위를 향하고
 * 커브에서는 지도가 돈다. 각도는 목표(그 자리 선분 방향)를 [HeadingFollower]가 최단 방향으로 지수 감쇠로 따라가서, 도로를 갈아타는 교차점에서도 튀지 않는다.
 * 세계 좌표는 시안 좌표(1600×640)이고 [MapCamera]가 확대([MapCamera.ZOOM])·이동·회전을 맡는다. 도로는 시안 화면 밖으로도 이어져서
 * ([MapRoads.WORLD]) 어떤 회전 각도에서도 빈 모서리가 보이지 않는다. 가로세로를 따로 늘리지 않고 같은 배율로만 키운다.
 * 도로·경로선의 굵기와 마커 크기는 확대와 상관없이 화면 기준 시안 px 그대로다.
 *
 * 경로선은 도로 곡선의 일부다: [RoadRoutes]가 한 도로를 따라가다 교차점에서 다른 도로로 갈아타는 점열을 만들고(목적지 좌표로 고른 변형이라 같은 목적지면 같다),
 * 차는 그 위를 간다. 진행 비율은 [FakeTrip]의 진행(위경도 거리 기준 [FakeRoute]) 비율을 따른다. 지나온 구간은 그리지 않고 남은 구간만 흰색이다.
 * 경로 끝(목적지)에는 [DestinationPin] 마커가 서 있고 지도가 돌아도 화면 기준으로 똑바르다. 차 마커를 나중에 그려 도착해 겹치면 차가 핀 끝을 덮고 몸통은 위로 보인다.
 * 경로가 없으면(가짜 내비를 켰지만 길안내 전) 시안 화면 한가운데([IDLE_X], [IDLE_Y])를 중심으로 위가 북쪽인 지도에 차만 보이고, 경로가 시작되면
 * 출발점으로 옮겨 첫 구간 방향이 위가 된다(정차 중이어도 첫 구간 방향).
 *
 * 다시 그리기는 차의 세계 위치가 화면 기준 1px 이상 또는 지도 각도가 0.5° 이상 바뀔 때만 한다(정차 중에는 멈춰야 Maestro가 화면 안정화를 기다리지 않는다).
 * 각도가 목표에 닿기 전이면 [syncCar] 호출이 없어도 [postOnAnimation]으로 몇 프레임 더 따라가다 닿으면 멈춘다.
 * 진행률로 건너뛰는 경우(한 번에 [JUMP_WORLD] 넘게 이동)와 경로가 바뀐 경우는 각도도 바로 맞춘다.
 * [onDraw]는 그리기만 하고 계산·할당을 하지 않는다(위치를 구하는 [syncCar]의 Pose 객체 하나는 호출마다 생긴다).
 */
class FakeMapView(context: Context, private val d: DesignScale) : View(context) {
    var trip: FakeTrip? = null
        set(value) {
            if (field === value) return
            field = value
            rebuild()
            invalidate()
        }

    private val camera = MapCamera()
    private val follower = HeadingFollower()

    private val roads = MapRoads.WORLD
    private val roadPaints = roads.map { stroke(if (it.major) R.color.map_road_major else R.color.map_road_minor, it.round) }
    private val routeLine = stroke(R.color.accent, round = true)
    private val carFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = d.color(R.color.bg_base) }
    private val carRing = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = d.color(R.color.accent)
        style = Paint.Style.STROKE
        strokeWidth = d.px(4f)
    }
    private val arrowFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = d.color(R.color.accent) }
    private val pinFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = d.color(R.color.accent) }
    private val pinDot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = d.color(R.color.bg_base) }
    private val pinOutline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = d.color(R.color.bg_base)
        style = Paint.Style.STROKE
        strokeWidth = d.px(2 * DestinationPin.OUTLINE)
        strokeJoin = Paint.Join.ROUND
    }
    private val bgColor = d.color(R.color.bg_base)

    // 도로 Path는 세계 좌표라 크기와 무관하게 한 번만 만든다.
    private val roadPaths = roads.map { road ->
        Path().apply {
            val c = road.coords
            moveTo(c[0], c[1])
            for (s in 0 until road.segmentCount) {
                val o = 2 + 6 * s
                cubicTo(c[o], c[o + 1], c[o + 2], c[o + 3], c[o + 4], c[o + 5])
            }
        }
    }
    private val aheadPath = Path()
    private var route: RoadPath? = null
    private var aheadBuffer = FloatArray(0)

    /** 차 마커 안의 진행 방향 화살촉(시안 `M820 459 l8 18 -8 -5 -8 5 z`를 중심 기준으로). 위쪽이 진행 방향이다. */
    private val arrow = Path().apply {
        val u = d.px(1f)
        moveTo(0f, -11f * u)
        lineTo(8f * u, 7f * u)
        lineTo(0f, 2f * u)
        lineTo(-8f * u, 7f * u)
        close()
    }
    private val carRadius = d.px(18f)

    /** 목적지 핀: 끝(0,0)에서 위로 몸통 원과 그 원에 접하는 삼각형. 화면 좌표 기준이다(지도가 돌아도 똑바로 선다). */
    private val pin = Path().apply {
        val u = d.px(1f)
        val cy = DestinationPin.HEAD_CENTER * u
        val r = DestinationPin.HEAD_RADIUS * u
        addCircle(0f, -cy, r, Path.Direction.CW)
        // 끝에서 몸통 원에 그은 접선의 접점: 끝에서 sqrt(cy²-r²) 거리, 축과 이루는 각 asin(r/cy)
        val tangent = sqrt(cy * cy - r * r)
        val sinA = r / cy
        val cosA = sqrt(1f - sinA * sinA)
        moveTo(0f, 0f)
        lineTo(tangent * sinA, -tangent * cosA)
        lineTo(-tangent * sinA, -tangent * cosA)
        close()
    }
    private val pinDotCenterY = -DestinationPin.HEAD_CENTER * d.px(1f)
    private val pinDotRadius = d.px(DestinationPin.DOT_RADIUS)

    // 지금 카메라가 보는 차의 세계 위치(경로가 없으면 대기 위치)와 마지막으로 그린 값. hasPose·hasDrawn이 false면 아직 없다.
    private var hasPose = false
    private var poseX = 0f
    private var poseY = 0f
    private var hasDrawn = false
    private var drawnX = 0f
    private var drawnY = 0f
    private var drawnAngle = 0f
    private var destWorldX = Float.NaN
    private var destWorldY = Float.NaN
    private val destScreen = FloatArray(2)
    private var destVisible = false
    private var settleScheduled = false
    private val settle = Runnable {
        settleScheduled = false
        syncCar()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        rebuild()
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(settle)
        settleScheduled = false
        super.onDetachedFromWindow()
    }

    private fun stroke(color: Int, round: Boolean = false) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = d.color(color)
        style = Paint.Style.STROKE
        strokeCap = if (round) Paint.Cap.ROUND else Paint.Cap.BUTT
        strokeJoin = Paint.Join.ROUND
    }

    /** 배율에 맞춰 도로·경로선 굵기를 화면 기준 시안 px로 되돌린다(캔버스 배율이 곱해지므로 나눈다). */
    private fun applyStrokeWidths() {
        val s = camera.scale
        roads.forEachIndexed { i, road -> roadPaints[i].strokeWidth = d.px(road.width) / s }
        routeLine.strokeWidth = d.px(ROUTE_WIDTH) / s
    }

    /** 크기·경로가 바뀔 때: 카메라와 경로를 다시 만들고 각도도 바로 맞춘다. 크기가 0이면 크기가 정해질 때까지 미룬다. */
    private fun rebuild() {
        hasPose = false
        hasDrawn = false
        destWorldX = Float.NaN
        destWorldY = Float.NaN
        if (width == 0 || height == 0) return
        camera.setScreen(width.toFloat(), height.toFloat(), MapCamera.scaleFor(width.toFloat(), height.toFloat(), d.px(1f)))
        applyStrokeWidths()
        val t = trip
        if (t == null) {
            route = null
            aheadPath.reset()
        } else {
            val built = RoadPath(RoadRoutes.build(variantOf(t)))
            route = built
            aheadBuffer = FloatArray(built.aheadCapacity)
            val end = built.poseAt(1f)
            destWorldX = end.x
            destWorldY = end.y
        }
        update()
    }

    /** 목적지 좌표로 정한 경로 변형 번호. 같은 목적지면 같다. */
    private fun variantOf(t: FakeTrip): Int {
        val p = t.route.destination.position
        return Math.floorMod(Math.round(p.lat * 100_000) * 31 + Math.round(p.lng * 100_000), RoadRoutes.VARIANTS.size.toLong()).toInt()
    }

    /** 진행 비율(0~1). 길이 0인 경로는 도착이라 1이다. */
    private fun progressOf(t: FakeTrip): Float {
        val len = t.route.lengthMeters
        return if (len <= 0.0) 1f else (t.traveledMeters / len).toFloat().coerceIn(0f, 1f)
    }

    /**
     * 차의 지금 위치와 지도 각도를 갱신하고, 1px(도착 때는 정확히) 또는 0.5° 이상 바뀌었을 때만 다시 그리게 한다.
     * 돌려주는 값은 다시 그리기를 요청했는가.
     */
    fun syncCar(): Boolean {
        val moved = update()
        if (moved) invalidate()
        return moved
    }

    /** 계산만 하고 invalidate는 하지 않는다. 그려야 하면 true. */
    private fun update(): Boolean {
        if (width == 0 || height == 0) return false
        val now = SystemClock.uptimeMillis()
        val t = trip
        val path = route
        val x: Float
        val y: Float
        val target: Float
        if (t == null || path == null) {
            x = IDLE_X; y = IDLE_Y; target = 0f
        } else {
            val pose = path.poseAt(progressOf(t))
            x = pose.x; y = pose.y; target = pose.angleDeg
        }
        // 경로가 바뀌었거나(hasPose false) 진행률로 건너뛴 경우는 각도도 바로 맞춘다. 정상 주행은 틱마다 몇십 단위만 움직인다.
        val jumped = !hasPose || hypot(x - poseX, y - poseY) > JUMP_WORLD
        poseX = x; poseY = y; hasPose = true
        val angle = if (jumped) follower.snap(target, now) else follower.update(target, now)
        val settled = follower.isSettled(target)
        if (!settled) scheduleSettle()

        val arrived = t != null && t.arrived
        val positionMoved = !hasDrawn || hypot(x - drawnX, y - drawnY) * camera.scale >= (if (arrived) 0.01f else 1f)
        // 각도가 0.5° 안쪽으로 남아도 목표에 닿으면 한 번 더 그려 정확히 맞춘다.
        val angleMoved = !hasDrawn || Angles.distance(angle, drawnAngle) >= MIN_REDRAW_DEG || (settled && angle != drawnAngle)
        if (!positionMoved && !angleMoved) return false

        hasDrawn = true
        drawnX = x; drawnY = y; drawnAngle = angle
        camera.follow(x, y, angle)
        refreshAhead(t, path)
        destVisible = !destWorldX.isNaN()
        if (destVisible) camera.toScreen(destWorldX, destWorldY, destScreen)
        return true
    }

    /** 남은 경로(현재 위치부터 끝까지)를 재사용 Path에 다시 채운다. */
    private fun refreshAhead(t: FakeTrip?, path: RoadPath?) {
        aheadPath.reset()
        if (t == null || path == null) return
        val n = path.ahead(progressOf(t), aheadBuffer)
        if (n < 4) return
        aheadPath.moveTo(aheadBuffer[0], aheadBuffer[1])
        var i = 2
        while (i < n) {
            aheadPath.lineTo(aheadBuffer[i], aheadBuffer[i + 1])
            i += 2
        }
    }

    private fun scheduleSettle() {
        if (settleScheduled) return
        settleScheduled = true
        postOnAnimation(settle)
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawColor(bgColor)
        val cx = width / 2f
        val cy = height / 2f
        // 세계: 차 위치를 원점으로 옮기고, 진행 방향이 위가 되게 돌리고, 확대해서 화면 중앙에 둔다.
        canvas.save()
        canvas.translate(cx, cy)
        canvas.rotate(-camera.headingDeg)
        canvas.scale(camera.scale, camera.scale)
        canvas.translate(-camera.centerX, -camera.centerY)
        for (i in roadPaths.indices) canvas.drawPath(roadPaths[i], roadPaints[i])
        canvas.drawPath(aheadPath, routeLine)
        canvas.restore()
        // 목적지 핀은 화면 기준으로 똑바로 서 있다(끝이 목적지 점). 차보다 먼저 그려 도착해 겹치면 차가 위에 온다.
        if (destVisible) {
            canvas.save()
            canvas.translate(destScreen[0], destScreen[1])
            canvas.drawPath(pin, pinOutline)
            canvas.drawPath(pin, pinFill)
            canvas.drawCircle(0f, pinDotCenterY, pinDotRadius, pinDot)
            canvas.restore()
        }
        // 차는 늘 중앙, 화살촉은 늘 위
        canvas.save()
        canvas.translate(cx, cy)
        canvas.drawCircle(0f, 0f, carRadius, carFill)
        canvas.drawCircle(0f, 0f, carRadius, carRing)
        canvas.drawPath(arrow, arrowFill)
        canvas.restore()
    }

    companion object {
        /** 경로가 없을 때 차를 두는 세계 위치: 시안 화면 한가운데 */
        const val IDLE_X = MapRoads.DESIGN_W / 2f
        const val IDLE_Y = MapRoads.DESIGN_H / 2f

        /** 한 번의 갱신에서 이보다 많이 움직이면 건너뛴 것으로 보고 각도를 바로 맞춘다(세계 단위) */
        const val JUMP_WORLD = 150f

        /** 이 각도 이상 바뀔 때만 다시 그린다 */
        const val MIN_REDRAW_DEG = 0.5f

        /** 경로선 굵기(디자인 px, 화면 기준) */
        const val ROUTE_WIDTH = 8f
    }
}
