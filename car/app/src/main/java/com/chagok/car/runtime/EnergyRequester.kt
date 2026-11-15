package com.chagok.car.runtime

import com.chagok.car.domain.EnergyRequest
import com.chagok.car.flow.EnergyHttpException
import com.chagok.car.flow.EnergyOptionsFetcher
import com.chagok.car.flow.EnergyWire
import com.chagok.car.flow.Event
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * [com.chagok.car.flow.Effect.RequestEnergyOptions]를 실행한다: 서버를 별도 스레드에서 한 번 부르고 답(또는 실패)을 [Event.EnergyOptionsResult]로
 * 같은 요청 번호로 넣는다. 제한 시간은 [fetcher]가 건다(넘으면 예외 → 실패). 실패·429·잘못된 응답은 모두 options=null이다.
 * 429(분당 20회 초과)를 받으면 `Retry-After`가 지나기 전에는 서버를 부르지 않고 바로 실패로 답한다(`docs/energy.md`).
 * 답은 요청마다 반드시 한 번 온다(세션이 답을 기다리며 탑승 판단을 멈추므로).
 */
class EnergyRequester(
    private val fetcher: EnergyOptionsFetcher,
    private val post: (Event) -> Unit,
    private val worker: Executor = Executors.newCachedThreadPool { r -> Thread(r, "energy-fetch").apply { isDaemon = true } },
    private val nowMillis: () -> Long = System::currentTimeMillis,
) {
    @Volatile private var blockedUntilMillis = 0L

    fun request(requestId: Int, request: EnergyRequest) {
        if (nowMillis() < blockedUntilMillis) {
            post(Event.EnergyOptionsResult(requestId, null))
            return
        }
        worker.execute {
            val options = try {
                EnergyWire.parse(fetcher.fetch(request))
            } catch (e: EnergyHttpException) {
                if (e.status == 429) blockedUntilMillis = nowMillis() + (e.retryAfterSeconds ?: DEFAULT_RETRY_SECONDS) * 1000
                null
            } catch (e: Exception) {
                null
            }
            post(Event.EnergyOptionsResult(requestId, options))
        }
    }

    private companion object {
        /** 429에 `Retry-After`가 없을 때 쉬는 시간(초). 서버 속도 제한 창(60초)과 같다. */
        const val DEFAULT_RETRY_SECONDS = 60L
    }
}
