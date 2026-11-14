package com.chagok.car.runtime

import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import com.chagok.car.flow.Event
import com.chagok.car.flow.PairingClient
import com.chagok.car.flow.PairingVerdict
import com.chagok.car.flow.PairingVerifier
import com.chagok.car.flow.PairingCode
import java.time.Duration
import java.time.Instant

/**
 * 차–폰 연결을 맡는다. 연결 전이고 연결 카드가 보일 수 있을 때([setActive]: 앱이 앞에 있고 정차 중이고 Suspend가 아님)만
 * 서버에서 코드를 받아 세션에 알리고([Event.PairingCodeIssued]), [POLL_INTERVAL]마다 연결됐는지 물어 연결되면 저장하고 세션에 알린다([Event.Paired]).
 * 서버가 이 차의 코드를 모르면(서버 재시작·만료) 새 코드를 받는다. 서버에 닿지 않으면 [RETRY_MIN]부터 [RETRY_MAX]까지 늘려 가며 다시 한다.
 * 한 번 연결되면 차에 저장해 두고 다시 묻지 않는다(서버를 다시 켜도 차는 연결된 채로 둔다).
 * 서버 호출은 전용 스레드에서 한다. 로그에는 예외 종류만 남기고 차 id·코드는 남기지 않는다.
 */
class PairingController(
    private val client: PairingClient,
    private val store: ChagokStore,
    private val post: (Event) -> Unit,
    /** 서버가 이 연결을 모른다고(해제) 확인했을 때 불린다([verify]). 전용 스레드에서 불리므로 받은 쪽이 메인으로 넘긴다. 일정·집 사본 정리는 여기서 한다. */
    private val onReleased: () -> Unit = {},
) {
    private val thread = HandlerThread("chagok-pairing").apply { start() }
    private val handler = Handler(thread.looper)

    /** 아래 상태는 [handler] 스레드에서만 읽고 쓴다. */
    private var active = false
    private var running = false
    private var code: PairingCode? = null
    private var failures = 0

    /**
     * 연결 확인을 켜고 끈다. 끄면 다음 확인을 멈추기만 하고 받은 코드는 둔다(다시 켜면 그 코드가 살아 있는지부터 본다).
     * [SessionHost]가 앱이 앞에 있고 정차 중이고 Suspend가 아닐 때만 켠다.
     */
    fun setActive(active: Boolean) {
        handler.post {
            this.active = active
            if (active) resume() else pause()
        }
    }

    /**
     * 디버그·데모용: 연결 상태를 바로 바꾼다. 부른 스레드에서 저장하고 세션에 알리므로 같은 스레드가 이어 넣는 이벤트보다 먼저 처리된다.
     * 미리 연결해 두면 아무것도 말하지 않고(`Paired(brief = false)`), 풀면 서버에서도 풀고 새 코드를 받아 연결 카드를 다시 띄운다.
     */
    fun setPaired(paired: Boolean) {
        if (store.paired == paired) return
        store.paired = paired
        // 디버그로 맞춘 연결은 서버가 모른다. 서버가 확인한 연결이 아니라서 재진입 확인([verify])을 하지 않는다.
        store.pairedByServer = false
        post(if (paired) Event.Paired(brief = false) else Event.Unpaired)
        handler.post {
            pause()
            code = null
            if (paired) return@post
            try {
                client.unpair(store.carId())
            } catch (e: Exception) {
                Log.w(TAG, "서버 연결 풀기 실패: ${e::class.simpleName}")
            }
            resume()
        }
    }

    /**
     * 앱이 앞으로 올 때(재진입) 부른다. 서버가 확인해 준 연결([ChagokStore.pairedByServer])일 때만 서버에 이 차의 연결이 아직 있는지 묻고,
     * 서버가 "연결 없음"이라고 답하면 해제로 보고 정리한다(운전자 교체·폰에서 해제: 일정·집 좌표를 차에 남기지 않는다).
     * 서버에 닿지 못하거나 응답이 이상하면 해제로 단정하지 않고 그대로 둔다(다음 재진입에 다시 묻는다).
     * 서버를 다시 켜 메모리의 연결이 사라져도 "연결 없음"으로 답하므로 이때도 해제로 보인다(서버 저장이 메모리인 동안의 한계, docs/pairing.md).
     */
    fun verify() {
        if (!store.paired || !store.pairedByServer) return
        handler.post {
            val verdict = PairingVerifier.verify(client, store.carId(), store.paired, store.pairedByServer)
            if (verdict == PairingVerdict.UNKNOWN) Log.w(TAG, "연결 확인 실패(해제로 보지 않음)")
            if (verdict != PairingVerdict.RELEASED) return@post
            // 서버가 해제를 확인했다. 연결 전으로 바꾼 뒤(그 순간부터 일정 받기가 막힌다) 일정·집 사본을 지우고, 세션에 알려 새 코드를 받는다.
            store.paired = false
            store.pairedByServer = false
            onReleased()
            post(Event.Unpaired)
            pause()
            code = null
            resume()
        }
    }

    private fun resume() {
        if (!active || store.paired || running) return
        running = true
        failures = 0
        tick()
    }

    private fun pause() {
        running = false
        handler.removeCallbacksAndMessages(null)
    }

    private fun tick() {
        if (!running) return
        try {
            val current = code
            if (current == null || Instant.now().isAfter(current.expiresAt - RENEW_BEFORE_EXPIRY)) issue()
            var status = client.status(store.carId())
            // 서버를 다시 켜 코드를 잃었으면 보이던 번호로는 연결되지 않는다. 새 코드를 받아 카드를 바꾼다.
            if (!status.paired && !status.codeActive) {
                issue()
                status = client.status(store.carId())
            }
            failures = 0
            if (status.paired) {
                running = false
                code = null
                // 디버그로 이미 연결했으면 다시 알리지 않는다.
                if (!store.paired) {
                    store.paired = true
                    store.pairedByServer = true
                    post(Event.Paired(brief = true))
                }
                return
            }
            handler.postDelayed(::tick, POLL_INTERVAL.toMillis())
        } catch (e: Exception) {
            failures++
            Log.w(TAG, "연결 확인 실패: ${e::class.simpleName}")
            handler.postDelayed(::tick, retryDelay(failures).toMillis())
        }
    }

    private fun issue() {
        code = client.issue(store.carId()).also { post(Event.PairingCodeIssued(it.code, it.qr)) }
    }

    companion object {
        private const val TAG = "ChagokPairing"
        val POLL_INTERVAL: Duration = Duration.ofSeconds(2)
        val RETRY_MIN: Duration = Duration.ofSeconds(5)
        val RETRY_MAX: Duration = Duration.ofSeconds(60)
        private val RENEW_BEFORE_EXPIRY: Duration = Duration.ofSeconds(30)

        /** [failures]번째 연속 실패 뒤 기다릴 시간: 5·10·20·40·60·60…초 */
        fun retryDelay(failures: Int): Duration {
            val doubled = RETRY_MIN.multipliedBy(1L shl (failures - 1).coerceIn(0, 10))
            return if (doubled > RETRY_MAX) RETRY_MAX else doubled
        }
    }
}
