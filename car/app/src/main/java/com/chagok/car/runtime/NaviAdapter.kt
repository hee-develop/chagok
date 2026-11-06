package com.chagok.car.runtime

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.RouteOption
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.TripInfo
import ai.pleos.playground.navi.data.TripRequest
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.chagok.car.domain.Place
import com.chagok.car.flow.Event
import java.time.Duration

/**
 * NaviHelper로 소요 시간 조회와 길안내 요청을 대신 실행하고 소요 시간 결과를 세션 이벤트로 바꾼다.
 * 소요 시간은 requestTrip → onTripInfo로 받는다. 연결 전에 온 요청은 대기시켰다가 연결되면 보내고,
 * 3초 타임아웃은 연결 대기 시간을 포함해 센다. 못 받거나 실패하면 null로 알린다([TripRequestTracker]).
 */
class NaviAdapter(context: Context, private val sink: (Event) -> Unit) : Navigator {
    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val tracker = TripRequestTracker(Duration.ofSeconds(3))
    @Volatile private var naviHelper: NaviHelper? = null
    private var listener: NaviHelperEventListener? = null

    /** helper 교체([start]·[stop])와 연결 상태 갱신(onConnected·onFailed)을 한 덩어리로 묶는다. 콜백은 바인더 스레드에서 온다. */
    private val lock = Any()

    /** [helper] 하나에 묶인 리스너. 해제됐거나 새 helper로 바뀐 뒤에 온 응답은 무시한다. */
    private fun listenerFor(helper: NaviHelper) = object : NaviHelperEventListener {
        override fun onTripInfo(tripInfo: TripInfo) {
            if (naviHelper !== helper) return
            Log.i(TAG, "onTripInfo eta=${tripInfo.eta} distance=${tripInfo.distance}")
            resolveTrip(NaviDuration.of(tripInfo.eta))
        }

        override fun onError(errorCode: NaviErrorCode) {
            if (naviHelper !== helper) return
            Log.w(TAG, "내비 오류 $errorCode")
            resolveTrip(null)
        }
    }

    /** SDK를 새로 만들어 연결한다. [stop] 뒤에 다시 부를 수 있다. */
    override fun start() {
        val helper = synchronized(lock) {
            if (naviHelper != null) return
            tracker.reset()
            NaviHelper(appContext).also { naviHelper = it }
        }
        try {
            helper.initialize(
                onConnected = {
                    // 해제됐거나 새 helper로 바뀐 뒤에 늦게 온 연결 콜백은 무시한다. 확인과 연결 표시는 한 덩어리다.
                    val waiting = synchronized(lock) {
                        if (naviHelper !== helper) return@initialize
                        helper.addListener(listenerFor(helper).also { listener = it })
                        tracker.connected()
                    }
                    // 연결 전에 온 요청이 있으면 지금 보낸다.
                    waiting?.let { send(helper, it.id, it.place) }
                },
                onFailed = {
                    Log.w(TAG, "내비 연결 실패", it)
                    val id = synchronized(lock) { if (naviHelper === helper) tracker.connectionFailed() else null }
                    id?.let { sink(Event.TravelTimeResult(it, null)) }
                },
            )
        } catch (e: Exception) {
            Log.w(TAG, "내비 초기화 실패", e)
            val id = synchronized(lock) { if (naviHelper === helper) tracker.connectionFailed() else null }
            id?.let { sink(Event.TravelTimeResult(it, null)) }
        }
    }

    override fun stop() {
        val (helper, pendingId, oldListener) = synchronized(lock) {
            val current = naviHelper ?: return
            naviHelper = null
            val pending = tracker.resolve()
            tracker.reset()
            val old = listener
            listener = null
            Triple(current, pending, old)
        }
        pendingId?.let { sink(Event.TravelTimeResult(it, null)) }
        oldListener?.let { l -> runCatching { helper.removeListener(l) } }
        runCatching { helper.release() }
    }

    override fun requestTravelTime(requestId: Int, place: Place) {
        val helper = naviHelper
        if (helper == null) {
            sink(Event.TravelTimeResult(requestId, null))
            return
        }
        when (tracker.request(requestId, place)) {
            TripRequestTracker.Step.FAIL -> {
                sink(Event.TravelTimeResult(requestId, null))
                return
            }
            TripRequestTracker.Step.SEND_NOW -> send(helper, requestId, place)
            TripRequestTracker.Step.WAIT_FOR_CONNECTION -> Unit
        }
        // 타임아웃은 요청을 받은 시점부터 센다(연결 대기 포함).
        main.postDelayed({ if (tracker.expire(requestId)) sink(Event.TravelTimeResult(requestId, null)) }, tracker.timeout.toMillis())
    }

    private fun send(helper: NaviHelper, requestId: Int, place: Place) {
        try {
            helper.requestTrip(
                TripRequest(place.position.lat, place.position.lng, poiId = "", poiName = place.name, poiSubId = ""),
            )
        } catch (e: Exception) {
            Log.w(TAG, "requestTrip 실패", e)
            if (tracker.expire(requestId)) sink(Event.TravelTimeResult(requestId, null))
        }
    }

    /**
     * 요청을 내비에 보냈으면 true. 내비에 연결되기 전(시작·재시작 직후)이면 보내지 않고 false를 돌려 실패로 안내한다.
     * 경로가 실제로 시작됐는지는 내비 이벤트로 오며 이 앱은 요청 전달까지만 알린다.
     */
    override fun startRoute(place: Place): Boolean {
        val helper = synchronized(lock) {
            val current = naviHelper ?: return false
            if (!tracker.ready) return false
            current
        }
        return try {
            helper.requestRoute(
                RouteInfo(
                    latitude = place.position.lat,
                    longitude = place.position.lng,
                    poiName = place.name,
                    poiId = "",
                    address = "",
                    poiSubId = "",
                    routeOption = RouteOption.RECOMMENDED,
                ),
            )
            true
        } catch (e: Exception) {
            Log.w(TAG, "requestRoute 실패", e)
            false
        }
    }

    private fun resolveTrip(travelTime: Duration?) {
        val id = tracker.resolve() ?: return
        sink(Event.TravelTimeResult(id, travelTime))
    }

    private companion object {
        const val TAG = "ChagokNavi"
    }
}
