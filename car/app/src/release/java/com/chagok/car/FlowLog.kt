package com.chagok.car

import com.chagok.car.flow.Effect
import com.chagok.car.flow.Event

/** 릴리스 빌드에는 흐름 로그가 없다. 아무것도 하지 않는다. */
object FlowLog {
    @Suppress("UNUSED_PARAMETER")
    fun record(event: Event, effects: List<Effect>) = Unit
}
