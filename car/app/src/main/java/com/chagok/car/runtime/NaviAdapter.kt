package com.chagok.car.runtime

import ai.pleos.playground.navi.constants.NaviErrorCode
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
 * NaviHelper로 소요 시간 조회를 대신 실행하고 결과를 세션 이벤트로 바꾼다.
 * 소요 시간은 requestTrip → onTripInfo로 받는다. 연결 전에 온 요청은 대기시켰다가 연결되면 보내고,
 * 3초 타임아웃은 연결 대기 시간을 포함해 센다. 못 받거나 실패하면 null로 알린다([TripRequestTracker]).
 */
class NaviAdapter(context: Context, private val sink: (Event) -> Unit) : TravelTimeProvider {
    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val tracker = TripRequestTracker(Duration.ofSeconds(3))
    @Volatile private var naviHelper: NaviHelper? = null
    private var listener: NaviHelperEventListener? = null

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
        if (naviHelper != null) return
        tracker.reset()
        val helper = NaviHelper(appContext).also { naviHelper = it }
        try {
            helper.initialize(
                onConnected = {
                    // 해제됐거나 새 helper로 바뀐 뒤에 늦게 온 연결 콜백은 무시한다.
                    if (naviHelper === helper) {
                        helper.addListener(listenerFor(helper).also { listener = it })
                        // 연결 전에 온 요청이 있으면 지금 보낸다.
                        tracker.connected()?.let { send(helper, it.id, it.place) }
                    }
                },
                onFailed = {
                    Log.w(TAG, "내비 연결 실패", it)
                    if (naviHelper === helper) tracker.connectionFailed()?.let { id -> sink(Event.TravelTimeResult(id, null)) }
                },
            )
        } catch (e: Exception) {
            Log.w(TAG, "내비 초기화 실패", e)
            tracker.connectionFailed()?.let { id -> sink(Event.TravelTimeResult(id, null)) }
        }
    }

    override fun stop() {
        val helper = naviHelper ?: return
        naviHelper = null
        tracker.resolve()?.let { sink(Event.TravelTimeResult(it, null)) }
        tracker.reset()
        listener?.let { l -> runCatching { helper.removeListener(l) } }
        listener = null
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

    private fun resolveTrip(travelTime: Duration?) {
        val id = tracker.resolve() ?: return
        sink(Event.TravelTimeResult(id, travelTime))
    }

    private companion object {
        const val TAG = "ChagokNavi"
    }
}
