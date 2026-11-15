package com.chagok.car

import android.util.Log
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.flow.Effect
import com.chagok.car.flow.Event
import kotlin.math.roundToInt

/**
 * 디버그 빌드 전용 흐름 로그. 세션에 들어간 이벤트와 나온 Effect를 사람이 읽는 한 줄씩 `ChagokFlow` 태그로 남긴다.
 * 위치(`LocationChanged`는 줄 자체를 남기지 않음)·연결 번호와 QR(`PairingCodeIssued`는 이름만)·들은 말 원문(`Heard`는 길이만)은 남기지 않는다.
 * 카드·말·결과 한 줄·칩 문구와 일정 제목, 길안내를 요청한 장소 이름은 남는다(시나리오 확인용).
 * `scripts/demo-car.sh`가 logcat에서 이 줄을 읽어 단계마다 기대 동작과 맞는지 확인한다. 줄 문구를 바꾸면 그 스크립트의 기대 패턴도 함께 고친다.
 * 릴리스 소스셋에는 아무것도 하지 않는 같은 이름의 객체가 있다.
 */
object FlowLog {
    private const val TAG = "ChagokFlow"

    /** 마지막으로 저장한 일정 상태. 다음 [Effect.Save]와 비교해 바뀐 것만 적는다. */
    private var savedStatuses: Map<String, ScheduleStatus> = emptyMap()

    /** 프로세스가 시작된 뒤 첫 Save는 비교 기준으로만 쓴다(복원한 상태를 변화로 적지 않으려고). */
    private var baselined = false

    /** 지금 처리하는 이벤트가 [Event.Reset]인가. 이때 나온 저장 줄에는 "초기화"를 표시해 상태가 되돌아간 것으로 보이지 않게 한다. */
    private var resetting = false

    fun record(event: Event, effects: List<Effect>) {
        // 위치는 개인 정보이고 가짜 내비가 초마다 넣어 로그를 덮으므로 이벤트 줄을 남기지 않는다(판정 결과는 Save·카드 줄로 보인다).
        if (event is Event.LocationChanged) {
            effects.forEach { effect -> lineOf(effect)?.let(::emit) }
            return
        }
        emit("이벤트 ${describe(event)}")
        resetting = event is Event.Reset
        try {
            effects.forEach { effect -> lineOf(effect)?.let(::emit) }
        } finally {
            resetting = false
        }
    }

    /** 테스트용: 프로세스를 새로 시작한 상태로 되돌린다. */
    internal fun resetForTest() {
        savedStatuses = emptyMap()
        baselined = false
        resetting = false
    }

    private fun emit(line: String) {
        Log.i(TAG, line)
    }

    internal fun describe(event: Event): String = when (event) {
        // 연결 번호와 QR 내용은 로그에 남기지 않는다.
        is Event.PairingCodeIssued -> "PairingCodeIssued"
        // 들은 말 원문은 남기지 않고 길이만 남긴다(음성 인식 결과는 개인 정보일 수 있다).
        is Event.Heard -> "Heard(len=${event.text.length})"
        else -> event.toString()
    }

    /** Effect 하나를 한 줄로. 적을 것이 없으면 null. */
    internal fun lineOf(effect: Effect): String? = when (effect) {
        is Effect.ShowCard -> {
            val c = effect.card
            val parts = listOfNotNull(
                "칩=${c.status}".takeIf { c.status.isNotEmpty() },
                "voice=${oneLine(c.voice)}",
                c.sub?.let { "sub=${oneLine(it)}" },
                c.footnote?.let { "각주=$it" },
                c.notice?.let { "안내=$it" },
                "버튼=${listOfNotNull(c.primary, c.secondary).joinToString("/")}".takeIf { c.primary != null || c.secondary != null },
            )
            "카드 ${parts.joinToString(" | ")}"
        }
        is Effect.CollapseCard -> "카드 접음"
        is Effect.ShowResult -> if (effect.text.isEmpty()) "결과 한 줄 지움" else "결과 한 줄: ${effect.text}"
        is Effect.ShowNextChip -> if (effect.text.isEmpty()) "다음 일정 칩 숨김" else "다음 일정 칩: ${effect.text}"
        is Effect.Speak -> "말함: ${oneLine(effect.text)}${if (effect.thenListen) " (듣기)" else ""}"
        is Effect.StartRoute -> "길안내 요청: ${effect.place.name}${effect.via?.let { " (경유 ${it.name})" }.orEmpty()}"
        is Effect.RequestEnergyOptions -> "에너지 후보 요청: ${effect.request.fuel.server}"
        is Effect.EnergyJudged -> "에너지: 필요 ${effect.neededKm.roundToInt()}km, 가능 ${effect.rangeKm.roundToInt()}km → ${if (effect.short) "모자람" else "넉넉함"}"
        is Effect.RequestTravelTime -> "소요 시간 요청: ${effect.place.name}"
        is Effect.Save -> describeSave(effect)
        else -> null
    }

    private fun describeSave(effect: Effect.Save): String? {
        val snap = effect.snapshot
        if (!baselined) {
            baselined = true
            savedStatuses = snap.statuses
            return null
        }
        val changes = (savedStatuses.keys + snap.statuses.keys).sorted().mapNotNull { id ->
            val before = savedStatuses[id] ?: ScheduleStatus.PLANNED
            val after = snap.statuses[id] ?: ScheduleStatus.PLANNED
            if (before == after) null else "$id ${label(before)}→${label(after)}"
        }
        savedStatuses = snap.statuses
        return if (changes.isEmpty()) null else "저장${if (resetting) "(초기화)" else ""}: ${changes.joinToString(", ")}"
    }

    private fun label(status: ScheduleStatus) = when (status) {
        ScheduleStatus.PLANNED -> "예정"
        ScheduleStatus.LATE -> "늦음"
        ScheduleStatus.ARRIVED -> "도착"
        ScheduleStatus.SKIPPED -> "건너뜀"
    }

    private fun oneLine(text: String) = text.replace("\n", " / ")
}
