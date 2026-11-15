package com.chagok.car.flow

import com.chagok.car.domain.AskReason
import com.chagok.car.domain.BoardingDecider
import com.chagok.car.domain.BoardingDecision
import com.chagok.car.domain.BoardingKind
import com.chagok.car.domain.BoardingLog
import com.chagok.car.domain.Briefing
import com.chagok.car.domain.DayPlan
import com.chagok.car.domain.DestinationOption
import com.chagok.car.domain.EnergyKind
import com.chagok.car.domain.EnergyNeed
import com.chagok.car.domain.EnergyOptions
import com.chagok.car.domain.EnergyRequest
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.Gear
import com.chagok.car.domain.HomePickup
import com.chagok.car.domain.Ignition
import com.chagok.car.domain.Intent
import com.chagok.car.domain.IntentMatcher
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Motion
import com.chagok.car.domain.PendingReask
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

    /**
     * 대상 일정이 끝나는 시각이 됐다. 주행 중 이벤트 없이 시간만 흘러도 칩이 건너뜀을 반영하고 다음 일정으로 바뀌게 한다.
     * [timerId]가 지금 예약된 것이 아니면(칩이 바뀌거나 숨겨져 낡은 타이머) 무시한다.
     */
    data class ChipRecheck(val timerId: Int) : Event

    /**
     * 기기 시각·시간대가 바뀌었거나(데모 시계 포함) 시계가 건너뛰었다. 예약해 둔 칩 재판단 시각이 낡았으므로 다시 판단·예약하게 한다.
     * 이 이벤트만으로 탑승 판단 등 다른 동작은 일어나지 않는다.
     */
    data object ClockChanged : Event

    /**
     * 앱 화면이 앞에 있는가(어댑터가 액티비티 resume·pause로 알린다). 기본은 앞에 있음이다.
     * P단에서 다시 묻기는 말하고 마이크를 여는 동작이라 앞에 있을 때만 하고, 뒤에 있으면 기회를 쓰지 않고 남겨 둔다(`docs/reask.md`).
     */
    data class ForegroundChanged(val foreground: Boolean) : Event

    /**
     * 카드를 말하려 했지만 말하지 못했다(오디오 포커스를 얻지 못함 등). 다시 묻는 카드가 말을 못 했으면 그 '한 번'의 기회를 쓴 것으로 치지 않는다.
     */
    data object SpeechUnavailable : Event

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

    /**
     * 차의 위치. 위치 어댑터가 읽은 값이거나 내비가 [Effect.RequestLocation]에 답한 값이거나 디버그로 넣은 값이다.
     * [ageMillis]는 이 이벤트를 만든 시점에 측위한 지 얼마나 됐는가(밀리초, 어댑터가 `Location.elapsedRealtimeNanos`로 잰다. 내비 답·debug 주입은 방금 측위한 것이라 0).
     * 세션은 이벤트를 처리하는 자기 시계(데모 시계)의 '지금'에서 [ageMillis]를 뺀 값을 측위 시각으로 삼는다. 두 시계를 섞어 비교하지 않으려고 시각이 아니라 나이를 싣는다.
     * 달린 뒤 P단에서 일정 장소 도착·집 하차를 판정할 때 쓰고, 이번 주행(D·R) 시작 뒤에 측위했고 [Rules.LOCATION_MAX_AGE] 이내인 것만 쓴다.
     * 권한이 없거나 못 읽으면 이 이벤트가 오지 않아 위치 판정만 빠진다.
     *
     * [naviAnswer]는 내비가 [Effect.RequestLocation]에 답한 것이다. 이 답은 P단에서 위치를 물어 기다리는 동안([DriveSession]의 awaitingParkLocation)에만 쓰고,
     * 기다리지 않을 때(주행 중·이미 판정했거나 묻지 않음) 늦게 온 답은 위치로 기록하지 않는다. 어댑터가 읽은 값·debug 주입은 false다.
     */
    data class LocationChanged(val position: LatLng, val ageMillis: Long = 0, val naviAnswer: Boolean = false) : Event

    /**
     * 내비에 현재 위치를 물은 지 [Rules.LOCATION_ANSWER_TIMEOUT]이 지났다. 아직 답이 없으면 어댑터가 읽어 둔 오래된(최대 [Rules.LOCATION_MAX_AGE]) 위치로 판정한다.
     * [timerId]가 지금 기다리는 것이 아니면 무시한다.
     */
    data class LocationTimedOut(val timerId: Int) : Event

    /** 내비가 목적지 도착을 알렸다. 차곡이 길안내를 시작한 일정이 있으면 그 일정을 도착으로 본다. */
    data object DestinationArrived : Event

    /** 일정 받기([generation]세대)가 시작됐다. 끝날 때까지 탑승 판단은 보류한다. */
    data class ScheduleLoading(val generation: Int) : Event

    /** [generation]세대의 일정 받기가 끝났다(성공·실패 모두). 마지막으로 시작한 세대일 때만 보류한 탑승 판단을 이어 간다. */
    data class ScheduleLoaded(val generation: Int) : Event

    /**
     * 차가 알려 준 연료 종류와 주행 가능 거리(km). 어댑터가 읽은 값(debug 주입 값으로 덮은 것 포함)이고, 모르는 쪽은 null이다.
     * 둘 다 알아야 에너지 체크를 한다. 새 값이 와서 모자라지 않게 됐으면(충전한 뒤 등) 그날 이미 물었다는 표시를 푼다.
     */
    data class EnergyChanged(val kind: EnergyKind?, val rangeKm: Double?) : Event

    /**
     * [Effect.RequestEnergyOptions]의 답. 서버가 실패했거나 제한 시간 안에 못 받았거나 429면 null(타임아웃은 요청을 실행한 쪽이 건다).
     * 후보가 하나도 없는 응답은 빈 [EnergyOptions]다.
     */
    data class EnergyOptionsResult(val requestId: Int, val options: EnergyOptions?) : Event

    /** 휴대폰과 연결하기 전에 서버가 낸 연결 코드. 연결 카드에 [qr]과 숫자 [code]를 보인다. 새 코드가 오면 카드를 바꾼다. */
    data class PairingCodeIssued(val code: String, val qr: String) : Event

    /**
     * 휴대폰과 연결됐다. [brief]가 true(폰이 QR·번호를 보내 연결됨)면 연결 카드를 접고 일정을 새로 받아 탑승으로 브리핑한다.
     * 디버그로 미리 연결해 둘 때는 false라 아무것도 말하지 않는다.
     */
    data class Paired(val brief: Boolean) : Event

    /** 연결이 풀렸다(데모 초기화). 새 코드가 오면 다시 연결 카드를 보인다. */
    data object Unpaired : Event
}

/** 저장할 상태. 어댑터가 SharedPreferences에 둔다. */
data class Snapshot(
    val log: BoardingLog,
    val statuses: Map<String, ScheduleStatus>,
    /** statuses가 속한 날짜. 날짜가 바뀌면 끝난 일정의 상태는 비운다(끝나지 않은 일정은 남김). */
    val date: LocalDate,
    /**
     * 도착이 기록됐지만 아직 하차 카드를 못 보인 일정 ID(P단에 넣으면 카드를 보이고 지운다). 프로세스가 다시 떠도 이어지게 저장한다.
     * 이전 저장분에는 없어 null.
     */
    val exitTargetId: String? = null,
    /** [exitTargetId]의 도착을 기록한 시각. [Rules.EXIT_PENDING_MAX]가 지나면 대기를 버린다. 없으면 만료된 것으로 본다. */
    val exitArrivedAt: Instant? = null,
    /** 오늘 집 하차 카드로 이미 알린 픽업 일정 ID. 같은 물건을 집에 다시 들를 때마다 되풀이하지 않는다. [date]가 바뀌면 비운다(이전 저장분에는 없어 빈 집합). */
    val homeItemsAnnounced: Set<String> = emptySet(),
    /** 오늘 집 하차 카드를 한 번이라도 보였는가('오늘도 수고했어요.'를 하루에 한 번만 하려고). [date]가 바뀌면 지운다. */
    val homeCardShown: Boolean = false,
    /** [exitTargetId]가 위치로 정한 하차 대기인가(D·R이 되면 지운다). 이전 저장분에는 없어 false. */
    val exitByLocation: Boolean = false,
    /**
     * 30초 동안 대답이 없어 접힌 질문 하나. 다음 정차(달린 뒤 넣은 P단) 또는 다음 탑승 판단 때 한 번만 다시 묻는다(`docs/reask.md`).
     * 프로세스가 다시 떠도 이어지게 저장한다. 이전 저장분에는 없어 null.
     */
    val reask: PendingReask? = null,
    /**
     * 오늘 에너지 제안 카드를 이미 띄웠는가(하루 한 번: 거절·무시·수락 모두 그날 다시 묻지 않는다). [date]가 바뀌거나 주행 가능 거리가 다시 넉넉해지면 지운다.
     * 이전 저장분에는 없어 false.
     */
    val energyOffered: Boolean = false,
)

/** 세션이 내보내는 출력. 어댑터는 이것을 실행하기만 한다. */
sealed interface Effect {
    data class ShowCard(val card: CardContent) : Effect

    /** [instant]면 애니메이션 없이 바로 접는다(주행 제한·시동 끔·교체). 아니면 퇴장 애니메이션 400ms. */
    data class CollapseCard(val instant: Boolean = false) : Effect


    /** 카드를 접은 뒤에도 남기는 결과 한 줄. 빈 문자열이면 지운다. */
    data class ShowResult(val text: String) : Effect

    /**
     * 주행 중 다음 일정 칩의 본문("13:00 육전집 점심"). 빈 문자열이면 숨긴다.
     * 칩 내용이 바뀔 때만 낸다. 표시 전용이라 말·소리가 없다.
     */
    data class ShowNextChip(val text: String) : Effect

    /**
     * [delay] 뒤에 [Event.ChipRecheck]을 넣는다. 칩이 보이는 동안 대상 일정이 끝나는 시각에 맞춘다.
     * 칩이 바뀌어 시각이 달라지거나 숨겨지면 이전 [timerId]는 무시된다.
     */
    data class ScheduleChipRecheck(val timerId: Int, val delay: Duration) : Effect

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

    /**
     * [place]로 길안내를 요청한다. [via]가 있으면 그곳(충전소·주유소)을 경유지로 넣는다. 실행한 쪽은 요청을 보냈는지를 [Event.RouteRequestResult]로 알린다.
     */
    data class StartRoute(val place: Place, val via: Place? = null) : Effect

    /** 충전·주유 후보를 서버에 묻는다. 실행한 쪽은 답(또는 실패)을 [Event.EnergyOptionsResult]로 같은 [requestId]로 넣는다. 카드는 그 답까지 뜨지 않는다. */
    data class RequestEnergyOptions(val requestId: Int, val request: EnergyRequest) : Effect

    /**
     * 에너지 판단 결과(로그용, 실행할 일은 없다). 출발 제안을 낼 때 연료 종류와 주행 가능 거리를 둘 다 알면 한 번 낸다.
     * [neededKm]는 필요 거리, [rangeKm]는 주행 가능 거리, [short]는 필요 거리가 주행 가능 거리의 [Rules.ENERGY_MARGIN]을 넘는가.
     */
    data class EnergyJudged(val neededKm: Double, val rangeKm: Double, val short: Boolean) : Effect

    /** 현재 위치를 한 번 묻는다(P단 도착 판단). 실행한 쪽은 답을 [Event.LocationChanged]로 넣는다. 답이 없으면 넣지 않는다. */
    data object RequestLocation : Effect

    /** [delay] 뒤에 [Event.LocationTimedOut]을 넣는다. 위치를 물은 뒤 내비가 답하지 않을 때 어댑터의 오래된 위치로 넘어가려는 타이머다. */
    data class ScheduleLocationTimeout(val timerId: Int, val delay: Duration) : Effect
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
    /** 휴대폰과 연결돼 있는가. 연결 전에는 탑승해도 브리핑하지 않고 연결 카드(QR·숫자)만 보인다. */
    paired: Boolean = true,
    /** 하차 카드를 띄워 두는 시간. 기본은 [Rules.EXIT_CARD]이고 debug E2E만 늘려 쓴다(release는 항상 기본). */
    private val exitCardTimeout: () -> Duration = { Rules.EXIT_CARD },
    /** 앱 화면이 앞에 있는가의 처음 값. 앱이 뒤에서 시작되는 호스트는 false로 시작하고 [Event.ForegroundChanged]로 알린다. */
    foreground: Boolean = true,
) {
    private val zone get() = clock.zone

    private var log = restored?.log ?: BoardingLog()
    private var statuses: Map<String, ScheduleStatus> = emptyMap()
    private var statusDate: LocalDate = today()
    private var lastSaved: Snapshot? = null

    /** 마지막으로 내보낸 다음 일정 칩 본문. 빈 문자열은 숨김. */
    private var shownChip = ""

    /** 예약해 둔 칩 재판단 타이머. 칩이 숨겨지면 null이라 낡은 타이머 이벤트는 무시된다. */
    private var chipTimerId: Int? = null

    /** [chipTimerId]가 맞춘 시각(대상 일정 끝). 같은 시각이면 다시 예약하지 않는다. */
    private var chipDeadline: Instant? = null

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

    /** 차곡이 길안내를 시작한 일정. 내비 도착 알림이 오면 이 일정을 도착으로 본다. 자주 가는 곳으로 간 길안내는 null */
    private var routeScheduleId: String? = null

    /** 마지막으로 안 위치와 그 측위 시각(세션 시계 기준). 주행(D·R)을 시작하면 지난 위치라 버린다. 판정에는 [usableLocation]으로만 읽는다. */
    private var lastPosition: LatLng? = null
    private var lastPositionAt: Instant? = null

    /** 이번 주행(마지막 P단 뒤 처음 D·R이 된 시각). 이보다 먼저 측위한 위치(출발 전 위치)는 판정에 쓰지 않는다. */
    private var driveStartedAt: Instant? = null

    /** 마지막 집 판정(집 P단) 또는 앱 시작 뒤에 집 반경 밖 위치를 한 번이라도 받았는가. 집 하차는 집을 떠났다 돌아온 경우에만 한다. */
    private var leftHome = false

    /** P단에 넣으며 위치를 물었고 아직 답을 받지 않았다. 답이 오면 도착을 판단한다. */
    private var awaitingParkLocation = false

    /** 기다리는 판정이 집 하차를 해도 되는가(내비 도착 대기가 있던 P단은 집 하차를 하지 않는다). */
    private var awaitingHome = false

    /** 위치 답을 기다리는 타이머. 답이 오거나 기다림이 끝나면 null이라 늦게 온 타이머 이벤트는 무시된다. */
    private var locationTimerId: Int? = null

    /** 지금 위치를 쓸 일이 있는가(집 좌표가 있거나 오늘 남은 일정 중 장소가 있는 것이 있음). 없으면 호스트는 위치 갱신을 켜지 않는다. */
    var needsLocation: Boolean = false
        private set

    /**
     * 도착이 기록됐고 하차 카드를 아직 보이지 않은 일정 ID(4장: 도착 뒤 실제로 달린 다음 P단에서 말한다. 단 주행 중 내비 도착은 그 순간 바로 보이고 대기를 지운다).
     * 카드를 보이거나 버리거나, 새 길안내를 수락하거나, 초기화·날짜 변경·시동 끔·연결 해제·실제 탑승 판단이 시작되면 지운다.
     */
    private var exitTargetId: String? = restored?.exitTargetId
    private var exitArrivedAt: Instant? = restored?.exitArrivedAt

    /**
     * 집 하차 카드를 기다리는 중인가. 집 반경 안의 P단으로 정해졌지만 주행 제한 등으로 아직 못 보인 경우에만 true다
     * ([exitTargetId]와 달리 저장하지 않는다: 판정과 표시가 거의 같은 순간이라 프로세스가 다시 뜨면 버린다). 만료는 [exitArrivedAt]으로 함께 센다.
     */
    private var exitHome = false

    /** 지금 대기 중인 하차 대기를 위치로 정했는가. D·R이 되면 이 대기는 지운다(내비 도착 대기는 그대로 다음 P단을 기다린다). */
    private var exitByLocation = restored?.exitByLocation ?: false

    /** 오늘 집 하차 카드로 이미 알린 픽업 일정과 인사 여부. 날짜가 바뀌면 비운다. */
    private var homeItemsAnnounced: Set<String> = restored?.homeItemsAnnounced.orEmpty()
    private var homeCardShown: Boolean = restored?.homeCardShown ?: false

    /**
     * 지금 P단에서 하차 카드를 이미 보였는가(닫힌 뒤라도). 한 P단에 하차 카드는 하나라서, 그 뒤에 온 위치 답·타임아웃·내비의 도착은 기록만 한다.
     * 다시 달리기 시작하거나(D·R) 해제·초기화 때 false로 돌아간다.
     */
    private var exitCardShownThisPark = false

    /** 마지막으로 P단이 된 것이 달린 뒤였는가. 이미 P단일 때 도착이 기록되면 이것이 true일 때만 바로 하차 카드를 띄운다. */
    private var lastParkWasRun = false

    /**
     * 다시 물을 질문(무응답·보류 뒤 30초가 지나 접힌 질문 하나). 다음 정차 때 한 번만 묻고 지운다.
     * 날짜 변경·초기화·연결 해제·그 질문의 대상 일정이 도착·건너뜀이 되거나 새 길안내를 수락하면 지운다.
     */
    private var reask: PendingReask? = restored?.reask

    /**
     * 방금 달린 뒤 P단에 넣었고 다시 물을 질문이 있어 그 P단에서 다시 물을 기회를 보는 중인가.
     * 위치로 도착을 판단하는 동안은 기다리고(도착 하차 카드가 먼저), 판단이 끝나면 [settleReaskAtPark]가 한 번 물어본다. D·R이 되거나 P단을 벗어나면 접는다.
     */
    private var reaskAtPark = false

    /** 일정을 받는 중에 보류한 탑승 판단이 P단에서 다시 묻는 것이었는가(받기가 끝나 이어 갈 때 잠깐 정차 규칙을 건너뛰어야 한다). */
    private var heldReaskNow = false

    /** 차가 알려 준 연료 종류와 주행 가능 거리(km). 하나라도 모르면(null) 에너지 체크를 하지 않는다. */
    private var energyKind: EnergyKind? = null
    private var rangeKm: Double? = null

    /**
     * 오늘 에너지 제안 카드를 이미 띄웠는가(하루 한 번). 거절·무시·수락 모두 그날 다시 묻지 않는다. 날짜 변경·초기화·연결 해제나
     * 주행 가능 거리가 다시 넉넉해지면([Event.EnergyChanged]·탑승 판단) 지운다. 저장한다.
     */
    private var energyOffered: Boolean = restored?.energyOffered ?: false

    /** 방금 수락한 에너지 제안의 경유지. 길안내 결과 한 줄 "{이름} 들렀다 갈게요."에 쓴다. */
    private var acceptedVia: Place? = null

    private var paired = paired

    /** 앱 화면이 앞에 있는가. 다시 묻기(말하기·듣기)는 앞에 있을 때만 한다. */
    private var foreground = foreground

    /** 연결 전 마지막으로 받은 연결 코드. 연결되면 버린다. */
    private var pairingCode: Event.PairingCodeIssued? = null
    private var seq = 0

    /** 결과 한 줄을 보이고 있으면 그 타이머 ID, 아니면 null */
    private var resultTimerId: Int? = null

    /** [forced]는 일정 겹침에서 사용자가 고른 일정으로 이어 가는 판단이다(겹침을 다시 묻지 않는다). */
    /**
     * [atPark]는 달린 뒤 P단에서 접힌 질문을 다시 묻는 판단이다([settleReaskAtPark]). 탑승이 아니라서 탑승 기록과 그 부작용을 남기지 않는다.
     */
    private class PendingBoarding(
        val requestId: Int,
        val kind: BoardingKind,
        val targetId: String,
        val reasking: Boolean,
        val forced: Boolean = false,
        val atPark: Boolean = false,
        /** 에너지 후보 답을 기다리는 중이면 그 사정. 이때 [requestId]는 소요 시간이 아니라 [Effect.RequestEnergyOptions]의 번호다. */
        val energy: EnergyWait? = null,
    )

    /** 출발 제안을 에너지 제안으로 바꾸려 서버 답을 기다리는 동안 들고 있는 것: 앞서 구한 소요 시간과 겹침에서 고른 일정. 답이 오면 이 값으로 판단을 다시 한다. */
    private class EnergyWait(val travelTime: Duration?, val forcedId: String?)

    /** [Event.EnergyOptionsResult]의 답. [options]가 null이면 실패. */
    private class EnergyAnswer(val options: EnergyOptions?)

    private sealed interface EnergyStep {
        /** 에너지를 따지지 않거나 넉넉하거나 그날 이미 물었다: 출발 제안 그대로. */
        data object Plain : EnergyStep

        /** 모자라다: 서버에 후보를 묻는다. */
        data class Ask(val request: EnergyRequest, val targetId: String) : EnergyStep

        /** 모자라다: 출발 제안을 이 질문으로 바꾼다(에너지 제안 또는 한 문장만 붙인 출발 제안). */
        data class Replace(val question: Question) : EnergyStep
    }

    private class CardState(
        var view: CardContent,
        /** 질문 카드의 질문. 질문이 없는 카드(하차·연결)는 null. 대안("다른 데")으로 후보를 바꾸면 다음 후보 하나만 보이는 같은 질문으로 바뀐다. */
        var question: Question?,
        var timerId: Int,
        /** 듣기가 열려 있는가. 질문 카드가 말을 마치면 듣고, 결과를 받으면 닫는다(다시 물을 때만 다시 연다). */
        var voiceOpen: Boolean = false,
        var reprompts: Int = 0,
        /** 알아듣지 못함·대안 없음 같은 안내 한 줄 */
        var notice: String? = null,
        /** 휴대폰 연결 카드인가. 시간이 지나도 접지 않고 연결되면 접는다. */
        val isPairing: Boolean = false,
        /** 하차 카드인가. 질문이 없고 [챙겼어요] 또는 [Rules.EXIT_CARD] 뒤 닫힌다. */
        val isExit: Boolean = false,
        /**
         * 주행 중 내비 도착 순간에 띄운 하차 카드인가(사용자 결정 2026-11-15, 주행 중 카드 금지의 유일한 예외).
         * 이 카드는 주행 제한 알림이 다시 와도 [enforceDriving]이 접지 않고 [Rules.EXIT_CARD] 뒤 또는 [챙겼어요]로만 닫힌다.
         */
        val drivingExit: Boolean = false,
        /** 이 카드의 질문을 판단한 브리핑. 대안으로 카드를 다시 만들 때 쓴다. */
        val briefing: Briefing? = null,
        /** 접힌 질문을 다시 묻는 카드인가. 이 카드가 또 무응답으로 접혀도 다시 묻지 않는다(한 번만). */
        val isReask: Boolean = false,
        /** 이 카드를 만든 탑승 판단의 종류. 일정 겹침에서 고른 뒤 같은 종류(첫 탑승·재탑승)로 이어 가려고 둔다. */
        val kind: BoardingKind? = null,
        /** 일정 겹침에서 일정을 골라 그 일정의 소요 시간을 기다리는 중인가. 그동안 버튼·음성·후보 누름·30초 접힘은 무시한다. */
        var resolving: Boolean = false,
        /** 달린 뒤 P단 다시 묻기로 띄운 카드인가(탑승이 아님). 겹침에서 고른 뒤의 카드도 이어받아 탑승 기록을 남기지 않는다. */
        val parkReask: Boolean = false,
        /** 이 카드를 말하지 못했는가(오디오 포커스를 못 얻음). 다시 묻는 카드가 이 상태로 접히면 '한 번'의 기회를 쓴 것으로 치지 않고 다시 남긴다. */
        var speechFailed: Boolean = false,
    )

    init {
        if (restored != null && restored.date == statusDate) statuses = restored.statuses
        // 저장분의 날짜가 오늘이 아니면(어제 저장 뒤 자정을 넘겨 다시 뜸) 하차 대기도 지난 날의 것이라 버린다.
        if (restored != null && restored.date != statusDate) {
            clearExit()
            reask = null
            homeItemsAnnounced = emptySet()
            homeCardShown = false
            energyOffered = false
        }
        lastSaved = snapshot()
    }

    private fun today(): LocalDate = clock.instant().atZone(zone).toLocalDate()
    private fun now(): Instant = clock.instant()
    private fun motion() = Motion.of(gear, restricted)

    /** 지금 주행 중인가(기어 D·R 또는 주행 제한). 기어를 모르면 false. */
    val isDriving: Boolean get() = motion() == Motion.DRIVING
    private fun plan() = DayPlan(schedules, statuses)
    private fun snapshot() =
        Snapshot(log, statuses, statusDate, exitTargetId, exitArrivedAt, homeItemsAnnounced, homeCardShown, exitByLocation, reask, energyOffered)

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
            pruneReask()
        }
        // 도착 뒤 오래 지난 하차 대기는 버린다(도착 알림 뒤 다른 곳에서 한참 있다 P단에 넣어도 하차가 아니다).
        if (exitTargetId != null || exitHome) {
            val arrivedAt = exitArrivedAt
            // 시계가 뒤로 가 도착 시각이 지금보다 미래가 돼도 만료로 본다(BoardingLog.classify의 잠깐 정차 판정과 같은 취지).
            if (arrivedAt == null || arrivedAt.isAfter(now()) || Duration.between(arrivedAt, now()) > Rules.EXIT_PENDING_MAX) clearExit()
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
                // 주행 제한이 풀려 P단에서 정차로 돌아오면 미뤄 둔 하차 카드를 보인다.
                if (gear == Gear.PARK) showExitCard(out)
            }
            is Event.TravelTimeResult -> onTravelTime(event, out)
            is Event.EnergyChanged -> onEnergyChanged(event)
            is Event.EnergyOptionsResult -> onEnergyOptions(event, out)
            is Event.RouteRequestResult -> onRouteResult(event.ok, out)
            // 건너뜀은 위에서 이미 반영했다. 타이머가 조금 일찍 와도 다시 예약되게 맞춘 시각을 비운다.
            is Event.ChipRecheck -> if (chipTimerId == event.timerId) chipDeadline = null
            // 시계가 건너뛰었으니 예약해 둔 시각이 낡았다. flush의 syncChip이 다시 판단·예약한다.
            Event.ClockChanged -> chipDeadline = null
            is Event.ResultTimedOut -> if (resultTimerId == event.timerId) clearResult(out)
            is Event.ForegroundChanged -> foreground = event.foreground
            Event.SpeechUnavailable -> card?.takeIf { it.isReask && it.question != null }?.speechFailed = true
            is Event.Heard -> onHeard(event.text, out)
            Event.PrimaryPressed -> onButton(primary = true, out)
            Event.SecondaryPressed -> onButton(primary = false, out)
            is Event.CandidatePressed -> onCandidate(event.index, out)
            is Event.CardTimedOut -> card?.takeIf { it.timerId == event.timerId }?.let { state ->
                keepForReask(state)
                closeCard(out)
            }
            Event.Reset -> onReset(out)
            is Event.LocationChanged -> onLocation(event, out)
            is Event.LocationTimedOut -> onLocationTimeout(event.timerId, out)
            Event.DestinationArrived -> onDestinationArrived(out)
            is Event.ScheduleLoading, is Event.ScheduleLoaded -> if (loadedNow) onSchedulesLoaded(out)
            is Event.PairingCodeIssued -> onPairingCode(event, out)
            is Event.Paired -> onPaired(event.brief, out)
            Event.Unpaired -> onUnpaired(out)
        }
        settleReaskAtPark(out)
        // 연결 전에는 정차 중이면 늘 연결 카드를 둔다(초기화·주행 뒤 정차에도 다시 보인다).
        if (!paired) showPairingCard(out)
        needsLocation = computeNeedsLocation()
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
        // 지난 날의 하차 카드는 보이지 않고, 집 하차 알림 기록도 새 날부터 다시 센다. 접힌 질문도 지난 날의 것이라 다시 묻지 않는다.
        clearExit()
        reask = null
        homeItemsAnnounced = emptySet()
        homeCardShown = false
        energyOffered = false
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
        acceptedVia = null
        heldBoarding = false
        reaskAtPark = false
        // 위치 답을 기다리던 중이면 그만둔다(어댑터·내비도 멈추므로 답이 와도 쓰지 않는다).
        stopAwaitingLocation()
        // 시동을 끄면 내릴 때가 된 것이라 아직 못 보인 하차 카드는 접는다.
        clearExit()
        lastParkWasRun = false
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

    /** 탑승 판단의 대상 일정(5장 '대상 일정 고르기', [DayPlan.boardingTarget]). 위치는 [hereForBoarding]. */
    private fun boardingTarget(): Schedule? = plan().boardingTarget(now(), hereForBoarding())

    /**
     * 탑승 판단에 쓰는 지금 차 위치: 측위한 지 [Rules.LOCATION_MAX_AGE] 이내인 마지막 위치. 믿을 만한 최근 위치가 없으면 null이라 '이미 그곳'·'집이면 집 빼기' 판정은 건너뛴다.
     * 달린 적이 있으면([driveStartedAt]) 그 주행을 시작하기 전에 측위한 위치는 쓰지 않는다(도착 판정 [usableLocation]과 같은 규칙).
     * 달리기 시작할 때 지난 위치를 버리지만([onGear]), P단에 넣는 순간 시스템의 마지막 위치를 읽어 넣으면 출발 전에 측위한 낡은 위치가 들어올 수 있어서다.
     * 달린 적이 없는 탑승(시동 ON·앱 진입)은 이 조건이 없다.
     */
    private fun hereForBoarding(): LatLng? {
        val at = lastPositionAt ?: return null
        driveStartedAt?.let { if (at.isBefore(it)) return null }
        val age = Duration.between(at, now())
        return if (age.isNegative || age > Rules.LOCATION_MAX_AGE) null else lastPosition
    }

    /**
     * 탑승 판단. 일정을 받는 중이면 보류하고, 받기가 끝나면 [onSchedulesLoaded]가 이어 간다.
     * 일정 출처가 최신이 아니면 판단 전에 다시 받는다([allowRefresh]가 true일 때 한 번만).
     * [reaskNow]는 달린 뒤 P단에서 접힌 질문을 다시 묻는 것이다([settleReaskAtPark]): 방금 P단에 넣은 것이라 잠깐 정차 규칙을 건너뛰고 재탑승 한 줄로 판단한다.
     * 다시 물을 질문이 있을 때의 탑승 판단(다음 탑승)도 그 질문을 다시 묻는 것으로 치고, 카드를 띄울 때 지운다.
     */
    private fun onBoarded(out: MutableList<Effect>, allowRefresh: Boolean = true, reaskNow: Boolean = false) {
        if (suspended || motion() != Motion.STOPPED || pending != null) return
        if (reaskNow && reask == null) return
        // P단 다시 묻기는 앱이 앞에 있을 때만 한다(말하고 마이크를 여는 동작). 뒤에 있으면 기회를 쓰지 않고 앞에 올 때까지 남긴다.
        if (reaskNow && !foreground) {
            reaskAtPark = gear == Gear.PARK
            return
        }
        // 연결 전에는 탑승을 소진하지 않고 연결 카드만 보인다. 연결되면 [onPaired]가 탑승으로 이어 간다.
        if (!paired) {
            showPairingCard(out)
            return
        }
        if (loadingSchedules) {
            heldBoarding = true
            heldReaskNow = reaskNow
            return
        }
        val kind = if (reaskNow) BoardingKind.AGAIN else log.classify(now(), zone)
        // 질문 카드가 떠 있으면 새 탑승은 무시한다.
        // 하차 카드가 떠 있을 때의 탑승 신호는 5장 '잠깐 정차'를 따른다: 방금 P단에 넣은 뒤 10분 안이면 탑승이 아니라 카드를 그대로 둔다.
        // 10분이 지난 진짜 탑승이면(도착 알림이 이미 정차 중에 와서 P단 기록이 오래된 경우 등) 이미 내릴 때가 지난 카드라 접고 탑승 판단을 이어 간다.
        val exiting = card?.isExit == true
        if (card != null && !exiting) return
        if (kind == BoardingKind.QUICK_STOP) return
        // 진짜 탑승이 시작되면 못 보인 하차 카드는 더 보이지 않고, 그 P단은 더 '방금 달려 와 댄 P단'이 아니다.
        // P단 다시 묻기는 탑승이 아니라서 이 정리를 하지 않는다(같은 P단의 내비 도착은 계속 하차 카드로 이어진다).
        if (!reaskNow) {
            clearExit()
            lastParkWasRun = false
        }
        if (exiting) closeCard(out, instant = true)
        if (origin != ScheduleOrigin.FRESH && allowRefresh) {
            loadingSchedules = true
            loadGeneration = AWAITING_GENERATION
            heldBoarding = true
            heldReaskNow = reaskNow
            out += Effect.RefreshSchedules
            return
        }
        // 일정을 못 받았고 사본도 없으면(origin NONE) 일정 없음으로 본다: 일정 목록이 비어 있어 "어디로 갈까요?"를 묻는다(5장 4번). 사본이 있을 때만 "일정을 새로 못 받음" 한 줄이 붙는다.
        val reasking = reaskNow || reask != null
        // 일정 겹침이면 어느 일정으로 갈지부터 묻는다. 소요 시간은 고른 일정으로 정해진 뒤([chooseOverlap]) 묻는다.
        if (BoardingDecider.findOverlap(plan().boardingCandidates(now(), hereForBoarding())) != null) {
            decide(kind, null, out, reasking, atPark = reaskNow)
            return
        }
        val target = boardingTarget()
        val place = target?.place
        if (place == null) {
            decide(kind, null, out, reasking, atPark = reaskNow)
            return
        }
        val id = ++seq
        pending = PendingBoarding(id, kind, checkNotNull(target).id, reasking, atPark = reaskNow)
        out += Effect.RequestTravelTime(id, place)
    }

    /** 연결 카드를 보이거나 새 코드로 바꾼다. 정차 중에만, 코드를 받은 뒤에만 보인다. 말하지 않고 시간이 지나도 접지 않는다. */
    private fun showPairingCard(out: MutableList<Effect>) {
        val code = pairingCode ?: return
        if (suspended || motion() != Motion.STOPPED) return
        val current = card
        if (current != null && !current.isPairing) return
        val view = Phrases.pairingCard(code.code, code.qr)
        if (current?.view == view) return
        card = CardState(view, null, ++seq, isPairing = true)
        out += Effect.ShowCard(view)
    }

    private fun onPairingCode(event: Event.PairingCodeIssued, out: MutableList<Effect>) {
        if (paired) return
        pairingCode = event
        showPairingCard(out)
    }

    /**
     * 연결됐다. 연결 카드를 접고, 폰이 방금 넣은 일정·장소·채비를 반영하도록 일정을 다시 받은 뒤 탑승으로 판단한다.
     * 정차 중이 아니면(주행 중·Suspend) 다음 탑승을 기다린다.
     */
    private fun onPaired(brief: Boolean, out: MutableList<Effect>) {
        if (paired) return
        paired = true
        pairingCode = null
        if (card?.isPairing == true) closeCard(out)
        if (!brief || suspended || motion() != Motion.STOPPED) return
        loadingSchedules = true
        loadGeneration = AWAITING_GENERATION
        heldBoarding = true
        out += Effect.RefreshSchedules
    }

    private fun onUnpaired(out: MutableList<Effect>) {
        if (!paired) return
        paired = false
        pending = null
        acceptedRoute = false
        acceptedVia = null
        heldBoarding = false
        heldReaskNow = false
        reask = null
        reaskAtPark = false
        routeScheduleId = null
        energyOffered = false
        clearExit()
        // 연결이 풀리면 집 좌표(일정 응답의 자주 가는 곳)는 [SessionHost]가 지운다. 세션은 위치와 집 판정 기록을 버린다.
        forgetLocation()
        // 다른 운전자가 이어 연결할 수 있어 이 운전자의 탑승 기록과 당일 알림 기록도 비운다(정책서 10.9: 해제하면 탑승 기록도 함께 지운다).
        // 그래야 해제 뒤 10분 안에 다른 운전자가 연결해도 '잠깐 정차'로 침묵하지 않고 첫 브리핑이 나온다.
        log = BoardingLog()
        statuses = emptyMap()
        statusDate = today()
        homeItemsAnnounced = emptySet()
        homeCardShown = false
        lastParkWasRun = false
        drivenSincePark = false
        exitCardShownThisPark = false
        // 받던 일정은 [ServerScheduleSource.clear]가 버렸고 그 받기의 완료는 오지 않는다(마지막 세대가 아니라서). 받는 중으로 남지 않게 한다.
        loadingSchedules = false
        clearResult(out)
        if (card != null) closeCard(out, instant = true)
    }

    private fun onSchedulesLoaded(out: MutableList<Effect>) {
        val held = heldBoarding
        val reaskNow = heldReaskNow
        heldBoarding = false
        heldReaskNow = false
        if (!held) return
        // 받는 동안 P단 다시 묻기를 보류했다면, 받기가 끝난 지금 앞에 있고 정차 중일 때만 묻는다. 아니면 기회를 쓰지 않고 같은 P단에서 앞에 올 때까지 남긴다.
        if (reaskNow && (!foreground || motion() != Motion.STOPPED)) {
            reaskAtPark = gear == Gear.PARK && reask != null
            return
        }
        onBoarded(out, allowRefresh = false, reaskNow = reaskNow)
    }

    private fun onTravelTime(event: Event.TravelTimeResult, out: MutableList<Effect>) {
        val waiting = pending ?: return
        if (waiting.requestId != event.requestId) return
        pending = null
        if (!canSpeak()) return
        // 기다리는 사이 앱이 뒤로 갔으면 P단 다시 묻기는 기회를 쓰지 않고 앞에 올 때까지 남긴다.
        if (waiting.atPark && !foreground) {
            reaskAtPark = gear == Gear.PARK && reask != null
            return
        }
        // 일정 겹침에서 고른 일정이면 그 일정이 아직 도착·건너뜀이 아닌지만 본다. 아니면 기다리는 사이 대상 일정이 바뀌었을 때 그 소요 시간은 쓰지 않는다.
        if (waiting.forced) {
            val chosen = plan().pending().firstOrNull { it.id == waiting.targetId }
            decide(waiting.kind, event.travelTime.takeIf { chosen != null }, out, waiting.reasking, forced = chosen, atPark = waiting.atPark)
            return
        }
        val sameTarget = boardingTarget()?.id == waiting.targetId
        decide(waiting.kind, event.travelTime.takeIf { sameTarget }, out, waiting.reasking, atPark = waiting.atPark)
    }

    /**
     * 탑승 판단 결과를 카드로 띄운다. 결과가 출발 제안이면 에너지를 먼저 본다([energyStep]): 모자라면 서버에 후보를 묻고(카드는 그 답까지 미룬다, [onEnergyOptions]가
     * [energy]를 넣어 이 함수를 다시 부른다) 출발 제안을 충전·주유 제안으로 바꾼다. [energy]는 그 답이고, null이면 아직 묻지 않았다.
     */
    private fun decide(
        kind: BoardingKind,
        travelTime: Duration?,
        out: MutableList<Effect>,
        reasking: Boolean = false,
        forced: Schedule? = null,
        atPark: Boolean = false,
        energy: EnergyAnswer? = null,
    ) {
        val first = BoardingDecider.decide(
            now(), kind, plan(), planIsFallback = origin == ScheduleOrigin.STORED, travelTime = travelTime, favorites = favorites, here = hereForBoarding(), forcedTarget = forced,
        )
        if (first !is BoardingDecision.Card) return
        val firstQuestion = first.question
        val decision = if (firstQuestion is Question.Depart) {
            when (val step = energyStep(firstQuestion, energy, out)) {
                EnergyStep.Plain -> first
                is EnergyStep.Replace -> first.copy(question = step.question)
                is EnergyStep.Ask -> {
                    val id = ++seq
                    pending = PendingBoarding(id, kind, step.targetId, reasking, forced = forced != null, atPark = atPark, energy = EnergyWait(travelTime, forced?.id))
                    out += Effect.RequestEnergyOptions(id, step.request)
                    return
                }
            }
        } else {
            first
        }
        // 탑승은 카드를 실제로 띄울 때 기록한다. 판단 중에 D로 바뀌어 카드가 안 뜨면 그날 첫 탑승을 소진하지 않는다.
        // 달린 뒤 P단에서 다시 묻는 것은 탑승이 아니라서 기록하지 않는다: 기록하면 '마지막 탑승 뒤 달린 뒤 P단' 표시와 하차 대기 판단이 지워져
        // 내렸다가 다시 앱에 들어와도 재탑승 한 줄이 나오지 않는다.
        // 일정을 못 받았고 사본도 없어서(origin NONE) 낸 '일정 없음' 카드도 그날 첫 브리핑을 쓴 것으로 치지 않는다: 다음에 일정을 새로 받은 탑승이 첫 탑승으로 판단된다.
        if (!atPark) {
            lastParkWasRun = false
            if (origin != ScheduleOrigin.NONE) log = log.boarded(now(), zone)
        }
        val question = decision.question
        if (question is Question.DepartLate) statuses = plan().markLate(question.target.id).statuses

        val view = Phrases.card(decision, now(), zone)
        val timerId = ++seq
        val state = CardState(view, question, timerId, voiceOpen = true, briefing = decision.briefing, isReask = reasking, kind = kind, parkReask = atPark)
        // 다시 묻는 카드를 띄우면 그 기회는 쓴 것이다(한 번만).
        if (reasking) reask = null
        card = state
        resultTimerId = null
        // 에너지 제안은 하루 한 번: 카드를 실제로 띄울 때 표시한다(거절·무시·수락 어느 쪽이든 그날 다시 묻지 않는다).
        if (question is Question.Energy) energyOffered = true
        out += Effect.ShowCard(view(state))
        speak(out, Phrases.spoken(view), thenListen = true)
        out += Effect.ScheduleCardTimeout(timerId, Rules.CARD_TIMEOUT)
    }

    /** 지금 상태의 필요 거리. 지금 위치(믿을 만한 최근 측위)·오늘 남은 일정 장소·집으로 센다. 셀 구간이 없으면 null. */
    private fun energyNeed(): EnergyNeed? =
        EnergyNeed.of(hereForBoarding(), plan().pending().mapNotNull { it.place?.position }, home())

    /**
     * 출발 제안 앞의 에너지 체크(정책서 5장·9장). 연료 종류와 주행 가능 거리를 둘 다 알아야 하고, 모르면 [EnergyStep.Plain]이다.
     * - 넉넉하면 그날 이미 물었다는 표시를 풀고 그대로 둔다. 모자라도 그날 이미 물었으면 그대로 둔다(하루 한 번).
     * - 모자라고 서버에 물을 수 있으면(지금 위치를 앎) [EnergyStep.Ask]. 답을 받은([answer]) 뒤에는 후보가 있으면 [Question.Energy]로,
     *   서버 실패·후보 0개·지금 위치 모름이면 원래 출발 제안에 "배터리가 모자랄 수 있어요." 한 문장만 붙인다(가안).
     * 판단 로그([Effect.EnergyJudged])는 처음 한 번만 낸다(답을 받은 뒤 다시 판단할 때는 내지 않는다).
     */
    private fun energyStep(depart: Question.Depart, answer: EnergyAnswer?, out: MutableList<Effect>): EnergyStep {
        val kind = energyKind ?: return EnergyStep.Plain
        val range = rangeKm ?: return EnergyStep.Plain
        val need = energyNeed() ?: return EnergyStep.Plain
        val short = need.isShort(range)
        if (answer == null) out += Effect.EnergyJudged(need.km, range, short)
        if (!short) {
            energyOffered = false
            return EnergyStep.Plain
        }
        if (energyOffered) return EnergyStep.Plain
        val destination = depart.target.place ?: return EnergyStep.Plain
        val lowEnergy = EnergyStep.Replace(depart.copy(lowEnergy = kind))
        if (answer == null) {
            val here = hereForBoarding() ?: return lowEnergy
            // 서버의 오래 머무는 일정(2시간) 판단은 전기차에만 쓰므로 머무는 시간은 전기차일 때만 보낸다.
            val stay = if (kind.electric) Duration.between(depart.target.start, depart.target.end) else null
            return EnergyStep.Ask(EnergyRequest(kind, here, destination.position, stay, now().atZone(zone)), depart.target.id)
        }
        val options = answer.options
        if (options == null || options.stops.isEmpty()) return lowEnergy
        return EnergyStep.Replace(
            Question.Energy(depart.target, kind, need.spokenKm, need.goal, options.stops, mealBundle = options.mealBundle, stale = options.stale),
        )
    }

    private fun onEnergyChanged(event: Event.EnergyChanged) {
        energyKind = event.kind
        rangeKm = event.rangeKm?.takeIf { it.isFinite() && it >= 0.0 }
        // 주행 가능 거리가 다시 넉넉해졌으면(충전한 뒤) 그날 이미 물었다는 표시를 푼다. 셀 구간이 없어 판단할 수 없으면 그대로 둔다.
        val range = rangeKm ?: return
        if (energyOffered && energyKind != null && energyNeed()?.isShort(range) == false) energyOffered = false
    }

    /** 에너지 후보 답. 답을 기다리던 탑승 판단이 아니면(주행으로 버려졌거나 낡은 답) 무시한다. */
    private fun onEnergyOptions(event: Event.EnergyOptionsResult, out: MutableList<Effect>) {
        val waiting = pending ?: return
        val wait = waiting.energy ?: return
        if (waiting.requestId != event.requestId) return
        pending = null
        if (!canSpeak()) return
        // 기다리는 사이 앱이 뒤로 갔으면 P단 다시 묻기는 기회를 쓰지 않고 앞에 올 때까지 남긴다(소요 시간 답과 같은 규칙).
        if (waiting.atPark && !foreground) {
            reaskAtPark = gear == Gear.PARK && reask != null
            return
        }
        val forced = wait.forcedId?.let { id -> plan().pending().firstOrNull { it.id == id } }
        decide(waiting.kind, wait.travelTime, out, waiting.reasking, forced = forced, atPark = waiting.atPark, energy = EnergyAnswer(event.options))
    }

    private fun view(state: CardState): CardContent = state.view.copy(notice = state.notice)

    private fun onGear(newGear: Gear, out: MutableList<Effect>) {
        val previous = gear
        gear = newGear
        val driving = newGear == Gear.DRIVE || newGear == Gear.REVERSE
        if (driving && previous != Gear.DRIVE && previous != Gear.REVERSE) {
            // 움직이기 시작하면 전에 안 위치는 지난 위치다.
            lastPosition = null
            lastPositionAt = null
            stopAwaitingLocation()
        }
        if (driving) {
            // 이번 주행의 시작(마지막 P단 뒤 처음 D·R). 그 전에 측위한 위치는 판정에 쓰지 않는다.
            if (!drivenSincePark) driveStartedAt = now()
            drivenSincePark = true
            exitCardShownThisPark = false
            reaskAtPark = false
            // 위치로 정한 하차 대기(집 하차 포함)는 다시 달리면 지운다. 내비 도착 대기는 그대로 다음 P단을 기다린다.
            if (exitByLocation) clearExit()
        }
        val parkedNow = newGear == Gear.PARK && previous != Gear.PARK
        if (parkedNow) {
            // 달린 적이 있을 때만 '방금 P단에 넣음'이다. 앱을 켠 순간 이미 P단인 경우는 기록하지 않는다.
            val ran = drivenSincePark
            lastParkWasRun = ran
            drivenSincePark = false
            if (ran) {
                // 다시 묻기는 잠깐 정차 P단을 건너뛴다: P단 시각을 갱신하기 전의 기록으로 이 P단이 마지막 P단 뒤 10분 안인지 본다(탑승 판단의 잠깐 정차와 같은 분류).
                val quickPark = log.classify(now(), zone) == BoardingKind.QUICK_STOP
                log = log.parked(now())
                // 내비 도착으로 기다리던 하차 대기가 있으면 그 카드가 먼저다(3장: 내비 도착 또는 300m 안 P단, 둘 중 하나로 도착이 된다).
                // 그 P단에서도 위치 판정은 한다. 다른 일정의 도착 기록은 살리고, 카드는 먼저 기다린 것 하나만 둔다([arrive]의 규칙). 집 하차는 이 P단에서 하지 않는다.
                val naviPending = exitTargetId != null
                showExitCard(out)
                judgeAtPark(out, allowHome = !naviPending)
                reaskAtPark = reask != null && !quickPark
            } else {
                // 앱을 켠 순간 이미 P단(UNKNOWN→P)이거나 달리지 않고 넣은 P단은 하차가 아니라서 대기를 버린다. 도착이 없던 P단은 대기가 없어 아무 일 없다.
                clearExit()
                reaskAtPark = false
            }
        } else if (newGear != Gear.PARK) {
            lastParkWasRun = false
            reaskAtPark = false
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
        val current = card
        if (current?.drivingExit == true) {
            // 주행 중 내비 도착 순간에 띄운 하차 카드는 접지 않는다(사용자 결정 2026-11-15, [showExitCard]의 유일한 예외). 5초 뒤 또는 [챙겼어요]로 닫힌다.
            drivingHandled = true
        } else if (current != null) {
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

    /**
     * 30초 동안 대답이 없어(보류한 뒤 접힌 것 포함) 접히는 질문 카드를 다시 물을 질문으로 남긴다(정책서 6장 무응답, 7장 보류).
     * 이미 다시 묻는 카드였으면 남기지 않는다(한 번만). 질문이 없는 카드(하차·안내·연결)와 거절·수락·주행 시작으로 접히는 카드는 해당 없다.
     */
    private fun keepForReask(state: CardState) {
        val question = state.question ?: return
        // 다시 묻는 카드가 또 접히면 남기지 않는다(한 번만). 단 그 카드를 말하지 못했으면(오디오 포커스를 못 얻음) 기회를 쓴 것이 아니라서 다시 남긴다.
        if ((state.isReask && !state.speechFailed) || state.resolving) return
        reask = PendingReask.of(question)
    }

    /** 다시 물을 질문이 다룬 대상 일정이 도착·건너뜀이 됐으면 지운다. */
    private fun pruneReask() {
        val id = reask?.scheduleId ?: return
        if (plan().statusOf(id).isFinal) reask = null
    }

    /**
     * 달린 뒤 넣은 P단에서 다시 물을 질문을 한 번 묻는다(정책서 6장 '무응답: 다음 정차 때 한 번만 다시 묻기').
     * - 위치로 도착을 판단하는 동안은 기다린다. 도착이 되면 하차 카드가 먼저라 이 P단에서는 묻지 않는다(다음 탑승 판단으로 남는다).
     * - 이 P단에서 하차 카드(일정 장소·집)를 보였거나 보이려고 기다리면 묻지 않는다. 지우지도 않아 다음 정차나 다음 탑승 판단에서 묻는다.
     * - 그 밖에는 재탑승 한 줄로 [onBoarded]를 다시 판단한다(그 사이 대상 일정이 바뀌었거나 이미 늦었으면 그 판단으로 만든 질문이다).
     *   다른 카드가 떠 있거나 판단을 못 하면(일정을 받는 중이면 받기가 끝난 뒤 이어 간다) 이 P단에서는 건너뛴다.
     */
    private fun settleReaskAtPark(out: MutableList<Effect>) {
        if (!reaskAtPark) return
        if (gear != Gear.PARK || suspended) {
            reaskAtPark = false
            return
        }
        if (awaitingParkLocation) return
        pruneReask()
        if (reask == null || exitCardShownThisPark || exitTargetId != null || exitHome) {
            reaskAtPark = false
            return
        }
        // 같은 이벤트 묶음의 진짜 탑승 판단이 일정을 받느라 보류돼 있으면 그쪽이 이 질문까지 다시 묻는 것으로 치고 소비한다.
        // 여기서 다시 묻기를 보류하면 보류한 탑승이 '다시 묻기' 판단으로 바뀐다(탑승 종류·잠깐 정차 판단이 달라진다).
        if (heldBoarding) {
            reaskAtPark = false
            return
        }
        // 주행 제한이 아직 안 풀렸거나(P단 신호가 제한 해제보다 먼저 온 경우) 앱이 뒤에 있으면 기회를 쓰지 않고 기다린다.
        // 제한이 풀리거나 앱이 앞으로 오는 이벤트에서 이 함수가 다시 불려 이어서 묻는다(하차 카드와 같은 방식). D·R이 되거나 P단을 벗어나면 접는다.
        if (motion() != Motion.STOPPED || !foreground) return
        reaskAtPark = false
        onBoarded(out, reaskNow = true)
    }

    private fun onButton(primary: Boolean, out: MutableList<Effect>) {
        val state = card ?: return
        if (state.isExit) {
            // [챙겼어요]는 카드를 닫기만 한다(말하던 것도 멈춘다). 보조 버튼은 없다.
            if (primary) closeCard(out)
            return
        }
        val question = state.question ?: return
        if (state.resolving) return
        // 수락은 [accept]가 음성을 멈춘다.
        if (!primary) out += Effect.StopVoice
        when {
            primary -> accept(state, out)
            // 일정 겹침의 보조 버튼은 다음 일정을 고르는 것이다.
            question is Question.Overlap -> accept(state, out, 1)
            // 출발 제안·늦게 탐의 보조 버튼은 "잠깐만"(보류), 목적지 묻기의 보조 버튼은 "그냥 갈게"(거절)
            question is Question.Depart || question is Question.DepartLate || question is Question.Energy -> hold(state, out)
            else -> reject(out)
        }
    }

    /**
     * 일정 겹침에서 일정을 골랐다([pick] 0이 먼저인 일정, 1이 다음 일정). 같은 카드를 둔 채 고른 일정의 소요 시간을 묻고(그동안 입력은 무시),
     * 답이 오면 [onTravelTime]이 그 일정을 대상으로 한 출발 제안·늦게 탐·목적지 묻기로 카드를 바꾼다(5장 11번: 앞 질문의 답을 받은 뒤 같은 카드에서 다음 질문).
     * 고르지 않은 일정은 상태를 바꾸지 않고 그대로 둔다.
     */
    private fun chooseOverlap(state: CardState, overlap: Question.Overlap, pick: Int, out: MutableList<Effect>) {
        val chosen = if (pick == 0) overlap.first else overlap.second
        val place = chosen.place ?: return
        out += Effect.StopVoice
        state.resolving = true
        state.voiceOpen = false
        // 낡은 30초 타이머는 무시하고, 소요 시간 응답이 안 와도 30초 뒤에는 접히게 새로 센다.
        state.timerId = ++seq
        out += Effect.ScheduleCardTimeout(state.timerId, Rules.CARD_TIMEOUT)
        val id = ++seq
        // 다시 묻는 겹침 카드에서 고른 뒤의 출발 제안도 '다시 묻는 중'으로 넘겨, 그 카드가 또 접혀도 세 번째 질문이 생기지 않게 한다.
        pending = PendingBoarding(id, state.kind ?: BoardingKind.AGAIN, chosen.id, reasking = state.isReask, forced = true, atPark = state.parkReask)
        out += Effect.RequestTravelTime(id, place)
    }

    /** 후보 줄 누름. 목적지 묻기 카드의 후보 번호일 때만 그 후보로 길안내한다. */
    private fun onCandidate(index: Int, out: MutableList<Effect>) {
        val state = card ?: return
        if (state.resolving) return
        when (val question = state.question) {
            is Question.AskDestination -> if (index in question.candidates.indices) accept(state, out, index)
            is Question.Overlap -> if (index in 0..1) accept(state, out, index)
            else -> Unit
        }
    }

    private fun onHeard(text: String, out: MutableList<Effect>) {
        val state = card ?: return
        if (!state.voiceOpen || state.resolving) return
        state.voiceOpen = false
        val question = state.question
        // 화면에 보인 후보 이름(장소 후보, 일정 겹침의 두 일정). 순서가 후보 번호다.
        val candidates = Phrases.choiceNames(question)
        // 수락("응")은 1번 후보(주 버튼)를 고르는 것과 같은 결과다.
        val acceptPick = if (candidates.isNotEmpty()) 0 else null
        when (val intent = IntentMatcher.match(text, candidates, acceptPick, Phrases.choiceShortForms(question))) {
            Intent.Accept ->
                // 후보가 없는 목적지 묻기에서 "응"은 갈 곳을 정하지 못한 말이다.
                if (question is Question.AskDestination && candidates.isEmpty()) unrecognized(state, out) else accept(state, out)
            is Intent.Pick -> if (intent.index in candidates.indices) accept(state, out, intent.index) else unrecognized(state, out)
            Intent.Reject -> reject(out)
            Intent.Hold -> hold(state, out)
            Intent.Alternative -> alternative(state, out)
            Intent.Unrecognized -> unrecognized(state, out)
            Intent.Chatter, Intent.Silence -> Unit
        }
    }

    /**
     * 대안("다른 데", 7장): 후보가 있는 질문이면 다음 후보 하나만 보이는 카드로 바꿔 "{이름}으로 갈까요?"를 묻는다(듣기를 다시 열고 30초를 다시 센다).
     * 더 보여 줄 후보가 없거나 후보가 있는 질문이 아니면(출발 제안 등) "다른 곳은 찾지 못했어요."만 알리고 카드는 그대로 둔다.
     */
    private fun alternative(state: CardState, out: MutableList<Effect>) {
        val next: Question? = when (val question = state.question) {
            is Question.AskDestination -> question.nextAlternative()
            // 에너지 제안은 서버가 준 다음 후보 하나로 바꾼다(다시 부르지 않는다). 후보를 다 쓰면 아래 안내.
            is Question.Energy -> question.nextAlternative()
            else -> null
        }
        val briefing = state.briefing
        if (next == null || briefing == null) {
            state.notice = Phrases.NO_ALTERNATIVE
            out += Effect.ShowCard(view(state))
            speak(out, Phrases.NO_ALTERNATIVE, thenListen = false)
            return
        }
        state.question = next
        state.view = Phrases.card(BoardingDecision.Card(briefing, next), now(), zone)
        state.notice = null
        state.voiceOpen = true
        state.timerId = ++seq
        out += Effect.ShowCard(view(state))
        speak(out, Phrases.spoken(state.view), thenListen = true)
        out += Effect.ScheduleCardTimeout(state.timerId, Rules.CARD_TIMEOUT)
    }

    private fun unrecognized(state: CardState, out: MutableList<Effect>) {
        if (state.reprompts < Rules.MAX_REPROMPTS) {
            state.reprompts++
            state.voiceOpen = true
            speak(out, Phrases.askAgain(state.question), thenListen = true)
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
        val question = state.question
        if (question is Question.Overlap) {
            chooseOverlap(state, question, pick, out)
            return
        }
        val place = when (question) {
            is Question.Depart -> question.target.place
            is Question.DepartLate -> question.target.place
            is Question.Energy -> question.target.place
            is Question.AskDestination -> question.candidates.getOrNull(pick)
            is Question.Overlap, null -> null
        }
        // 일정으로 가는 길안내면 그 일정을 기억해 내비 도착 알림으로 도착을 판단한다(여유 많음의 1번 후보는 대상 일정 장소).
        val scheduleId = when (question) {
            is Question.Depart -> question.target.id
            is Question.DepartLate -> question.target.id
            is Question.Energy -> question.target.id
            is Question.AskDestination -> (question.options.getOrNull(pick) as? DestinationOption.OfSchedule)?.schedule?.id
            is Question.Overlap, null -> null
        }
        // 에너지 제안을 수락하면 충전소·주유소를 경유지로 넣어 대상 일정으로 길안내한다.
        val via = (question as? Question.Energy)?.stop?.place
        card = null
        out += Effect.StopVoice
        out += Effect.CollapseCard()
        if (place == null) return
        // 새 길안내를 수락하면 지난 도착의 하차 카드는 더 보이지 않고, 접어 둔 질문도 다시 묻지 않는다.
        clearExit()
        reask = null
        acceptedRoute = true
        acceptedVia = via
        routeScheduleId = scheduleId
        out += Effect.StartRoute(place, via)
    }

    /**
     * 달린 뒤 P단에 넣은 순간의 위치 판정(3·4장). 내비 도착 대기가 있어도 한다(도착은 내비 도착 또는 300m 안 P단 중 하나면 된다).
     * - 어댑터가 P단 직전 [Rules.LOCATION_TRUST_AGE](30초) 안에 측위한 위치가 있으면 그것으로 바로 판정한다.
     * - 없거나(오래됐거나 없음) 판정한 결과 일정 장소·집 어디와도 멀면 내비에 현재 위치를 한 번 물어 답([onLocation])으로 판정한다. 오래된 위치는 반경 안이어도 내비 답이 우선이다.
     *   답이 [Rules.LOCATION_ANSWER_TIMEOUT] 안에 없을 때만([onLocationTimeout]) 어댑터의 오래된([Rules.LOCATION_MAX_AGE] 이내) 위치로 같은 규칙(일정 장소·집 모두)으로 판정하고,
     *   그런 위치도 없으면 기다림만 끝낸다(타임아웃은 늘 건다). 기다림이 끝난 뒤 오는 주기 갱신으로는 다시 판정하지 않는다.
     * - 물을 후보(시간 창 안의 일정 장소나, [allowHome]일 때 등록한 집)가 없으면 묻지 않는다.
     * [allowHome]이 false면(이 P단에서 내비 도착 카드를 먼저 기다렸음) 집 하차 카드는 띄우지 않는다.
     */
    private fun judgeAtPark(out: MutableList<Effect>, allowHome: Boolean) {
        stopAwaitingLocation()
        val trusted = usableLocation(Rules.LOCATION_TRUST_AGE)
        if (trusted != null && judgeByLocation(trusted, allowHome, out)) return
        if (arrivalCandidates().isEmpty() && !(allowHome && home() != null)) return
        awaitingParkLocation = true
        awaitingHome = allowHome
        out += Effect.RequestLocation
        // 기다림에는 늘 타임아웃을 건다(믿을 위치도 오래된 위치도 없을 때 포함). 만료되면 오래된 위치가 있을 때만 그것으로 판정하고 기다림을 끝낸다.
        // P단에 선 뒤 오는 주기 갱신으로는 기다림이 끝난 다음 다시 판정하지 않는다.
        val id = ++seq
        locationTimerId = id
        out += Effect.ScheduleLocationTimeout(id, Rules.LOCATION_ANSWER_TIMEOUT)
    }

    /** 위치 답 기다림을 그만둔다(판정이 끝났거나 주행·Suspend·초기화로 의미가 없어짐). */
    private fun stopAwaitingLocation() {
        awaitingParkLocation = false
        awaitingHome = false
        locationTimerId = null
    }

    /**
     * 위치([Event.LocationChanged])를 받았다. 위치는 늘 기억하고(집 밖 기록 포함), P단에 넣으며 물은 답이면 판정한다.
     * 내비 답([Event.LocationChanged.naviAnswer])은 기다리는 동안에만 쓴다: 기다리지 않을 때(주행 중·이미 판정함·묻지 않음) 늦게 온 답은 기록하지 않는다.
     * 기다리는 동안에는 P단 직전 [Rules.LOCATION_TRUST_AGE] 안에 측위한 위치가 올 때만 판정한다(어댑터의 오래된 위치가 먼저 와도 내비의 답을 기다린다).
     */
    private fun onLocation(event: Event.LocationChanged, out: MutableList<Effect>) {
        if (event.naviAnswer && (!awaitingParkLocation || gear != Gear.PARK)) {
            if (gear != Gear.PARK) stopAwaitingLocation()
            return
        }
        val position = event.position
        val measuredAt = now().minusMillis(event.ageMillis.coerceAtLeast(0))
        // 이미 아는 위치보다 먼저 측위한 값이 늦게 오면 버린다(옛 위치가 최신 위치를 덮어쓰지 않게).
        lastPositionAt?.let { if (measuredAt.isBefore(it)) return }
        lastPosition = position
        lastPositionAt = measuredAt
        // 집 반경 밖 위치를 한 번이라도 받아야 돌아왔을 때 집 하차가 된다(아침에 2분 만에 되돌아오거나 주차장에서 옮기는 경우는 해당 없음).
        // 오래전에 측위한 위치(시스템이 기억하던 어제 위치 등)는 '지금 집 밖'이라는 증거가 아니라 세지 않는다.
        home()?.let { if (isRecent(measuredAt) && position.distanceTo(it) > Rules.HOME_RADIUS_METERS) leftHome = true }
        if (!awaitingParkLocation) return
        if (gear != Gear.PARK) {
            stopAwaitingLocation()
            return
        }
        val here = usableLocation(Rules.LOCATION_TRUST_AGE) ?: return
        val home = awaitingHome
        stopAwaitingLocation()
        judgeByLocation(here, home, out)
    }

    /** 내비가 위치를 묻는 말에 답하지 않았다. 어댑터의 오래된 위치가 있으면 그것으로 같은 규칙에 따라 판정한다. */
    private fun onLocationTimeout(timerId: Int, out: MutableList<Effect>) {
        if (locationTimerId != timerId) return
        if (!awaitingParkLocation || gear != Gear.PARK) {
            stopAwaitingLocation()
            return
        }
        val home = awaitingHome
        stopAwaitingLocation()
        val stale = usableLocation(Rules.LOCATION_MAX_AGE) ?: return
        judgeByLocation(stale, home, out)
    }

    private fun isRecent(measuredAt: Instant): Boolean {
        val age = Duration.between(measuredAt, now())
        return !age.isNegative && age <= Rules.LOCATION_MAX_AGE
    }

    /**
     * 지금 판정에 쓸 수 있는 마지막 위치. 이번 주행([driveStartedAt]) 시작 뒤에 측위했고 측위한 지 [maxAge] 이내여야 한다
     * ([Rules.LOCATION_MAX_AGE]가 상한이고, P단 직후 바로 쓰는 것은 [Rules.LOCATION_TRUST_AGE]). 없거나 조건에 안 맞으면 null.
     */
    private fun usableLocation(maxAge: Duration): LatLng? {
        val at = lastPositionAt ?: return null
        val start = driveStartedAt ?: return null
        if (at.isBefore(start)) return null
        val age = Duration.between(at, now())
        if (age.isNegative || age > minOf(maxAge, Rules.LOCATION_MAX_AGE)) return null
        return lastPosition
    }

    /** 서버 자주 가는 곳의 집 좌표. 폰 앱에 등록하지 않았으면 null이라 집 하차는 없다. */
    private fun home(): LatLng? = favorites.firstOrNull { it.kind == FavoriteKind.HOME }?.place?.position

    /**
     * 위치 도착 후보: 오늘 일정 중 도착·건너뜀이 아니고(종일 제외) 장소를 알며 '시작 [Rules.ARRIVAL_WINDOW_LEAD] 전 ~ 종료' 시간 창 안인 것.
     * 창 밖 일정은 근처 P단이어도 도착으로 기록하지 않고 집 판정으로 넘어간다.
     */
    private fun arrivalCandidates(): List<Schedule> {
        val now = now()
        return plan().pending().filter { it.place != null && !now.isBefore(it.start - Rules.ARRIVAL_WINDOW_LEAD) && now.isBefore(it.end) }
    }

    /**
     * [here] 위치로 두 가지를 판정한다(앞이 먼저, 하나만 한다).
     * 1. 일정 장소 도착: [arrivalCandidates] 가운데 [Rules.ARRIVAL_RADIUS_METERS] 안인 것을 도착으로 기록한다(여럿이면 시작 시각이 지금과 가장 가까운 하나).
     *    이미 하차 카드를 기다리는 일정이 있으면 [arrive]의 규칙대로 도착만 기록하고 카드는 먼저 기다린 것이 맡는다. 집 반경 안이기도 하면 집 판정 기록(`leftHome`)도 지운다
     *    (이 P단에서 이미 일정 카드를 냈으니 다음 집 P단에서 집 하차가 한 번 더 뜨지 않게).
     * 2. 집 하차: 등록한 집 [Rules.HOME_RADIUS_METERS] 안이고, 마지막 집 P단(또는 앱 시작) 뒤 집 반경 밖 위치를 받은 적이 있을([leftHome]) 때만, 그리고 [allowHome]일 때만 집 하차 카드를 기다린다.
     *    집 P단이면 그 기록을 지운다(카드를 보이든 아니든). 같은 물건·인사는 하루에 한 번만 보인다([showExitCard]).
     * @return 도착을 기록했거나 집 반경 안이라 집 판정이 끝났으면 true(내비에 다시 묻지 않는다). 일정 장소·집 어느 쪽도 아니면 false.
     */
    private fun judgeByLocation(here: LatLng, allowHome: Boolean, out: MutableList<Effect>): Boolean {
        val homeAt = home()
        val target = arrivalCandidates()
            .filter { here.distanceTo(it.place!!.position) <= Rules.ARRIVAL_RADIUS_METERS }
            .minByOrNull { Duration.between(now(), it.start).abs() }
        if (target != null) {
            if (homeAt != null && here.distanceTo(homeAt) <= Rules.HOME_RADIUS_METERS) leftHome = false
            arrive(target.id, out, byLocation = true)
            return true
        }
        if (homeAt == null || here.distanceTo(homeAt) > Rules.HOME_RADIUS_METERS) return false
        val returned = leftHome
        leftHome = false
        if (allowHome && returned && lastParkWasRun && exitTargetId == null && !exitHome && !exitCardShownThisPark) {
            exitHome = true
            exitArrivedAt = now()
            exitByLocation = true
            settleExitAtPark(out)
        }
        return true
    }

    /** 위치와 집 판정 기록을 버린다(연결이 풀렸을 때·데모 초기화). */
    private fun forgetLocation() {
        lastPosition = null
        lastPositionAt = null
        driveStartedAt = null
        leftHome = false
        stopAwaitingLocation()
    }

    /**
     * 지금 위치를 쓸 일이 있는지: 연결돼 있고, 집 좌표가 있거나 오늘 끝나지 않은 일정 중 도착·건너뜀이 아니고 장소를 아는 것이 있다.
     * 아니면 [needsLocation]이 false라 호스트는 위치 갱신을 켜지 않고 권한 설명 카드도 띄우지 않는다(가이드: 불필요한 센서 수집·권한 요청 최소화).
     */
    private fun computeNeedsLocation(): Boolean {
        if (!paired) return false
        if (home() != null) return true
        val now = now()
        return plan().pending().any { it.place != null && it.end.isAfter(now) }
    }

    /** 내비 도착 알림: 차곡이 길안내를 시작한 일정만 도착으로 본다(다른 곳으로 간 길안내의 도착은 무시). */
    private fun onDestinationArrived(out: MutableList<Effect>) {
        val id = routeScheduleId ?: return
        arrive(id, out)
    }

    /**
     * 일정을 도착으로 바꾼다(내비 도착과 P단 위치 도착이 모두 여기를 지난다). 도착 알림 자체에는 말이 없고, 하차 카드가 그 말이다.
     * 새로 도착이 된 일정만 하차 대기([exitTargetId])로 세운다(이미 도착·건너뜀이거나 모르는 일정이면 상태도 카드도 그대로).
     * 이미 P단이면([settleExitAtPark]) 바로 카드를 띄우거나 버리고, 주행 중 내비 도착이면 그 자리에서 띄운다([showExitCard]의 `whileDriving` 예외, 사용자 결정 2026-11-15).
     * 못 띄웠으면 도착 뒤 달린 다음 P단까지 기다린다.
     * 다시 탈 때 다음 일정을 한 줄로 묻는 것(재탑승, 잠깐 정차 10분 안은 침묵)은 이와 별개다.
     */
    private fun arrive(id: String, out: MutableList<Effect>, byLocation: Boolean = false) {
        val fresh = !plan().statusOf(id).isFinal && schedules.any { it.id == id }
        statuses = plan().markArrived(id).statuses
        if (routeScheduleId == id) routeScheduleId = null
        stopAwaitingLocation()
        if (!fresh) return
        // 이 P단에서 하차 카드를 이미 보였으면(닫힌 뒤라도) 뒤에 온 도착은 기록만 한다(한 P단에 하차 카드는 하나).
        if (exitCardShownThisPark && gear == Gear.PARK) return
        // 먼저 기다리던 하차 카드가 있으면 그것을 우선하고 덮어쓰지 않는다(뒤 도착은 기록만 한다).
        if (exitTargetId == null && !exitHome) {
            exitTargetId = id
            exitArrivedAt = now()
            exitByLocation = byLocation
        }
        // 주행 중 내비 도착은 그 자리에서 하차 카드를 띄운다(아래 [showExitCard]의 예외). 위치 도착은 P단에서만 판정하므로 해당 없다.
        if (gear != Gear.PARK && !byLocation && motion() == Motion.DRIVING) showExitCard(out, whileDriving = true) else settleExitAtPark(out)
    }

    /**
     * 도착이 기록된 순간 이미 P단이면: 그 P단이 달린 뒤이고 P단에 넣은 지 [Rules.EXIT_PENDING_MAX] 안일 때만 바로 하차 카드를 띄운다
     * (주행 제한이 걸려 있으면 풀릴 때까지 기다린다). 앱을 켠 순간 이미 P단이었거나 달리지 않고 넣은 P단,
     * 오래전에 넣은 P단에 늦게 온 도착이면 대기를 버린다. 주행 중·N단이면 다음 P단을 기다린다.
     */
    private fun settleExitAtPark(out: MutableList<Effect>) {
        if (gear != Gear.PARK) return
        val parkedAt = log.lastParkedAt
        val recentPark = parkedAt != null && !parkedAt.isAfter(now()) && Duration.between(parkedAt, now()) <= Rules.EXIT_PENDING_MAX
        if (!lastParkWasRun || !recentPark) clearExit() else showExitCard(out)
    }

    private fun clearExit() {
        exitTargetId = null
        exitArrivedAt = null
        exitHome = false
        exitByLocation = false
    }

    /**
     * 하차 카드(일정 장소 하차, 또는 위치로 정한 집 하차 [exitHome])를 보인다. 대기 중인 도착이 없거나 정차 중이 아니면(주행·제한 중) 아무것도 하지 않고 대기는 남긴다.
     * Suspend에 들어갈 때는 [suspend]가 대기를 이미 지웠다. 만료(도착 뒤 [Rules.EXIT_PENDING_MAX])는 이벤트마다 [handle]이 먼저 확인한다.
     * 세션이 아는 다른 카드(탑승 질문·출발 제안·연결 카드)가 이미 떠 있거나 탑승 판단이 진행 중이거나 휴대폰 연결 전이면 하차 카드를 보이지 않고 대기를 버린다.
     * (권한 설명 카드는 세션 밖 `MainActivity` 소관이라 세션은 모른다.)
     * 집 하차는 오늘 이미 알린 픽업 일정을 빼고, 남은 물건이 없는데 오늘 이미 인사했으면 카드를 보이지 않는다(`docs/home-exit.md`).
     * 말은 [Phrases.exitSpoken]([Phrases.homeExitSpoken]) 한 번뿐이고 듣지 않는다. 앱이 뒤에 있어도 말은 한다. 카드는 [exitCardTimeout] 뒤 닫히고, 말은 닫힐 때 멈춘다.
     *
     * [whileDriving]은 **주행 중 말하기·카드 금지의 유일한 예외**다. 사용자 결정(2026-11-15): 길안내하던 일정의 내비 도착 순간에는 주행 중이어도
     * 일정 장소 하차 카드를 바로 띄우고 한 번 말한다(듣기는 열지 않는다). Pleos 주행 규제와 충돌할 수 있어 실차 전 확인이 필요하다.
     * 이 경로는 다른 카드·탑승 판단이 떠 있어 못 띄우면 대기를 버리지 않고 남겨 뒤의 P단에서 기존대로 띄운다. 띄우면 대기를 지워 그 P단에서 같은 카드가 다시 뜨지 않는다.
     */
    private fun showExitCard(out: MutableList<Effect>, whileDriving: Boolean = false) {
        val id = exitTargetId
        val atHome = exitHome
        if (id == null && !atHome) return
        if (suspended) return
        if (!whileDriving && motion() != Motion.STOPPED) return
        // 탑승 판단이 진행 중(소요 시간을 기다리는 중)이어도 하차 카드는 보이지 않는다(곧 탑승 카드가 뜬다).
        val blocked = !paired || card != null || pending != null
        if (whileDriving && blocked) return
        clearExit()
        if (blocked) return
        val timeout = exitCardTimeout()
        val view: CardContent
        val spoken: String
        if (atHome) {
            // 집 하차: 오늘 이미 알린 픽업 일정은 빼고, 남은 물건이 없는데 오늘 이미 인사했으면 아무것도 보이지 않는다.
            val items = HomePickup.items(plan(), now(), homeItemsAnnounced)
            if (items.isEmpty() && homeCardShown) return
            homeItemsAnnounced = homeItemsAnnounced + items.map { it.schedule.id }
            homeCardShown = true
            view = Phrases.homeExitCard(items, timeout)
            spoken = Phrases.homeExitSpoken(items)
        } else {
            val schedule = schedules.firstOrNull { it.id == id } ?: return
            view = Phrases.exitCard(schedule, timeout)
            spoken = Phrases.exitSpoken(schedule)
        }
        exitCardShownThisPark = true
        val timerId = ++seq
        card = CardState(view, null, timerId, isExit = true, drivingExit = whileDriving)
        resultTimerId = null
        out += Effect.ShowCard(view)
        // 주행 중 예외는 [canSpeak]를 거치지 않는다(위 KDoc). 그 밖에는 정차 중일 때만 말한다.
        if (whileDriving) out += Effect.Speak(spoken, false) else speak(out, spoken, thenListen = false)
        out += Effect.ScheduleCardTimeout(timerId, timeout)
    }

    /** 길안내 요청 결과를 알린다. 정차 중일 때만 결과 한 줄을 보이고 말하며, 한 줄은 [Rules.RESULT_VISIBLE] 뒤 지운다. */
    private fun onRouteResult(ok: Boolean, out: MutableList<Effect>) {
        if (!acceptedRoute) return
        acceptedRoute = false
        // 길안내를 시작하지 못했으면 그 일정은 가고 있는 곳이 아니다: 기억을 지워 내비 도착으로 오인하거나 주행 중 칩이 계속 그 일정을 보이지 않게 한다.
        if (!ok) routeScheduleId = null
        val via = acceptedVia
        acceptedVia = null
        if (!canSpeak()) return
        val text = when {
            !ok -> Phrases.ROUTE_FAILED
            via != null -> Phrases.energyRouteStarted(via.name)
            else -> Phrases.ROUTE_STARTED
        }
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
        acceptedVia = null
        routeScheduleId = null
        energyOffered = false
        forgetLocation()
        heldBoarding = false
        heldReaskNow = false
        reask = null
        reaskAtPark = false
        drivenSincePark = false
        clearExit()
        homeItemsAnnounced = emptySet()
        homeCardShown = false
        lastParkWasRun = false
        exitCardShownThisPark = false
        // 데모 시계가 바뀌었을 수 있어 칩 재판단 시각을 다시 맞춘다.
        chipDeadline = null
        if (card != null) closeCard(out, instant = true) else out += Effect.StopVoice
        resultTimerId = null
        out += Effect.ShowResult("")
    }

    /**
     * 다음 일정 칩을 지금 상태에 맞춘다. 주행 중이고 연결돼 있고 Suspend가 아니며 다음 일정([DayPlan.target]: 도착·건너뜀·종일 제외)이
     * 있을 때만 칩이 있고, 일정이 도착이 되면 다음 일정으로 바뀐다. 정차하면 같은 처리에서 바로 숨긴다.
     *
     * 일정을 받는 중([loadingSchedules])에는 칩을 바꾸지 않는다: 그동안은 캐시가 이전 기준 시각의 것일 수 있어
     * 건너뜀·날짜 넘김 처리를 미루므로([handle]) 낡은 일정을 칩에 올리지 않으려는 것이다. 받기가 끝나는 이벤트에서 다시 맞춘다.
     * 칩을 보일 수 없는 상태(정차·미연결·Suspend)로 바뀌면 받는 중에도 숨긴다.
     *
     * 이벤트 없이 시간만 흘러도 맞도록, 칩이 보이는 동안 대상 일정이 끝나는 시각에 [Effect.ScheduleChipRecheck]를 낸다.
     * 자정은 따로 깨우지 않는다: 자정을 넘겨도 아직 끝나지 않은 일정은 [rollDate]가 남겨 칩이 그대로이기 때문이다.
     */
    private fun syncChip(out: MutableList<Effect>) {
        // 주행 중 도착 하차 카드([CardState.drivingExit])가 떠 있는 동안은 숨긴다(카드 열과 같은 왼쪽 위라 겹친다). 카드가 닫히면 다음 일정으로 다시 보인다.
        val visible = motion() == Motion.DRIVING && paired && !suspended && card?.drivingExit != true
        if (visible && loadingSchedules) return
        val target = if (visible) chipTarget() else null
        val chip = target?.let { Phrases.nextChipBody(it, zone) } ?: ""
        if (chip != shownChip) {
            shownChip = chip
            out += Effect.ShowNextChip(chip)
        }
        if (target == null) {
            chipTimerId = null
            chipDeadline = null
            return
        }
        val deadline = target.end
        if (deadline == chipDeadline) return
        chipDeadline = deadline
        val id = ++seq
        chipTimerId = id
        // 일부러 조금 늦게 깨워, 끝 시각 직후에 건너뜀 판정이 서게 한다(타이머 오차로 일찍 깨 헛돌지 않게).
        out += Effect.ScheduleChipRecheck(id, Duration.between(now(), deadline).coerceAtLeast(Duration.ZERO) + CHIP_RECHECK_SLACK)
    }

    /**
     * 주행 중 칩이 보일 일정. 길안내 중이면([routeScheduleId]) 그 일정이다(다음 일정이 아니라 지금 가고 있는 곳). 그 일정이 이미 도착·건너뜀이면 지금처럼 [DayPlan.target]이다.
     */
    private fun chipTarget(): Schedule? =
        routeScheduleId?.let { id -> plan().pending().firstOrNull { it.id == id } } ?: plan().target()

    /** 저장은 매 이벤트 끝에 바뀐 것만 내보낸다. Suspend 진입 때는 바뀌지 않았어도 저장한다. */
    private fun flush(out: MutableList<Effect>) {
        syncChip(out)
        val snap = snapshot()
        if (snap != lastSaved || forceSave) {
            forceSave = false
            lastSaved = snap
            out += Effect.Save(snap)
        }
    }

    companion object {
        private const val AWAITING_GENERATION = -1

        /** 칩 재판단 타이머를 끝 시각보다 이만큼 늦게 깨운다. */
        val CHIP_RECHECK_SLACK: Duration = Duration.ofMillis(500)
    }
}
