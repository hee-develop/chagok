package com.chagok.car

import com.chagok.car.domain.Gear
import com.chagok.car.fakenavi.FakeNaviSession
import com.chagok.car.flow.Event
import com.chagok.car.runtime.SessionHost
import java.time.Instant

/**
 * 디버그 줄 [데모 초기화] 버튼의 동작: **시연 시작 상태**로 돌아간다. 신호 `now=`가 하던 것에서 시작 시각을 기억해 두었다가 다시 쓰는 것이다.
 * - 데모 시계: 마지막 `now=` 신호의 시작 시각([DebugInjection.demoStartAt])으로 되돌린다. `now=`를 받은 적이 없으면 앱 시작 때의 시계(오프셋 0)다.
 *   [시간 +10분]을 여러 번 눌러 밀어 둔 시각이 새 기준이 되지 않는다.
 * - debug로 주입한 기어·주행 제한은 P·제한 없음으로, 주입 위치(`loc`)·가짜 경로·늘려 둔 하차 카드 시간은 지운다.
 *   실제 차량 신호 구독은 건드리지 않는다(같은 신호 이벤트를 세션에 넣을 뿐이다).
 * - 그 뒤 일정을 다시 받고 정차 중 앱 진입 판단을 한 번 돌린다(`now=` 뒤 `enter=true`와 같다): 연결 전이면 연결 카드, 연결돼 있으면 첫 탑승 브리핑이 나온다. 연결 상태는 그대로다.
 *
 * 기어는 세션을 비우기 전에 P로 돌려 둔다(비우면 P단 기록·탑승 기록도 함께 지워져, 방금 P단에 넣은 것으로 잡혀 앱 진입이 잠깐 정차로 무시되지 않는다).
 */
internal object DebugDemoReset {
    /** 초기화가 세션·시계에 하는 일. [SessionHost]를 [of]로 감싸 쓰고, 테스트는 기록하는 구현을 쓴다. */
    interface Target {
        fun post(event: Event)

        /** 데모 시계를 [at]으로 맞추고 일정 기준 시각도 [at]으로 하며 일정을 다시 받고 세션을 비운다. */
        fun resetDemo(at: Instant)
    }

    fun of(host: SessionHost) = object : Target {
        override fun post(event: Event) = host.post(event)
        override fun resetDemo(at: Instant) = host.resetDemo(at)
    }

    /**
     * @param now 시작 시각을 모를 때 쓸 실제 시각(시계 오프셋 0과 같다). 테스트가 고정한다.
     * @param clearFakeRoute 가짜 경로를 지운다. 안드로이드 Looper를 쓰는 싱글턴이라 JVM 테스트는 바꿔 끼운다.
     */
    fun reset(target: Target, now: Instant = Instant.now(), clearFakeRoute: () -> Unit = { FakeNaviSession.shared.clear() }) {
        clearFakeRoute()
        DebugInjection.injectedLocation = null
        DebugInjection.exitCardSeconds = null
        target.post(Event.GearChanged(Gear.PARK))
        target.post(Event.RestrictionChanged(false))
        target.resetDemo(DebugInjection.demoStartAt ?: now)
        target.post(Event.AppEntered)
    }
}
