package com.chagok.car.fakenavi

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import java.time.Duration
import java.util.Random

/** 경로 위 한 점의 위치와 진행 방향(방위, 도) */
data class RoutePoint(val position: LatLng, val bearing: Double)

/**
 * 시연용 가짜 경로: 고정 출발점에서 목적지까지, 두 좌표에서 결정적으로 만든 도로형 꺾은선(가로·세로로 번갈아 가는 계단 모양).
 * 같은 입력이면 같은 결과다. 꺾이는 곳은 보통 3~5번이다(목적지가 출발점과 같은 위도·경도에 있으면 길이가 0인 구간이 빠져 더 적다).
 * 길이는 구간마다 위경도 기준 실제 거리(haversine)를 더한 값이고, 소요 시간은 길이를 [SPEED_KMH]로 나눈 값이다.
 */
class FakeRoute private constructor(val destination: Place, val points: List<LatLng>) {
    /** 각 꼭짓점까지의 누적 거리(미터) */
    private val cumulative: DoubleArray = DoubleArray(points.size).also {
        for (i in 1 until points.size) it[i] = it[i - 1] + Geo.haversineMeters(points[i - 1], points[i])
    }
    private val bearings: List<Double> = (1 until points.size).map { Geo.bearingDeg(points[it - 1], points[it]) }

    val lengthMeters: Double get() = cumulative.last()

    /** 가짜 경로의 소요 시간. 길이 / [SPEED_KMH] */
    val duration: Duration get() = Duration.ofMillis((lengthMeters / (SPEED_KMH * 1000.0 / 3600.0) * 1000.0).toLong())

    /** i번째 꼭짓점까지의 누적 거리(미터) */
    fun distanceAt(index: Int): Double = cumulative[index]

    /** 출발점 뒤 꺾이는 꼭짓점 수(출발점·목적지 제외) */
    val bendCount: Int get() = (points.size - 2).coerceAtLeast(0)

    /** 출발점에서 [distanceMeters]만큼 간 곳의 위치와 방향. 범위를 넘으면 양 끝으로 맞춘다. */
    fun pointAt(distanceMeters: Double): RoutePoint {
        if (bearings.isEmpty()) return RoutePoint(points.first(), 0.0)
        val d = distanceMeters.coerceIn(0.0, lengthMeters)
        var i = 1
        while (i < points.size - 1 && cumulative[i] < d) i++
        val seg = cumulative[i] - cumulative[i - 1]
        val t = if (seg <= 0.0) 1.0 else (d - cumulative[i - 1]) / seg
        val a = points[i - 1]
        val b = points[i]
        return RoutePoint(LatLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t), bearings[i - 1])
    }

    companion object {
        /** 시연용 평균 시속(km/h). 도심 주행 정도로 잡았다. 정책 기준값이 아니라 Rules에 두지 않는다. */
        const val SPEED_KMH = 30.0

        /** 가짜 출발점: 광주 시내 임의 좌표 */
        val ORIGIN = Place("현재 위치", LatLng(35.1500, 126.9100))

        fun to(destination: Place, origin: Place = ORIGIN): FakeRoute {
            val a = origin.position
            val b = destination.position
            val rnd = Random(seedOf(a, b))
            val bends = 3 + rnd.nextInt(3)
            val segments = bends + 1
            val startHorizontal = rnd.nextBoolean()
            val horizontal = List(segments) { (it % 2 == 0) == startHorizontal }
            val weights = List(segments) { 0.5 + rnd.nextDouble() }
            val hSum = weights.filterIndexed { i, _ -> horizontal[i] }.sum()
            val vSum = weights.filterIndexed { i, _ -> !horizontal[i] }.sum()
            val end = Geo.toLocal(b, a)

            val pts = mutableListOf(a)
            var x = 0.0
            var y = 0.0
            for (i in 0 until segments) {
                if (horizontal[i]) x += end.x * weights[i] / hSum else y += end.y * weights[i] / vSum
                val next = if (i == segments - 1) b else Geo.fromLocal(LocalPoint(x, y), a)
                if (next != pts.last()) pts += next
            }
            if (pts.size == 1) pts += b
            return FakeRoute(destination, pts)
        }

        private fun seedOf(a: LatLng, b: LatLng): Long {
            var h = 1_125_899_906_842_597L
            for (v in doubleArrayOf(a.lat, a.lng, b.lat, b.lng)) h = 31 * h + Math.round(v * 1_000_000)
            return h
        }
    }
}
