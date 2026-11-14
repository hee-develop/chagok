package com.chagok.car.flow

import com.chagok.car.domain.Favorite
import com.chagok.car.domain.Schedule
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference

/** 서버에서 오늘 일정 응답 본문(JSON)을 받아 온다. 실패하면 예외를 던진다. 호출은 메인 스레드가 아닌 곳에서 한다. */
fun interface ScheduleFetcher {
    fun fetch(at: Instant): String
}

/** 서버가 200이 아닌 상태로 답했다. 본문은 담지 않는다. */
class ScheduleHttpException(val status: Int) : IOException("일정 응답 $status")

/**
 * `GET {baseUrl}/schedules/today?at=<ISO8601>` 를 HttpURLConnection으로 부른다.
 * 연결·읽기에 각각 2초 제한을 두고, 요청 전체(이름 해석 DNS 포함)에는 3초 데드라인을 둔다.
 * 데드라인을 넘기면 호출은 연결을 끊고 [IOException]으로 끝난다. 다만 DNS 조회 중인 스레드는 취소할 수 없어
 * 운영체제의 제한 시간까지 데몬 스레드로 남을 수 있다(결과는 버려진다).
 */
class HttpScheduleFetcher(private val baseUrl: String) : ScheduleFetcher {
    override fun fetch(at: Instant): String {
        val connection = AtomicReference<HttpURLConnection?>()
        val task = FutureTask { request(at, connection) }
        Thread(task, "schedule-http").apply { isDaemon = true }.start()
        try {
            return task.get(DEADLINE_MILLIS, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            task.cancel(true)
            connection.get()?.disconnect()
            throw IOException("일정 받기 데드라인 초과")
        } catch (e: ExecutionException) {
            throw e.cause ?: e
        }
    }

    private fun request(at: Instant, holder: AtomicReference<HttpURLConnection?>): String {
        val query = URLEncoder.encode(at.toString(), "UTF-8")
        val url = URI.create("${baseUrl.trimEnd('/')}/schedules/today?at=$query").toURL()
        val connection = url.openConnection() as HttpURLConnection
        holder.set(connection)
        try {
            connection.connectTimeout = TIMEOUT_MILLIS
            connection.readTimeout = TIMEOUT_MILLIS
            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) throw ScheduleHttpException(status)
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MILLIS = 2_000
        const val DEADLINE_MILLIS = 3_000L
    }
}

/** 마지막으로 받은 응답 본문과 그 기준 날짜. */
data class StoredCopy(val body: String, val date: LocalDate)

/** 마지막으로 받은 응답을 보관하는 곳. 구현은 ChagokStore. */
interface ScheduleCopyStore {
    fun loadCopy(): StoredCopy?
    fun saveCopy(copy: StoredCopy)

    /** 저장해 둔 사본을 지운다(연결이 풀렸을 때: 일정·집 좌표를 차에 남기지 않는다). */
    fun clearCopy()
}

/**
 * 서버에서 받은 오늘 일정을 메모리에 캐시해 주는 [ScheduleSource]. [schedules]는 캐시만 읽어 바로 돌려주고,
 * 네트워크는 [refresh]가 [worker] 스레드에서 한다.
 *
 * - [allowed]가 false(휴대폰과 연결 전)면 서버를 부르지 않고 NONE으로 끝낸다. 받는 도중에 연결이 풀려 false가 되면 그 응답도 버린다.
 * - 받기가 성공하면 응답을 [copies]에 저장하고 [origin]은 FRESH.
 * - 실패하면 같은 날짜의 저장된 사본을 쓰고 [origin]은 STORED. 사본이 없으면 빈 목록과 NONE.
 * - 사본의 '오늘'은 기기 날짜가 아니라 [refresh]에 쓴 기준 시각(anchor, 데모 시계)을 [zone]으로 읽은 날짜다.
 * - [refresh]마다 세대 번호를 매긴다. 마지막 세대가 아닌 받기의 결과는 버리고 [refresh]의 완료 콜백도 부르지 않는다.
 */
class ServerScheduleSource(
    private val fetcher: ScheduleFetcher,
    private val anchor: () -> Instant,
    private val copies: ScheduleCopyStore? = null,
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
    private val logger: Logger = Logger.None,
    private val worker: Executor = Executors.newCachedThreadPool { r -> Thread(r, "schedule-fetch").apply { isDaemon = true } },
    /**
     * 서버에서 일정·집을 받아도 되는가. false면 서버를 부르지 않고(이미 나간 요청의 응답도 쓰지 않고) 받은 적 없음([ScheduleOrigin.NONE])으로 끝낸다.
     * 휴대폰과 연결돼 있지 않은 차가 다른 사람의 일정·집 좌표를 받아 오지 않게 한다. 연결 여부를 따지지 않는 구성(테스트)은 늘 true.
     */
    private val allowed: () -> Boolean = { true },
) : ScheduleSource {
    private val lock = Any()
    private var generation = 0
    private var cache: List<Schedule> = emptyList()
    private var cachedFavorites: List<Favorite> = emptyList()
    private var current = ScheduleOrigin.NONE
    private var cacheDate: LocalDate? = null

    /** 마지막 세대의 받기가 진행 중인가 */
    @Volatile var refreshing: Boolean = false
        private set

    override fun snapshot(): ScheduleSnapshot = synchronized(lock) { ScheduleSnapshot(cache, current, cachedFavorites) }

    /**
     * 받아 둔 일정·자주 가는 곳(집 좌표 포함)과 저장된 사본을 모두 지우고 "받은 적 없음"([ScheduleOrigin.NONE])으로 돌린다. 휴대폰 연결이 풀렸을 때 쓴다.
     * 진행 중인 받기는 건드리지 않는다(세대·완료 알림이 어긋나지 않게). 그 받기가 끝나면 서버가 준 대로 다시 채워진다.
     */
    fun clear() {
        synchronized(lock) {
            cache = emptyList()
            cachedFavorites = emptyList()
            current = ScheduleOrigin.NONE
            cacheDate = null
        }
        runCatching { copies?.clearCopy() }.onFailure { logger.warn(TAG, "일정 사본 지우기 실패", it) }
    }

    /**
     * 기준 시각(anchor)으로 다시 받고 이 받기의 세대 번호를 돌려준다. 마지막 세대가 끝나면(성공·실패 모두)
     * 그 세대 번호로 [onDone]을 받은 스레드에서 부른다.
     */
    fun refresh(onDone: (generation: Int) -> Unit): Int {
        val at = anchor()
        val date = at.atZone(zone()).toLocalDate()
        val mine = synchronized(lock) { ++generation }
        refreshing = true
        worker.execute {
            try {
                val body = if (allowed()) runCatching { fetcher.fetch(at) } else kotlin.Result.failure<String>(NotAllowed())
                val parsed = body.mapCatching { ScheduleParser.parseDay(it) }
                var error = parsed.exceptionOrNull()
                // 받는 동안 연결이 풀렸으면 응답을 쓰지 않는다(풀린 뒤에 집·일정이 되살아나지 않게).
                if (error == null && !allowed()) error = NotAllowed()
                if (error != null && error !is NotAllowed) logger.warn(TAG, "일정 받기 실패: ${describe(error)}", null)
                val result = when {
                    error == null -> Result(parsed.getOrThrow(), ScheduleOrigin.FRESH)
                    error is NotAllowed -> Result(DayResponse(emptyList()), ScheduleOrigin.NONE)
                    else -> fallback(date)
                }
                val applied = synchronized(lock) {
                    (mine == generation).also {
                        if (it) {
                            cache = result.day.schedules
                            cachedFavorites = result.day.favorites
                            current = result.origin
                            if (result.origin == ScheduleOrigin.FRESH) cacheDate = date
                        }
                    }
                }
                if (applied && error == null) body.getOrNull()?.let { saveCopy(StoredCopy(it, date)) }
            } finally {
                val last = synchronized(lock) { (mine == generation).also { if (it) refreshing = false } }
                if (last) onDone(mine)
            }
        }
        return mine
    }

    /** 로그에 남길 실패 설명. 예외 메시지와 응답 본문은 담지 않고 예외 클래스 이름(과 HTTP 상태)만 쓴다. */
    private fun describe(error: Throwable): String =
        (error as? ScheduleHttpException)?.let { "${it::class.simpleName} ${it.status}" } ?: (error::class.simpleName ?: "알 수 없는 예외")

    private class Result(val day: DayResponse, val origin: ScheduleOrigin)

    /** [allowed]가 false라 받지 않았다(실패가 아니다: 로그도 사본 대체도 없다). */
    private class NotAllowed : IOException("연결 전이라 일정을 받지 않음")

    /** 받기 실패 때 쓸 일정과 자주 가는 곳. 같은 날짜의 사본(메모리 캐시, 없으면 저장된 것)이 있으면 STORED. */
    private fun fallback(date: LocalDate): Result {
        synchronized(lock) { if (cacheDate == date) return Result(DayResponse(cache, cachedFavorites), ScheduleOrigin.STORED) }
        val stored = runCatching { copies?.loadCopy() }.getOrNull()
        if (stored != null && stored.date == date) {
            runCatching { ScheduleParser.parseDay(stored.body) }.getOrNull()?.let { return Result(it, ScheduleOrigin.STORED) }
        }
        return Result(DayResponse(emptyList()), ScheduleOrigin.NONE)
    }

    private fun saveCopy(copy: StoredCopy) {
        runCatching { copies?.saveCopy(copy) }.onFailure { logger.warn(TAG, "일정 사본 저장 실패", it) }
    }

    private companion object {
        const val TAG = "ChagokSchedules"
    }
}
