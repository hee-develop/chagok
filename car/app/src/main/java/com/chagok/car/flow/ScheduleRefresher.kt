package com.chagok.car.flow

/**
 * 일정 받기를 시작하고 세션에 알리는 순서를 정한다. 메인 스레드에서만 부른다.
 * 받기를 시작하자마자 같은 호출 안에서 [deliver]로 [Event.ScheduleLoading]을 세션에 바로 넣고,
 * 끝났다는 [Event.ScheduleLoaded]는 [post]로 큐에 넣는다. 그래서 같은 세대의 완료가 시작보다 먼저 세션에 닿는 일이 없고,
 * 다른 이벤트가 사이에 끼어들 수도 없다. 받기가 즉시 끝나거나 실패해도 같다.
 */
class ScheduleRefresher(
    private val source: ServerScheduleSource,
    /** 이벤트를 메인 큐에 넣는다(나중에 순서대로 세션에 닿는다). */
    private val post: (Event) -> Unit,
    /** 이벤트를 지금 바로 세션에 넣는다. */
    private val deliver: (Event) -> Unit,
) {
    fun refresh() {
        val generation = source.refresh { done -> post(Event.ScheduleLoaded(done)) }
        deliver(Event.ScheduleLoading(generation))
    }
}
