package com.chagok.car.flow

import com.chagok.car.FixtureFile
import com.chagok.car.FixtureResponses
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class ServerScheduleSourceTest {
    private val anchor = Instant.parse("2026-11-06T00:20:00Z")
    private val fixture = FixtureFile.read("schedules/gwangju-day.json")
    private val sameThread = Executor { it.run() }
    private val sockets = mutableListOf<ServerSocket>()

    @Volatile private var requestLine: String? = null

    @After fun tearDown() {
        sockets.forEach { it.close() }
    }

    private class MemoryCopies(var copy: StoredCopy? = null) : ScheduleCopyStore {
        override fun loadCopy() = copy
        override fun saveCopy(copy: StoredCopy) {
            this.copy = copy
        }
    }

    private val seoul = ZoneId.of("Asia/Seoul")
    private val today = LocalDate.of(2026, 11, 6)

    private fun source(fetcher: ScheduleFetcher, copies: MemoryCopies? = null, worker: Executor = sameThread) =
        ServerScheduleSource(fetcher, { anchor }, copies, { seoul }, Logger.None, worker)

    @Test fun `받기 전에는 빈 목록이고 받으면 캐시하고 사본을 저장한다`() {
        val asked = mutableListOf<Instant>()
        val copies = MemoryCopies()
        val source = source({ at -> asked += at; FixtureResponses.response(fixture, at) }, copies)
        assertEquals(emptyList<Any>(), source.snapshot().schedules)
        assertEquals(ScheduleOrigin.NONE, source.snapshot().origin)

        var done = false
        source.refresh { done = true }
        assertTrue(done)
        assertEquals(ScheduleOrigin.FRESH, source.snapshot().origin)
        assertEquals(listOf(anchor), asked)
        assertEquals(5, source.snapshot().schedules.size)
        assertEquals(today, copies.copy?.date)
    }

    @Test fun `처음부터 실패하고 사본도 없으면 빈 목록과 NONE이고 받기 완료는 알린다`() {
        val source = source({ error("서버 꺼짐") })
        var done = false
        source.refresh { done = true }
        assertTrue(done)
        assertEquals(ScheduleOrigin.NONE, source.snapshot().origin)
        assertEquals(emptyList<Any>(), source.snapshot().schedules)
    }

    @Test fun `실패하면 저장된 오늘 사본을 쓰고 STORED로 알린다`() {
        val copies = MemoryCopies(StoredCopy(FixtureResponses.response(fixture, anchor), today))
        val source = source({ error("서버 꺼짐") }, copies)
        source.refresh {}
        assertEquals(ScheduleOrigin.STORED, source.snapshot().origin)
        assertEquals(5, source.snapshot().schedules.size)
    }

    @Test fun `저장된 사본이 오늘 것이 아니면 쓰지 않는다`() {
        val copies = MemoryCopies(StoredCopy(FixtureResponses.response(fixture, anchor), today.minusDays(1)))
        val source = source({ error("서버 꺼짐") }, copies)
        source.refresh {}
        assertEquals(ScheduleOrigin.NONE, source.snapshot().origin)
        assertEquals(emptyList<Any>(), source.snapshot().schedules)
    }

    @Test fun `저장된 사본이 깨졌으면 NONE이다`() {
        val source = source({ error("서버 꺼짐") }, MemoryCopies(StoredCopy("<html>", today)))
        source.refresh {}
        assertEquals(ScheduleOrigin.NONE, source.snapshot().origin)
    }

    @Test fun `성공한 뒤 잘못된 응답이 오면 이전 캐시를 STORED로 남긴다`() {
        var body = FixtureResponses.response(fixture, anchor)
        val source = source({ body })
        source.refresh {}
        assertEquals(5, source.snapshot().schedules.size)

        body = "<html>오류</html>"
        source.refresh {}
        assertEquals(ScheduleOrigin.STORED, source.snapshot().origin)
        assertEquals(5, source.snapshot().schedules.size)
    }

    @Test fun `서버가 빈 일정을 주면 FRESH이고 비어 있다`() {
        val source = source({ """{"anchor":"2026-11-06T00:20:00Z","schedules":[]}""" })
        source.refresh {}
        assertEquals(ScheduleOrigin.FRESH, source.snapshot().origin)
        assertEquals(emptyList<Any>(), source.snapshot().schedules)
    }

    @Test fun `받기가 겹치면 마지막 세대만 반영하고 완료는 한 번만 알린다`() {
        // 첫 받기는 느려서 두 번째 받기가 끝난 뒤에 끝난다(실행기에서 실행을 늦춘다).
        val queue = ArrayDeque<Runnable>()
        val delayed = Executor { queue.addLast(it) }
        var answer = "첫째"
        val source = source(
            { at ->
                val label = answer
                if (label == "첫째") FixtureResponses.response(fixture, at) else """{"anchor":"2026-11-06T00:20:00Z","schedules":[]}"""
            },
            worker = delayed,
        )
        var done = 0
        source.refresh { done++ } // 세대 1
        assertTrue(source.refreshing)
        answer = "둘째"
        source.refresh { done++ } // 세대 2
        assertEquals(2, queue.size)

        // 세대 2가 먼저 끝난다.
        queue.removeLast().run()
        assertEquals(1, done)
        assertFalse(source.refreshing)
        assertEquals(emptyList<Any>(), source.snapshot().schedules)

        // 늦게 끝난 세대 1의 결과는 버린다.
        answer = "첫째"
        queue.removeFirst().run()
        assertEquals(1, done)
        assertEquals(emptyList<Any>(), source.snapshot().schedules)
        assertEquals(ScheduleOrigin.FRESH, source.snapshot().origin)
    }

    @Test fun `이전 세대가 아직 도는 동안은 받는 중으로 본다`() {
        val queue = ArrayDeque<Runnable>()
        val source = source({ FixtureResponses.response(fixture, anchor) }, worker = { queue.addLast(it) })
        source.refresh {}
        source.refresh {}
        queue.removeFirst().run() // 세대 1이 먼저 끝나도
        assertTrue(source.refreshing) // 마지막 세대가 끝나지 않았다
        queue.removeFirst().run()
        assertFalse(source.refreshing)
    }

    @Test fun `받기 중 예외가 새도 마지막 세대는 완료를 알린다`() {
        val failing = Logger { _, _, _ -> throw IllegalStateException("로거 실패") }
        val source = ServerScheduleSource({ error("서버 꺼짐") }, { anchor }, null, { seoul }, failing, sameThread)
        var done = false
        runCatching { source.refresh { done = true } }
        assertTrue(done)
        assertFalse(source.refreshing)
    }

    /** 요청 한 건에 정해진 상태와 본문으로 답하는 최소 HTTP 서버. 받은 요청 줄을 [requestLine]에 남긴다. */
    private fun serve(status: Int, body: String): Int {
        val socket = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).also { sockets += it }
        thread(isDaemon = true) {
            socket.accept().use { client ->
                val reader = client.getInputStream().bufferedReader()
                requestLine = reader.readLine()
                while (reader.readLine().orEmpty().isNotEmpty()) Unit
                val bytes = body.toByteArray()
                client.getOutputStream().apply {
                    write("HTTP/1.1 $status X\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    write(bytes)
                    flush()
                }
            }
        }
        return socket.localPort
    }

    @Test fun `HTTP 200이면 본문을 돌려주고 at을 쿼리로 보낸다`() {
        val port = serve(200, FixtureResponses.response(fixture, anchor))
        val body = HttpScheduleFetcher("http://127.0.0.1:$port").fetch(anchor)
        assertEquals("GET /schedules/today?at=2026-11-06T00%3A20%3A00Z HTTP/1.1", requestLine)
        assertEquals(5, ScheduleParser.parse(body).size)
    }

    @Test fun `실패 로그에는 예외 클래스 이름과 HTTP 상태만 남고 메시지와 본문은 남지 않는다`() {
        val logs = mutableListOf<Triple<String, String, Throwable?>>()
        val logger = Logger { tag, message, error -> logs += Triple(tag, message, error) }

        ServerScheduleSource({ error("일정 본문 비밀-SECRET") }, { anchor }, null, { seoul }, logger, sameThread).refresh {}
        ServerScheduleSource({ throw ScheduleHttpException(503) }, { anchor }, null, { seoul }, logger, sameThread).refresh {}
        ServerScheduleSource({ "비밀-SECRET <html>" }, { anchor }, null, { seoul }, logger, sameThread).refresh {}

        assertEquals(3, logs.size)
        assertTrue(logs.all { it.third == null })
        assertTrue(logs.none { it.second.contains("SECRET") })
        assertTrue(logs[0].second.contains("IllegalStateException"))
        assertTrue(logs[1].second.contains("ScheduleHttpException 503"))
    }

    @Test fun `HTTP 200이 아니면 상태를 담은 예외다`() {
        val port = serve(503, "<html>본문</html>")
        val error = runCatching { HttpScheduleFetcher("http://127.0.0.1:$port").fetch(anchor) }.exceptionOrNull()
        assertEquals(503, (error as ScheduleHttpException).status)
        assertFalse(error.message.orEmpty().contains("본문"))
    }

    @Test fun `응답이 조금씩 계속 와도 전체 데드라인을 넘기면 끊는다`() {
        val socket = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).also { sockets += it }
        thread(isDaemon = true) {
            runCatching {
                socket.accept().use { client ->
                    val reader = client.getInputStream().bufferedReader()
                    while (reader.readLine().orEmpty().isNotEmpty()) Unit
                    val out = client.getOutputStream()
                    out.write("HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n".toByteArray())
                    // 읽기 제한(2초)보다 짧은 간격으로 계속 보낸다.
                    repeat(40) { out.write('x'.code); out.flush(); Thread.sleep(300) }
                }
            }
        }
        val begin = System.nanoTime()
        val result = runCatching { HttpScheduleFetcher("http://127.0.0.1:${socket.localPort}").fetch(anchor) }
        val elapsedMs = (System.nanoTime() - begin) / 1_000_000
        assertTrue(result.isFailure)
        assertTrue("데드라인 안에 끊겨야 함: ${elapsedMs}ms", elapsedMs < 4_500)
    }

    @Test fun `기본 실행기는 호출한 스레드가 아닌 곳에서 받는다`() {
        val latch = CountDownLatch(1)
        var thread: String? = null
        val source = ServerScheduleSource({ thread = Thread.currentThread().name; FixtureResponses.response(fixture, it) }, { anchor })
        source.refresh { latch.countDown() }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertEquals("schedule-fetch", thread)
    }

    private val favoritesJson = org.json.JSONArray(
        """[{"kind":"home","name":"예시 아파트 101동","address":"광주 북구 샘플로 12","lat":35.1743,"lng":126.9121}]""",
    )
    private val home = Favorite(FavoriteKind.HOME, Place("예시 아파트 101동", LatLng(35.1743, 126.9121)), "광주 북구 샘플로 12")

    @Test fun `같은 응답의 자주 가는 곳을 함께 캐시하고 실패하면 사본의 것을 쓴다`() {
        val copies = MemoryCopies()
        val ok = source({ at -> FixtureResponses.response(fixture, at, favorites = favoritesJson) }, copies)
        ok.refresh {}
        assertEquals(listOf(home), ok.snapshot().favorites)

        // 같은 인스턴스에서 실패하면 메모리 캐시, 새 인스턴스면 저장된 사본에서 같은 목록을 쓴다.
        val failing = source({ error("서버 꺼짐") }, copies)
        failing.refresh {}
        assertEquals(ScheduleOrigin.STORED, failing.snapshot().origin)
        assertEquals(listOf(home), failing.snapshot().favorites)
    }

    @Test fun `받은 적도 사본도 없으면 자주 가는 곳도 없다`() {
        val source = source({ error("서버 꺼짐") })
        source.refresh {}
        assertEquals(emptyList<Favorite>(), source.snapshot().favorites)
    }
}
