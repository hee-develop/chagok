package com.chagok.car

import com.chagok.car.domain.Rules
import com.chagok.car.flow.Event
import com.chagok.car.runtime.Adapters
import java.time.Duration

/** 릴리스 빌드에는 주입 통로가 없어 어댑터를 그대로 쓴다. */
object DebugHooks {
    /** 릴리스는 늘 정책 기준값이다. */
    fun exitCardDuration(): Duration = Rules.EXIT_CARD

    @Suppress("UNUSED_PARAMETER")
    fun wrap(adapters: Adapters, post: (Event) -> Unit): Adapters = adapters
}
