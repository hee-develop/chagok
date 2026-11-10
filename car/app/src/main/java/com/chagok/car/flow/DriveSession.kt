package com.chagok.car.flow

import com.chagok.car.domain.BoardingDecider
import com.chagok.car.domain.BoardingDecision
import com.chagok.car.domain.BoardingKind
import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.DayPlan
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.domain.Intent
import com.chagok.car.domain.IntentMatcher
import com.chagok.car.domain.Motion
import com.chagok.car.domain.Place
import com.chagok.car.domain.Question
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.domain.ScheduleStatus
import com.chagok.car.ui.CardContent
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate

/** 세션에 들어오는 입력. 어댑터가 차량·SDK·화면 신호를 이 이벤트로 바꿔 넣는다. */
sealed interface Event {
    /**
     * 탑승으로 바로 인정한다(규칙 없이). 디버그 [탑승] 버튼용.
     * 실제 신호는 [IgnitionChanged]와 [AppEntered]로 넣고, 인정 여부는 세션이 판단한다.
     */
    data object Boarded : Event

    /** 시동 상태 값. 어댑터는 걸러 내지 않고 읽은 값을 그대로 넣는다. 탑승·Suspend 판단은 세션이 한다. */
    data class IgnitionChanged(val ignition: Ignition) : Event

    /** 시동 신호가 없을 때 앱 진입(onResume). 그날 첫 진입이거나 주행→P단 뒤일 때만 탑승으로 인정한다. */
    data object AppEntered : Event

    /** 시동 OFF·LOCK 말고 Suspend로 가는 다른 신호(시스템 종료 알림 등). */
    data object SuspendRequested : Event

    /** 사용자가 앱을 다시 열었다. Suspend 중이었다면 어댑터를 다시 켠다(포커스·재생은 되찾지 않는다). */
    data object Resumed : Event
    data class GearChanged(val gear: Gear) : Event
    /** 주행 제한 알림. 값은 distraction optimization 필요 또는 설정 조작 금지(NO_SETUP)가 켜졌는지. */
    data class RestrictionChanged(val requiresDistractionOptimization: Boolean) : Event

    /** 소요 시간 응답. 3초 안에 못 받았거나 실패하면 null(타임아웃은 어댑터가 건다). */
    data class TravelTimeResult(val requestId: Int, val travelTime: Duration?) : Event

    /** [Effect.StartRoute] 호출 결과. 요청을 내비에 보내지 못했으면 ok=false. */
    data class RouteRequestResult(val ok: Boolean) : Event

    /** STT 결과. 아무것도 못 들었으면 빈 문자열. */
    data class Heard(val text: String) : Event

    /** 결과 한 줄을 보인 지 [Rules.RESULT_VISIBLE]이 지났다. */
    data class ResultTimedOut(val timerId: Int) : Event

    /** 카드의 주 버튼 */
    data object PrimaryPressed : Event

    /** 카드의 보조 버튼 */
    data object SecondaryPressed : Event

    /** 목적지 묻기 카드의 후보 줄을 눌렀다. [index]는 0부터 센 후보 번호다(0번은 주 버튼과 같다). */
    data class CandidatePressed(val index: Int) : Event
    data class CardTimedOut(val timerId: Int) : Event

    /** 데모 초기화: 일정 상태와 BoardingLog를 비운다. */
    data object Reset : Event

    /** 일정 받기([generation]세대)가 시작됐다. 끝날 때까지 탑승 판단은 보류한다. */
    data class ScheduleLoading(val generation: Int) : Event

    /** [generation]세대의 일정 받기가 끝났다(성공·실패 모두). 마지막으로 시작한 세대일 때만 보류한 탑승 판단을 이어 간다. */
    data class ScheduleLoaded(val generation: Int) : Event
}

/** 저장할 상태. 어댑터가 SharedPreferences에 둔다. */
data class Snapshot(
    val log: BoardingLog,
    val statuses: Map<String, ScheduleStatus>,
    /** statuses가 속한 날짜. 날짜가 바뀌면 끝난 일정의 상태는 비운다(끝나지 않은 일정은 남김). */
    val date: LocalDate,
    /** 일정을 불러오지 못했다는 안내를 마지막으로 한 날짜. 같은 날 프로세스가 다시 시작돼도 안내를 반복하지 않는다. */
    val noticeDate: LocalDate? = null,
)

/** 세션이 내보내는 출력. 어댑터는 이것을 실행하기만 한다. */
sealed interface Effect {
    data class ShowCard(val card: CardContent) : Effect

    /** [instant]면 애니메이션 없이 바로 접는다(주행 제한·시동 끔·교체). 아니면 퇴장 애니메이션 400ms. */
    data class CollapseCard(val instant: Boolean = false) : Effect


    /** 카드를 접은 뒤에도 남기는 결과 한 줄. 빈 문자열이면 지운다. */
    data class ShowResult(val text: String) : Effect

    /** [delay] 뒤에 [Event.ResultTimedOut]을 넣는다. */
    data class ScheduleResultTimeout(val timerId: Int, val delay: Duration) : Effect

    /** [thenListen]이면 말이 끝난 뒤 [Rules.LISTEN_WINDOW] 동안 듣고 결과를 [Event.Heard]로 넣는다. */
    data class Speak(val text: String, val thenListen: Boolean) : Effect

    /** 말하기와 듣기를 멈추고 포커스를 반납한다. */
    data object StopVoice : Effect

    /** Suspend 진입: 어댑터 stop()/release(). 이 Effect 앞에 StopVoice와 Save가 먼저 나온다. */
    data object EnterSuspend : Effect

    /** Suspend 해제: 어댑터를 다시 켠다. 오디오 포커스나 재생은 되찾지 않는다. */
    data object ExitSuspend : Effect
    data class RequestTravelTime(val requestId: Int, val place: Place) : Effect

    /** [place]로 길안내를 요청한다. 실행한 쪽은 요청을 보냈는지를 [Event.RouteRequestResult]로 알린다. */
    data class StartRoute(val place: Place) : Effect
    data class Save(val snapshot: Snapshot) : Effect
    data class ScheduleCardTimeout(val timerId: Int, val delay: Duration) : Effect

    /**
     * 일정을 다시 받는다. 일정 출처가 최신이 아닌데 탑승을 판단해야 할 때 내며, 세션은 이미 받는 중으로 본다.
     * 실행한 쪽은 받기를 시작한 뒤 [Event.ScheduleLoading]과 끝날 때 [Event.ScheduleLoaded]를 같은 세대 번호로 넣는다.
     */
    data object RefreshSchedules : Effect
}

/**
 * 탑승 브리핑과 출발 제안 → 길안내의 흐름 제어(정책서 3~7장). Android를 쓰지 않고 이벤트 → Effect 목록으로만 동작한다.
 * 모든 호출은 한 스레드(메인)에서 해야 한다.
 */
class DriveSession(
    private val clock: Clock,
    private val source: ScheduleSource,
    restored: Snapshot? = null,
) {
    private val zone get() = clock.zone

    private var log = restored?.log ?: BoardingLog()
    private var statuses: Map<String, ScheduleStatus> = emptyMap()
    private var statusDate: LocalDate = today()
    private var lastSaved: Snapshot? = null

    /** 이벤트 하나를 처리하는 동안 쓰는 오늘 일정과 그 출처. 이벤트마다 한 번만 읽는다. */
    private var schedules: List<Schedule> = emptyList()
    private var origin = ScheduleOrigin.FRESH

    /** 일정과 같은 응답에 실려 온 자주 가는 곳. 목적지 묻기 후보로 쓴다. */
    private var favorites: List<Favorite> = emptyList()

    /**
     * 마지막으로 시작한 일정 받기의 세대. 이 세대의 완료만 받는다.
     * 세션이 다시 받기를 요청한 뒤 실행한 쪽이 세대를 알려 주기 전에는 [AWAITING_GENERATION]이라 어떤 완료도 받지 않는다.
     */
    private var loadGeneration = 0

    /** 일정을 받지 못했다는 안내를 마지막으로 한 날짜. 같은 날 다시 말하지 않는다. */
    private var noticeSpokenOn: LocalDate? = restored?.noticeDate

    /** 세션이 다시 받기를 요청한 뒤 세대가 확정되기 전에 먼저 도착한 완료 세대. 같은 세대의 받기 시작이 오면 이미 끝난 것으로 본다. */
    private val earlyCompleted = mutableSetOf<Int>()

    /** 일정을 받는 중인가. 받는 동안 들어온 탑승 판단은 [heldBoarding]으로 보류한다. */
    private var loadingSchedules = false
    private var heldBoarding = false

    private var gear = Gear.UNKNOWN
    private var restricted = false

    /** 마지막 P단 뒤에 D·R로 달린 적이 있는가. D→N→P처럼 N을 거쳐도 이어진다. */
    private var drivenSincePark = false
    private var drivingHandled = false
    private var ignition: Ignition? = null
    private var suspended = false
    private var enterSuspend = false
    private var forceSave = false

    private var pending: PendingBoarding? = null
    private var card: CardState? = null
    private var acceptedRoute = false
    private var seq = 0

    /** 결과 한 줄을 보이고 있으면 그 타이머 ID, 아니면 null */
    private var resultTimerId: Int? = null

    private class PendingBoarding(val requestId: Int, val kind: BoardingKind, val targetId: String)

    private class CardState(
        val view: CardContent,
        /** 질문 카드의 질문. 일정 안내 카드는 null */
        val question: Question?,
        var timerId: Int,
        /** 듣기가 열려 있는가. 질문 카드가 말을 마치면 듣고, 결과를 받으면 닫는다(다시 물을 때만 다시 연다). */
        var voiceOpen: Boolean = false,
        var reprompts: Int = 0,
        /** 알아듣지 못함·대안 없음 같은 안내 한 줄 */
        var notice: String? = null,
        /** 일정을 불러오지 못했다는 안내 카드인가 */
        val isScheduleNotice: Boolean = false,
    )

    init {
        if (restored != null && restored.date == statusDate) statuses = restored.statuses
        lastSaved = snapshot()
    }

    private fun today(): LocalDate = clock.instant().atZone(zone).toLocalDate()
    private fun now(): Instant = clock.instant()
    private fun motion() = Motion.of(gear, restricted)

    /** 지금 주행 중인가(기어 D·R 또는 주행 제한). 기어를 모르면 false. */
    val isDriving: Boolean get() = motion() == Motion.DRIVING
    private fun plan() = DayPlan(schedules, statuses)
    private fun snapshot() = Snapshot(log, statuses, statusDate, noticeSpokenOn)

    fun handle(event: Event): List<Effect> {
        val out = mutableListOf<Effect>()
        val snapshot = source.snapshot()
        schedules = snapshot.schedules
        origin = snapshot.origin
        favorites = snapshot.favorites
        var loadedNow = false
        if (event is Event.ScheduleLoading) {
            // 세대는 늘기만 한다. 이미 받은 것보다 오래된 시작은 무시한다.
            if (event.generation > loadGeneration) {
                loadGeneration = event.generation
                loadingSchedules = true
                if (earlyCompleted.remove(event.generation)) {
                    loadingSchedules = false
                    loadedNow = true
                }
                earlyCompleted.clear()
            }
        } else if (event is Event.ScheduleLoaded) {
            if (event.generation == loadGeneration) {
                loadingSchedules = false
                loadedNow = true
            } else if (loadGeneration == AWAITING_GENERATION) {
                earlyCompleted += event.generation
            }
        }
        // 일정을 받는 동안(받기 시작 이벤트 포함)에는 캐시가 이전 기준 시각의 것일 수 있어 지난 일정 처리와 날짜 넘김을 하지 않는다.
        if (!loadingSchedules) {
            rollDate()
            statuses = plan().skipOverdue(now()).statuses
        }
        when (event) {
            Event.Boarded -> onBoarded(out)
            is Event.IgnitionChanged -> onIgnition(event.ignition, out)
            Event.AppEntered -> if (log.acceptsAppEntry(now(), zone)) onBoarded(out)
            Event.SuspendRequested -> suspend(out)
            Event.Resumed -> resume(out)
            is Event.GearChanged -> onGear(event.gear, out)
            is Event.RestrictionChanged -> {
                restricted = event.requiresDistractionOptimization
                enforceDriving(out)
            }
            is Event.TravelTimeResult -> onTravelTime(event, out)
            is Event.RouteRequestResult -> onRouteResult(event.ok, out)
            is Event.ResultTimedOut -> if (resultTimerId == event.timerId) clearResult(out)
            is Event.Heard -> onHeard(event.text, out)
            Event.PrimaryPressed -> onButton(primary = true, out)
            Event.SecondaryPressed -> onButton(primary = false, out)
            is Event.CandidatePressed -> onCandidate(event.index, out)
            is Event.CardTimedOut -> if (card?.timerId == event.timerId) closeCard(out)
            Event.Reset -> onReset(out)
            is Event.ScheduleLoading, is Event.ScheduleLoaded -> if (loadedNow) onSchedulesLoaded(out)
        }
        flush(out)
        if (enterSuspend) {
            enterSuspend = false
            out += Effect.EnterSuspend
        }
        return out
    }

    /**
     * 날짜가 바뀌면 지난 날의 상태를 비운다. 단 자정을 넘어 아직 끝나지 않은 일정(23:00~01:00 등)의
     * 상태는 남겨, 이미 도착·건너뜀인 일정이 되살아나지 않게 한다.
     * 새 날에 시작하는 일정은 ID가 같아도(반복 일정) 지난 날의 상태를 물려받지 않는다.
     */
    private fun rollDate() {
        val today = today()
        if (today == statusDate) return
        statusDate = today
        val now = now()
        val midnight = today.atStartOfDay(zone).toInstant()
        val spanning = schedules.filter { it.start.isBefore(midnight) && it.end.isAfter(now) }.map { it.id }.toSet()
        statuses = statuses.filterKeys { it in spanning }
    }

    /** 말은 정차 중에만 한다(6장). Suspend 중에도 하지 않는다. */
    private fun canSpeak() = !suspended && motion() == Motion.STOPPED

    private fun speak(out: MutableList<Effect>, text: String, thenListen: Boolean) {
        if (canSpeak()) out += Effect.Speak(text, thenListen)
    }

    private fun onIgnition(new: Ignition, out: MutableList<Effect>) {
        val previous = ignition
        ignition = new
        when (new) {
            Ignition.OFF, Ignition.LOCK -> suspend(out)
            Ignition.ON -> {
                resume(out)
                // OFF·LOCK·ACC에서 ON이 된 것만 탑승이다(ON → START → ON은 아님).
                // 프로세스가 시작될 때 이미 ON이면 그날 탑승 기록이 없을 때만 한 번 탑승으로 본다.
                val turnedOn = previous == Ignition.OFF || previous == Ignition.LOCK || previous == Ignition.ACC
                val alreadyOn = previous == null && log.lastBoardedOn != today()
                if (turnedOn || alreadyOn) onBoarded(out)
            }
            else -> Unit
        }
    }

    /** 재생 중단 → 포커스 반납 → 상태 저장 → 어댑터 stop()/release() 순서로 Effect를 낸다. 이후 새 말하기는 막는다. */
    private fun suspend(out: MutableList<Effect>) {
        if (suspended) return
        suspended = true
        pending = null
        acceptedRoute = false
        heldBoarding = false
        clearResult(out)
        if (card != null) closeCard(out, instant = true) else out += Effect.StopVoice
        forceSave = true
        enterSuspend = true
    }

    private fun resume(out: MutableList<Effect>) {
        if (!suspended) return
        suspended = false
        out += Effect.ExitSuspend
    }

    /**
     * 탑승 판단. 일정을 받는 중이면 보류하고, 받기가 끝나면 [onSchedulesLoaded]가 이어 간다.
     * 일정 출처가 최신이 아니면 판단 전에 다시 받는다([allowRefresh]가 true일 때 한 번만).
     */
    private fun onBoarded(out: MutableList<Effect>, allowRefresh: Boolean = true) {
        if (suspended || motion() != Motion.STOPPED || pending != null) return
        if (loadingSchedules) {
            heldBoarding = true
            return
        }
        // 질문 카드가 떠 있으면 새 탑승은 무시한다. 일정 안내 카드는 다시 판단한다.
        val notice = card?.isScheduleNotice == true
        if (card != null && !notice) return
        val kind = log.classify(now(), zone)
        if (kind == BoardingKind.QUICK_STOP) return
        if (kind == BoardingKind.AGAIN) return
        if (origin != ScheduleOrigin.FRESH && allowRefresh) {
            loadingSchedules = true
            loadGeneration = AWAITING_GENERATION
            heldBoarding = true
            out += Effect.RefreshSchedules
            return
        }
        // 일정을 못 받았고 사본도 없으면 탑승을 소진하지 않고 안내만 보인다. 안내는 그날 한 번만 한다. 일정이 없는 것과 다르다.
        if (origin == ScheduleOrigin.NONE) {
            if (!notice && noticeSpokenOn != today()) {
                noticeSpokenOn = today()
                showScheduleNotice(out)
            }
            return
        }
        if (notice) closeCard(out, instant = true)

        val target = plan().target()
        val place = target?.place
        if (place == null) {
            decide(kind, null, out)
            return
        }
        val id = ++seq
        pending = PendingBoarding(id, kind, checkNotNull(target).id)
        out += Effect.RequestTravelTime(id, place)
    }

    private fun onSchedulesLoaded(out: MutableList<Effect>) {
        val held = heldBoarding
        heldBoarding = false
        if (held || card?.isScheduleNotice == true) onBoarded(out, allowRefresh = false)
    }

    private fun showScheduleNotice(out: MutableList<Effect>) {
        val view = Phrases.scheduleUnavailableCard()
        resultTimerId = null
        val timerId = ++seq
        card = CardState(view, null, timerId, isScheduleNotice = true)
        out += Effect.ShowCard(view)
        speak(out, Phrases.spoken(view), thenListen = false)
        out += Effect.ScheduleCardTimeout(timerId, Rules.CARD_TIMEOUT)
    }

    private fun onTravelTime(event: Event.TravelTimeResult, out: MutableList<Effect>) {
        val waiting = pending ?: return
        if (waiting.requestId != event.requestId) return
        pending = null
        if (!canSpeak()) return
        // 기다리는 사이 대상 일정이 바뀌었으면 그 소요 시간은 쓰지 않는다.
        val sameTarget = plan().target()?.id == waiting.targetId
        decide(waiting.kind, event.travelTime.takeIf { sameTarget }, out)
    }

    private fun decide(kind: BoardingKind, travelTime: Duration?, out: MutableList<Effect>) {
        val decision = BoardingDecider.decide(
            now(), kind, plan(), planIsFallback = origin == ScheduleOrigin.STORED, travelTime = travelTime, favorites = favorites,
        )
        if (decision !is BoardingDecision.Card) return
        // 탑승은 카드를 실제로 띄울 때 기록한다. 판단 중에 D로 바뀌어 카드가 안 뜨면 그날 첫 탑승을 소진하지 않는다.
        log = log.boarded(now(), zone)
        val question = decision.question
        if (question is Question.DepartLate) statuses = plan().markLate(question.target.id).statuses

        val view = Phrases.card(decision, now(), zone)
        val timerId = ++seq
        val state = CardState(view, question, timerId, voiceOpen = true)
        card = state
        resultTimerId = null
        out += Effect.ShowCard(view(state))
        speak(out, Phrases.spoken(view), thenListen = true)
        out += Effect.ScheduleCardTimeout(timerId, Rules.CARD_TIMEOUT)
    }

    private fun view(state: CardState): CardContent = state.view.copy(notice = state.notice)

    private fun onGear(newGear: Gear, out: MutableList<Effect>) {
        val previous = gear
        gear = newGear
        if (newGear == Gear.DRIVE || newGear == Gear.REVERSE) drivenSincePark = true
        if (newGear == Gear.PARK && previous != Gear.PARK) {
            // 달린 적이 있을 때만 '방금 P단에 넣음'이다. 앱을 켠 순간 이미 P단인 경우는 기록하지 않는다.
            if (drivenSincePark) log = log.parked(now())
            drivenSincePark = false
        }
        enforceDriving(out)
    }

    /**
     * 주행이 되면 먼저 말하지 않는다: 카드를 접고 음성을 멈추고, 진행 중이던 탑승 판단도 버린다.
     * 카드가 없어도 주행이 시작되면 말하던 것을 멈춘다.
     */
    private fun enforceDriving(out: MutableList<Effect>) {
        if (motion() != Motion.DRIVING) {
            drivingHandled = false
            return
        }
        pending = null
        heldBoarding = false
        clearResult(out)
        if (card != null) {
            // 주행 제한으로 접을 때는 애니메이션 없이 바로 접는다.
            closeCard(out, instant = true)
            drivingHandled = true
        } else if (!drivingHandled) {
            drivingHandled = true
            out += Effect.StopVoice
        }
    }

    private fun closeCard(out: MutableList<Effect>, instant: Boolean = false) {
        card = null
        out += Effect.StopVoice
        out += Effect.CollapseCard(instant)
    }

    private fun onButton(primary: Boolean, out: MutableList<Effect>) {
        val state = card ?: return
        if (state.isScheduleNotice) {
            if (!primary) closeCard(out)
            return
        }
        val question = state.question ?: return
        // 수락은 [accept]가 음성을 멈춘다.
        if (!primary) out += Effect.StopVoice
        when {
            primary -> accept(state, out)
            // 출발 제안·늦게 탐의 보조 버튼은 "잠깐만"(보류), 목적지 묻기의 보조 버튼은 "그냥 갈게"(거절)
            question is Question.Depart || question is Question.DepartLate -> hold(state, out)
            else -> reject(out)
        }
    }

    /** 후보 줄 누름. 목적지 묻기 카드의 후보 번호일 때만 그 후보로 길안내한다. */
    private fun onCandidate(index: Int, out: MutableList<Effect>) {
        val state = card ?: return
        val question = state.question as? Question.AskDestination ?: return
        if (index !in question.candidates.indices) return
        accept(state, out, index)
    }

    private fun onHeard(text: String, out: MutableList<Effect>) {
        val state = card ?: return
        if (!state.voiceOpen) return
        state.voiceOpen = false
        val question = state.question
        // 화면에 보인 후보 이름. 순서가 후보 번호다.
        val candidates = (question as? Question.AskDestination)?.let { Phrases.candidateNames(it) }.orEmpty()
        // 수락("응")은 1번 후보(주 버튼)를 고르는 것과 같은 결과다.
        val acceptPick = if (candidates.isNotEmpty()) 0 else null
        when (val intent = IntentMatcher.match(text, candidates, acceptPick)) {
            Intent.Accept ->
                // 후보가 없는 목적지 묻기에서 "응"은 갈 곳을 정하지 못한 말이다.
                if (question is Question.AskDestination && candidates.isEmpty()) unrecognized(state, out) else accept(state, out)
            is Intent.Pick -> if (intent.index in candidates.indices) accept(state, out, intent.index) else unrecognized(state, out)
            Intent.Reject -> reject(out)
            Intent.Hold -> hold(state, out)
            Intent.Alternative -> {
                state.notice = Phrases.NO_ALTERNATIVE
                out += Effect.ShowCard(view(state))
                speak(out, Phrases.NO_ALTERNATIVE, thenListen = false)
            }
            Intent.Unrecognized -> unrecognized(state, out)
            Intent.Chatter, Intent.Silence -> Unit
        }
    }

    private fun unrecognized(state: CardState, out: MutableList<Effect>) {
        if (state.reprompts < Rules.MAX_REPROMPTS) {
            state.reprompts++
            state.voiceOpen = true
            speak(out, Phrases.ASK_AGAIN, thenListen = true)
        } else {
            state.notice = Phrases.USE_SCREEN
            out += Effect.ShowCard(view(state))
            speak(out, Phrases.USE_SCREEN, thenListen = false)
        }
    }

    /** 보류: 카드를 둔 채 30초를 다시 센다. 말하던 것과 듣기는 멈춘다. */
    private fun hold(state: CardState, out: MutableList<Effect>) {
        state.voiceOpen = false
        state.timerId = ++seq
        out += Effect.ScheduleCardTimeout(state.timerId, Rules.CARD_TIMEOUT)
    }

    private fun reject(out: MutableList<Effect>) {
        card = null
        out += Effect.CollapseCard()
    }

    /** 수락. 목적지 묻기는 [pick]번 후보로(주 버튼·"응"은 0번), 출발 제안·늦게 탐은 대상 일정 장소로 길안내한다. */
    private fun accept(state: CardState, out: MutableList<Effect>, pick: Int = 0) {
        val place = when (val question = state.question) {
            is Question.Depart -> question.target.place
            is Question.DepartLate -> question.target.place
            is Question.AskDestination -> question.candidates.getOrNull(pick)
            null -> null
        }
        card = null
        out += Effect.StopVoice
        out += Effect.CollapseCard()
        if (place == null) return
        acceptedRoute = true
        out += Effect.StartRoute(place)
    }

    /** 길안내 요청 결과를 알린다. 정차 중일 때만 결과 한 줄을 보이고 말하며, 한 줄은 [Rules.RESULT_VISIBLE] 뒤 지운다. */
    private fun onRouteResult(ok: Boolean, out: MutableList<Effect>) {
        if (!acceptedRoute) return
        acceptedRoute = false
        if (!canSpeak()) return
        val text = if (ok) Phrases.ROUTE_STARTED else Phrases.ROUTE_FAILED
        val timerId = ++seq
        resultTimerId = timerId
        out += Effect.ShowResult(text)
        out += Effect.ScheduleResultTimeout(timerId, Rules.RESULT_VISIBLE)
        speak(out, text, thenListen = false)
    }

    /** 보이던 결과 한 줄을 지운다. 보이는 것이 없으면 아무것도 내지 않는다. */
    private fun clearResult(out: MutableList<Effect>) {
        if (resultTimerId == null) return
        resultTimerId = null
        out += Effect.ShowResult("")
    }

    private fun onReset(out: MutableList<Effect>) {
        log = BoardingLog()
        statuses = emptyMap()
        statusDate = today()
        pending = null
        acceptedRoute = false
        heldBoarding = false
        noticeSpokenOn = null
        drivenSincePark = false
        if (card != null) closeCard(out, instant = true) else out += Effect.StopVoice
        resultTimerId = null
        out += Effect.ShowResult("")
    }

    /** 저장은 매 이벤트 끝에 바뀐 것만 내보낸다. Suspend 진입 때는 바뀌지 않았어도 저장한다. */
    private fun flush(out: MutableList<Effect>) {
        val snap = snapshot()
        if (snap != lastSaved || forceSave) {
            forceSave = false
            lastSaved = snap
            out += Effect.Save(snap)
        }
    }

    private companion object {
        const val AWAITING_GENERATION = -1
    }
}
