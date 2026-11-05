package com.chagok.car

import com.chagok.car.flow.Event
import com.chagok.car.runtime.Adapters

/** 릴리스 빌드에는 주입 통로가 없어 어댑터를 그대로 쓴다. */
object DebugHooks {
    @Suppress("UNUSED_PARAMETER")
    fun wrap(adapters: Adapters, post: (Event) -> Unit): Adapters = adapters
}
