package com.chagok.car.fakenavi

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

/**
 * 길안내 패널(화면 시안 Drive의 왼쪽 아래 패널)에 보일 내용.
 * 길을 가는 중에는 [destination](작은 글씨 "목적지 · 광주 육전집")·[headline](큰 도착 시각 "12:50")·[detail]("도착 · 212km 남음") 세 줄이고,
 * 도착하면 [destination]·[detail]이 null이고 [headline]이 "{장소} 도착" 하나다.
 */
data class FakeNaviPanel(val destination: String?, val headline: String, val detail: String?)

/** 가짜 내비 화면의 문구를 한곳에 모은다. 회전 안내는 시안에 없어 두지 않는다. */
object FakeNaviPhrases {
    const val BADGE = "시연용 가짜 지도"

    private val ETA = DateTimeFormatter.ofPattern("HH:mm")

    /** 패널이 세로 창 한 칸에서도 넘치지 않게 도착 문구의 장소 이름은 이 글자 수까지만 쓴다. */
    const val PLACE_NAME_MAX = 12

    /** "{장소} 도착". 이름이 [PLACE_NAME_MAX]자를 넘으면 줄이고 "…"를 붙인다. */
    fun arrived(placeName: String): String {
        val name = if (placeName.length > PLACE_NAME_MAX) placeName.take(PLACE_NAME_MAX).trimEnd() + "…" else placeName
        return "$name 도착"
    }

    /** "목적지 · 광주 육전집" */
    fun destination(placeName: String) = "목적지 · $placeName"

    /**
     * 남은 거리 표기. 시안은 정수 km("212km")다. 10km 미만은 정수로는 거칠어 소수 한 자리("4.2km")로 쓴다.
     * 소수 한 자리로 반올림해 10.0이 되면 정수("10km")로 쓴다. 남았지만 0.05km 미만이면 "0.1km"로 올린다.
     */
    fun km(meters: Double): String {
        val tenths = (meters / 100.0).roundToInt()
        return when {
            tenths >= 100 -> "${(meters / 1000.0).roundToInt()}km"
            tenths <= 0 -> if (meters > 0.0) "0.1km" else "0km"
            else -> "${tenths / 10}.${tenths % 10}km"
        }
    }

    /** "도착 · 212km 남음" */
    fun detail(remainingMeters: Double) = "도착 · ${km(remainingMeters)} 남음"

    /** 도착 예정 시각 "12:50". [now] + 남은 시간을 [zone]으로 표기한다. */
    fun eta(trip: FakeTrip, now: Instant, zone: ZoneId): String =
        ETA.format((now + trip.remainingDuration).atZone(zone))

    fun panel(trip: FakeTrip, now: Instant, zone: ZoneId): FakeNaviPanel {
        val name = trip.route.destination.name
        return if (trip.arrived) {
            FakeNaviPanel(null, arrived(name), null)
        } else {
            FakeNaviPanel(destination(name), eta(trip, now, zone), detail(trip.remainingMeters))
        }
    }
}
