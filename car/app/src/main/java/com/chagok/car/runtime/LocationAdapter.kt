package com.chagok.car.runtime

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Rules
import com.chagok.car.flow.Event
import java.time.Duration

/**
 * 표준 Android [LocationManager]로 차 위치를 읽어 세션 이벤트(LocationChanged)로 바꾼다. 에뮬레이터는 `adb emu geo fix <경도> <위도>`로 바꿀 수 있다.
 * 실차의 Pleos FusedLocation SDK(`pleos.car.permission.FUSED_LOCATION`, 현재 SDK 신청 '준비 중')로 바꿀 때는 [Locator]만 새로 구현하면 된다(docs/sdk-check.md).
 *
 * 갱신은 보수적으로 한다(Pleos 앱 구조·리소스 가이드: 백그라운드에서 불필요한 센서 수집·폴링 최소화).
 * 포그라운드 위치 권한(ACCESS_FINE_LOCATION)만 쓰고 백그라운드 위치 권한(ACCESS_BACKGROUND_LOCATION)은 쓰지 않는다.
 * 그래서 **앱 화면이 보이지 않으면 위치를 못 받는 것이 예상 결과**다(그동안 위치 판정은 건너뛰어진다). 실차에서 얼마나 받는지는 docs/sdk-check.md 수동 확인 목록이다.
 * - 앱 화면이 앞에 있을 때만 주기 갱신([FOREGROUND_INTERVAL])을 켜고, 뒤로 가면 끈다. 이동 거리 [MIN_DISTANCE_METERS] 안이면 알리지 않는다.
 *   켜진 제공자가 없으면 이번엔 켜지 못하고, 다음에 앱이 앞으로 올 때([setForeground]) 다시 시도한다.
 * - 수동(passive) 갱신은 센서를 켜지 않고 다른 앱(내비)이 얻은 위치만 받는다. 메인 스레드 부하를 줄이려고 [PASSIVE_INTERVAL]·[PASSIVE_DISTANCE_METERS]로 간격을 둔다.
 *   앱이 앞에 있는 동안 내비 같은 다른 앱이 얻은 위치도 받으려는 것이고, 앱이 뒤에 있을 때 받는 것은 기대하지 않는다.
 * - [refreshNow]는 P단에 넣는 순간 시스템의 마지막 위치를 읽는다(백그라운드 권한이 없으면 null일 수 있다).
 * - 위치를 쓸 일이 있을 때([setNeeded]: 집 좌표가 있거나 오늘 남은 일정 중 장소가 있음)만 주기·수동 갱신을 켠다. 쓸 일이 없으면 센서를 읽지 않는다.
 * - 정확도 반경이 [Rules.LOCATION_MAX_ACCURACY_METERS](100m)보다 큰 측위는 버린다(정확도를 모르는 측위는 받는다).
 * - 읽은 위치는 측위한 지 얼마나 됐는지([Event.LocationChanged.ageMillis])만 실어 보내고, 나이 기준(5분)과 이번 주행 시작 뒤인지는 세션이 판단한다.
 * 권한(ACCESS_FINE_LOCATION)이 없으면 아무것도 하지 않는다. 시스템이 Suspend로 가면 [stop], 돌아오면 [start]로 권한을 다시 확인하고 켠다. 메인 스레드에서 부른다.
 */
class LocationAdapter(context: Context, private val sink: (Event) -> Unit) : Locator {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

    private var started = false
    private var foreground = false
    private var needed = false
    private var passiveOn = false
    private var activeOn = false

    // 수동 갱신과 주기 갱신은 따로 켜고 끌 수 있게 listener를 나눈다.
    private val passiveListener = LocationListener { location -> report(location, sink) }
    private val activeListener = LocationListener { location -> report(location, sink) }

    override fun start() {
        started = true
        apply()
    }

    override fun stop() {
        started = false
        apply()
    }

    override fun setForeground(foreground: Boolean) {
        this.foreground = foreground
        apply()
    }

    override fun setNeeded(needed: Boolean) {
        if (this.needed == needed) return
        this.needed = needed
        apply()
    }

    /** 지금 상태(시작 여부·권한·쓸 일·앞뒤)에 맞게 갱신 요청을 켜고 끈다. */
    private fun apply() {
        val lm = manager ?: return
        val allowed = started && needed && hasPermission()
        if (allowed != passiveOn) {
            if (allowed) {
                passiveOn = runCatching {
                    lm.requestLocationUpdates(
                        LocationManager.PASSIVE_PROVIDER, PASSIVE_INTERVAL.toMillis(), PASSIVE_DISTANCE_METERS, passiveListener, Looper.getMainLooper(),
                    )
                }.onFailure { Log.w(TAG, "수동 위치 갱신을 켜지 못함", it) }.isSuccess
            } else {
                runCatching { lm.removeUpdates(passiveListener) }
                passiveOn = false
            }
        }
        val wantActive = allowed && foreground
        if (wantActive != activeOn) {
            if (wantActive) {
                val provider = ACTIVE_PROVIDERS.firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) } ?: return
                activeOn = runCatching {
                    lm.requestLocationUpdates(provider, FOREGROUND_INTERVAL.toMillis(), MIN_DISTANCE_METERS, activeListener, Looper.getMainLooper())
                }.onFailure { Log.w(TAG, "위치 갱신을 켜지 못함", it) }.isSuccess
            } else {
                runCatching { lm.removeUpdates(activeListener) }
                activeOn = false
            }
        }
    }

    override fun refreshNow(deliver: (Event) -> Unit) {
        val lm = manager ?: return
        if (!started || !needed || !hasPermission()) return
        val best = (ACTIVE_PROVIDERS + LocationManager.PASSIVE_PROVIDER)
            .mapNotNull { provider -> runCatching { lm.getLastKnownLocation(provider) }.getOrNull() }
            .maxByOrNull { it.elapsedRealtimeNanos } ?: return
        report(best, deliver)
    }

    /** 측위 시각(`elapsedRealtimeNanos`)으로 잰 나이를 실어 세션에 알린다. 세션 시계와 섞지 않으려고 시각이 아니라 나이를 보낸다. */
    private fun report(location: Location, to: (Event) -> Unit) {
        if (!isAccurateEnough(location.hasAccuracy(), location.accuracy)) return
        val ageMillis = Duration.ofNanos(SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos).toMillis().coerceAtLeast(0)
        to(Event.LocationChanged(LatLng(location.latitude, location.longitude), ageMillis))
    }

    private fun hasPermission() =
        appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    companion object {
        private const val TAG = "ChagokLocation"

        /** 정확도 반경이 [Rules.LOCATION_MAX_ACCURACY_METERS]를 넘으면 버린다. 정확도를 모르는 측위(수동 갱신으로 온 다른 앱의 값 등)는 받는다. */
        internal fun isAccurateEnough(hasAccuracy: Boolean, accuracyMeters: Float): Boolean =
            !hasAccuracy || accuracyMeters <= Rules.LOCATION_MAX_ACCURACY_METERS

        /** 앞에 있을 때 위치를 다시 읽는 최소 간격. 도착 판정(300m)에 필요한 정밀도보다 훨씬 성기게 잡았다. */
        val FOREGROUND_INTERVAL: Duration = Duration.ofSeconds(30)

        /** 수동 갱신 간격(10초·25m). 다른 앱이 자주 갱신해도 메인 스레드에 이만큼보다 자주 오지 않게 한다. */
        val PASSIVE_INTERVAL: Duration = Duration.ofSeconds(10)
        const val PASSIVE_DISTANCE_METERS = 25f

        /** 이 거리(미터)보다 덜 움직이면 갱신을 알리지 않는다. */
        const val MIN_DISTANCE_METERS = 50f

        /** 주기 갱신에 쓸 제공자 우선순위. 'fused'는 API 31 이상에만 있어 이름으로 쓴다(없으면 건너뜀). */
        private val ACTIVE_PROVIDERS = listOf(LocationManager.GPS_PROVIDER, "fused", LocationManager.NETWORK_PROVIDER)
    }
}
