package com.chagok.car.flow

import com.chagok.car.domain.EnergyKind
import com.chagok.car.domain.EnergyNeed
import com.chagok.car.domain.EnergyOptions
import com.chagok.car.domain.EnergyStop
import com.chagok.car.domain.EnergyStopKind
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.Gear
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import com.chagok.car.domain.Rules
import com.chagok.car.domain.Schedule
import com.chagok.car.runtime.SnapshotCodec
import com.chagok.car.ui.TileView
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 에너지 체크(정책서 5장·9장, 계약은 docs/energy.md): 출발 제안을 낼 때 필요 거리가 주행 가능 거리의 90%를 넘으면
 * 서버에 충전·주유 후보를 묻고 출발 제안을 충전·주유 제안 하나로 바꾼다.
 */
class DriveSessionEnergyTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    private val start = Instant.parse("2026-12-03T00:00:00Z")
    private val clock = MutableClock(start)
    private lateinit var schedules: List<Schedule>
    private var favorites: List<Favorite> = emptyList()
    private lateinit var session: DriveSession

    private val gangnam = Place("강남역", LatLng(37.4979, 127.0276))
    private val cityHall = Place("서울시청", LatLng(37.5663, 126.9779))

    /** 집은 멀다(부산). 지금 위치는 수도권 남쪽(일정 장소에서 300m 넘게 떨어짐). */
    private val busanHome = Favorite(FavoriteKind.HOME, Place("집", LatLng(35.1796, 129.0756)))
    private val here = LatLng(37.30, 127.00)

    private val charger = EnergyStop("EX-1", EnergyStopKind.SLOW_CHARGER, Place("예시 강남 충전소", LatLng(37.498, 127.028)), availableCount = 2, totalCount = 3, powerKw = 7)
    private val chargerB = EnergyStop("EX-2", EnergyStopKind.FAST_CHARGER, Place("예시 양재 휴게소", LatLng(37.47, 127.04)), availableCount = 1, totalCount = 2, powerKw = 100)
    private val gas = EnergyStop("EX-FS-1", EnergyStopKind.GAS_STATION, Place("예시 서구 알뜰주유소", LatLng(37.45, 127.02)), priceWon = 1639, priceFuel = "gasoline")

    private fun schedule(id: String, title: String, startMin: Long, place: Place?, lengthMin: Long = 60) = Schedule(
        id = id,
        title = title,
        start = start + Duration.ofMinutes(startMin),
        end = start + Duration.ofMinutes(startMin + lengthMin),
        place = place,
    )

    @Before
    fun setUp() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam), schedule("b", "점심 약속", 180, cityHall))
        favorites = listOf(busanHome)
        newSession()
    }

    private fun newSession(restored: Snapshot? = null, gear: Gear? = Gear.PARK) {
        session = DriveSession(clock, { ScheduleSnapshot(schedules, favorites = favorites) }, restored)
        gear?.let { session.handle(Event.GearChanged(it)) }
    }

    private inline fun <reified T : Effect> List<Effect>.one(): T = filterIsInstance<T>().single()
    private inline fun <reified T : Effect> List<Effect>.has() = any { it is T }
    private fun List<Effect>.card() = filterIsInstance<Effect.ShowCard>().last().card

    /** 연료 종류·주행 가능 거리·지금 위치를 알린다. */
    private fun know(kind: EnergyKind? = EnergyKind.EV, range: Double? = 150.0, at: LatLng? = here, battery: Double? = 45.0) {
        session.handle(Event.EnergyChanged(kind, range, battery))
        at?.let { session.handle(Event.LocationChanged(it)) }
    }

    /** 탑승 → 소요 시간 응답까지 진행한다(카드나 에너지 후보 요청이 나온다). */
    private fun boardAndTravel(): List<Effect> {
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        return session.handle(Event.TravelTimeResult(request.requestId, null))
    }

    private fun answer(options: EnergyOptions?, request: Effect.RequestEnergyOptions) =
        session.handle(Event.EnergyOptionsResult(request.requestId, options))

    /** 에너지 후보를 물어 [options]로 답하고 카드까지 진행한다. */
    private fun energyCard(options: EnergyOptions = EnergyOptions(listOf(charger))): List<Effect> {
        val ask = boardAndTravel().one<Effect.RequestEnergyOptions>()
        return answer(options, ask)
    }

    /** 달린 뒤 P단에 넣고 10분이 지나게 둔다(잠깐 정차가 아닌 다시 탑승). 위치는 달리기 시작할 때 버려지므로 다시 알린다. */
    private fun driveAndPark() {
        session.handle(Event.GearChanged(Gear.DRIVE))
        clock.now += Duration.ofMinutes(15)
        session.handle(Event.GearChanged(Gear.PARK))
        clock.now += Duration.ofMinutes(11)
        session.handle(Event.LocationChanged(here))
    }

    private fun neededKm(): Int =
        EnergyNeed.of(here, listOf(gangnam.position, cityHall.position), busanHome.place.position)!!.spokenKm

    @Test
    fun 전기차가_모자라면_후보를_묻고_카드는_답까지_미룬다() {
        know()
        val out = boardAndTravel()
        val judged = out.one<Effect.EnergyJudged>()
        assertTrue(judged.short)
        assertEquals(150.0, judged.rangeKm, 0.0)
        val ask = out.one<Effect.RequestEnergyOptions>()
        assertEquals(EnergyKind.EV, ask.request.fuel)
        assertEquals(here, ask.request.origin)
        assertEquals(gangnam.position, ask.request.destination)
        // 대상 일정이 머무는 시간(전기차만): 60분
        assertEquals(Duration.ofMinutes(60), ask.request.stay)
        assertTrue("답을 받기 전에는 카드도 말도 없다", out.none { it is Effect.ShowCard || it is Effect.Speak })
    }

    @Test
    fun 전기차_에너지_제안_문구와_버튼() {
        know()
        val out = energyCard()
        val card = out.card()
        // 큰 문구는 대상 일정 안내, 그 아래가 충전 제안(별칭이 없는 장소는 이름), '집까지 N km'는 배터리 타일의 이유 한 줄이다.
        assertEquals("다음은 12시 40분 고객 미팅이에요.", card.voice)
        assertEquals("강남역에서 걸어서 1분 거리에 빈 완속 충전기가 있어요. 머무는 동안 충전할까요?", card.sub)
        assertEquals("응, 거기로", card.primary)
        assertEquals("그냥 강남역으로", card.secondary)
        assertEquals(listOf(Phrases.HINT_SAY_YES, Phrases.HINT_AUTO_FOLD), card.hints)
        assertEquals(Phrases.STATUS_BEFORE_DEPARTURE, card.status)
        assertEquals(
            listOf(
                TileView.EnergyStop("예시 강남 충전소", "지금 비어 있음", "완속 2대", "강남역까지 걸어서 1분", "충전기 현황 · 환경부 충전소 정보"),
                TileView.EnergyLevel("배터리", "45%", "· 갈 수 있는 거리 150km", "집까지 ${neededKm()}km라 한 번 충전이 필요해요"),
            ),
            card.tiles,
        )
        val speak = out.one<Effect.Speak>()
        assertTrue(speak.thenListen)
        assertEquals("${card.voice} ${card.sub}", speak.text)
        assertEquals(Rules.CARD_TIMEOUT, out.one<Effect.ScheduleCardTimeout>().delay)
    }

    @Test
    fun 필요_거리_숫자는_반올림한_값이_배터리_타일_이유에_들어간다() {
        know()
        val reason = (energyCard().card().tiles[1] as TileView.EnergyLevel).reason
        // 지금 위치 → 강남역 → 서울시청 → 부산 집
        assertTrue(reason, reason.startsWith("집까지 ${neededKm()}km라"))
        assertTrue(neededKm() > 400)
    }

    @Test
    fun 배터리_잔량을_모르면_타일은_퍼센트_없이_갈_수_있는_거리만_보인다() {
        know(battery = null)
        val tile = energyCard().card().tiles[1] as TileView.EnergyLevel
        assertNull(tile.percent)
        assertEquals("갈 수 있는 거리 150km", tile.level)
    }

    @Test
    fun 범위_밖_잔량은_모름으로_본다() {
        know(battery = 120.0)
        assertNull((energyCard().card().tiles[1] as TileView.EnergyLevel).percent)
    }

    @Test
    fun 기름_차는_기름이_모자라다고_주유소를_묻는다() {
        know(EnergyKind.GASOLINE)
        val ask = boardAndTravel().one<Effect.RequestEnergyOptions>()
        assertEquals(EnergyKind.GASOLINE, ask.request.fuel)
        assertNull("머무는 시간은 전기차에만 보낸다", ask.request.stay)
        val card = answer(EnergyOptions(listOf(gas)), ask).card()
        assertEquals("다음은 12시 40분 고객 미팅이에요.", card.voice)
        assertEquals("예시 서구 알뜰주유소에서 넣고 갈까요?", card.sub)
        assertEquals("응, 들렀다 가요", card.primary)
        assertEquals("그냥 강남역으로", card.secondary)
        assertEquals("휘발유 1,639원/L", (card.tiles.first() as TileView.EnergyStop).detail)
        assertEquals(TileView.EnergyLevel("연료", "45%", "· 갈 수 있는 거리 150km", "집까지 ${neededKm()}km라 주유가 필요해요"), card.tiles[1])
    }

    @Test
    fun 하이브리드도_기름_문구다() {
        know(EnergyKind.HYBRID)
        val ask = boardAndTravel().one<Effect.RequestEnergyOptions>()
        assertEquals(EnergyKind.HYBRID, ask.request.fuel)
        assertEquals("연료", (answer(EnergyOptions(listOf(gas)), ask).card().tiles[1] as TileView.EnergyLevel).title)
    }

    @Test
    fun 집이_없으면_오늘_일정까지로_말한다() {
        favorites = emptyList()
        // 지금 위치 → 강남역 → 서울시청은 짧아(약 40km) 모자라려면 주행 가능 거리가 아주 짧아야 한다.
        know(range = 10.0)
        val card = energyCard().card()
        val km = EnergyNeed.of(here, listOf(gangnam.position, cityHall.position), null)!!.spokenKm
        assertEquals("오늘 일정까지 ${km}km라 한 번 충전이 필요해요", (card.tiles[1] as TileView.EnergyLevel).reason)
    }

    @Test
    fun 식사_묶음이면_식사하면서_충전을_묻는다() {
        know()
        val card = energyCard(EnergyOptions(listOf(chargerB, charger), mealBundle = true)).card()
        assertEquals("예시 양재 휴게소에서 식사하면서 충전하고 갈까요?", card.sub)
        assertEquals("응, 들렀다 가요", card.primary)
        assertEquals(TileView.EnergyStop("예시 양재 휴게소", "지금 비어 있음", "급속 1대", "가는 길에 있어요", "충전기 현황 · 환경부 충전소 정보"), card.tiles.first())
    }

    @Test
    fun 충전기_상태가_낡았으면_빈_곳을_말하지_않고_확인_문구를_붙인다() {
        know()
        val card = energyCard(EnergyOptions(listOf(charger), stale = true)).card()
        val tile = card.tiles.first() as TileView.EnergyStop
        assertNull(tile.badge)
        assertEquals("완속", tile.detail)
        assertEquals("강남역에서 걸어서 1분 거리에 완속 충전기가 있어요. 머무는 동안 충전할까요?", card.sub)
        assertEquals(Phrases.ENERGY_STALE, card.footnote)
    }

    @Test
    fun 완속_충전소_수락은_충전소를_목적지로_길안내하고_안내할게요라고_알린다() {
        know()
        energyCard()
        val out = session.handle(Event.Heard("응"))
        val route = out.one<Effect.StartRoute>()
        assertEquals("경유지가 아니라 충전소가 목적지", charger.place, route.place)
        assertNull(route.via)
        val result = session.handle(Event.RouteRequestResult(true))
        assertEquals("예시 강남 충전소로 안내할게요.", result.one<Effect.ShowResult>().text)
        assertEquals("예시 강남 충전소로 안내할게요.", result.one<Effect.Speak>().text)
    }

    @Test
    fun 경로상_급속_수락은_경유지로_넣어_대상_일정으로_길안내하고_들렀다_간다고_알린다() {
        know()
        energyCard(EnergyOptions(listOf(chargerB)))
        val route = session.handle(Event.Heard("응")).one<Effect.StartRoute>()
        assertEquals(gangnam, route.place)
        assertEquals(chargerB.place, route.via)
        assertEquals("예시 양재 휴게소 들렀다 갈게요.", session.handle(Event.RouteRequestResult(true)).one<Effect.ShowResult>().text)
    }

    @Test
    fun 주유_수락도_경유지다() {
        know(EnergyKind.GASOLINE)
        val ask = boardAndTravel().one<Effect.RequestEnergyOptions>()
        answer(EnergyOptions(listOf(gas)), ask)
        val route = session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        assertEquals(gangnam, route.place)
        assertEquals(gas.place, route.via)
        assertEquals("예시 서구 알뜰주유소 들렀다 갈게요.", session.handle(Event.RouteRequestResult(true)).one<Effect.ShowResult>().text)
    }

    @Test
    fun 주_버튼도_같은_수락이다() {
        know()
        energyCard()
        val route = session.handle(Event.PrimaryPressed).one<Effect.StartRoute>()
        assertEquals(charger.place, route.place)
        assertNull(route.via)
    }

    @Test
    fun 보조_버튼은_충전_없이_원래_장소로_길안내한다() {
        know()
        energyCard()
        val out = session.handle(Event.SecondaryPressed)
        val route = out.one<Effect.StartRoute>()
        assertEquals(gangnam, route.place)
        assertNull(route.via)
        assertTrue("카드가 접힌다", out.has<Effect.CollapseCard>())
        // 평소 길안내와 같은 결과 한 줄
        assertEquals(Phrases.ROUTE_STARTED, session.handle(Event.RouteRequestResult(true)).one<Effect.ShowResult>().text)
    }

    @Test
    fun 아니와_그냥_가도_충전_없이_원래_장소로_길안내한다() {
        for (said in listOf("아니", "그냥 가", "그냥 강남역으로")) {
            newSession()
            know()
            energyCard()
            val route = session.handle(Event.Heard(said)).one<Effect.StartRoute>()
            assertEquals(said, gangnam, route.place)
            assertNull(said, route.via)
        }
    }

    @Test
    fun 다른_데는_다음_후보_하나로_바꿔_다시_묻는다() {
        know()
        energyCard(EnergyOptions(listOf(charger, chargerB)))
        val out = session.handle(Event.Heard("다른 데"))
        val card = out.card()
        assertEquals("예시 양재 휴게소에서 충전하고 갈까요?", card.sub)
        assertEquals("카드의 큰 문구는 그대로", "다음은 12시 40분 고객 미팅이에요.", card.voice)
        assertEquals("응, 들렀다 가요", card.primary)
        assertTrue(out.one<Effect.Speak>().thenListen)
        assertEquals(chargerB.place, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().via)
    }

    @Test
    fun 후보가_없으면_다른_곳은_찾지_못했어요를_알린다() {
        know()
        energyCard(EnergyOptions(listOf(charger)))
        val out = session.handle(Event.Heard("다른 데"))
        assertEquals(Phrases.NO_ALTERNATIVE, out.card().notice)
        assertEquals(Phrases.NO_ALTERNATIVE, out.one<Effect.Speak>().text)
        assertTrue(out.none { it is Effect.StartRoute })
        // 카드는 그대로라 원래 후보로 수락할 수 있다(완속 충전소는 목적지)
        assertEquals(charger.place, session.handle(Event.PrimaryPressed).one<Effect.StartRoute>().place)
    }

    @Test
    fun 후보를_다_쓰면_서버를_다시_부르지_않는다() {
        know()
        energyCard(EnergyOptions(listOf(charger, chargerB)))
        session.handle(Event.Heard("다른 데"))
        val out = session.handle(Event.Heard("다른 데"))
        assertEquals(Phrases.NO_ALTERNATIVE, out.card().notice)
        assertTrue(out.none { it is Effect.RequestEnergyOptions })
    }

    @Test
    fun 잠깐만은_카드를_둔_채_기다린다() {
        know()
        energyCard()
        val out = session.handle(Event.Heard("잠깐만"))
        assertTrue(out.none { it is Effect.CollapseCard || it is Effect.StartRoute })
        assertTrue(out.has<Effect.ScheduleCardTimeout>())
    }

    @Test
    fun 충전_없이_간_날은_다시_탑승해도_에너지를_묻지_않는다() {
        know()
        energyCard()
        session.handle(Event.Heard("아니"))
        driveAndPark()
        val out = boardAndTravel()
        assertTrue("서버를 다시 부르지 않는다", out.none { it is Effect.RequestEnergyOptions })
        val card = out.card()
        assertTrue(card.sub!!, card.sub!!.endsWith("출발할까요?"))
        assertFalse("그날 이미 물었으니 문장도 더 붙이지 않는다", card.sub!!.contains("모자랄"))
    }

    @Test
    fun 주행_가능_거리가_다시_넉넉해지면_그날의_표시를_풀어_다시_묻는다() {
        know()
        energyCard()
        session.handle(Event.Heard("아니"))
        driveAndPark()
        // 충전해서 넉넉해졌다가 다시 모자라짐
        session.handle(Event.EnergyChanged(EnergyKind.EV, 900.0))
        session.handle(Event.EnergyChanged(EnergyKind.EV, 150.0))
        session.handle(Event.LocationChanged(here))
        assertTrue("다시 모자라지면 다시 묻는다", boardAndTravel().has<Effect.RequestEnergyOptions>())
    }

    @Test
    fun 에너지_제안을_띄우면_표시가_저장되고_날이_바뀌면_지워진다() {
        know()
        val shown = energyCard()
        val snapshot = shown.filterIsInstance<Effect.Save>().last().snapshot
        assertTrue(snapshot.energyOffered)
        val saved = SnapshotCodec.decode(SnapshotCodec.encode(snapshot))!!
        assertTrue(saved.energyOffered)
        // 프로세스를 다시 띄워도 그날은 다시 묻지 않는다
        newSession(restored = saved)
        know()
        assertTrue(boardAndTravel().none { it is Effect.RequestEnergyOptions })
        // 날이 바뀐 뒤 다시 뜨면 지난 날의 표시라 지우고 새 날에는 다시 묻는다
        clock.now += Duration.ofDays(1)
        schedules = listOf(schedule("c", "다음 날 미팅", 24 * 60 + 40, gangnam))
        newSession(restored = saved)
        know()
        assertTrue(boardAndTravel().has<Effect.RequestEnergyOptions>())
    }

    @Test
    fun 서버가_실패하면_원래_출발_제안에_한_문장과_배터리_타일만_붙인다() {
        know()
        val ask = boardAndTravel().one<Effect.RequestEnergyOptions>()
        val card = answer(null, ask).card()
        assertEquals("배터리가 모자랄 수 있어요. 출발할까요?", card.sub)
        assertEquals("응, 출발", card.primary)
        assertEquals("잠깐만", card.secondary)
        assertTrue(card.tiles.none { it is TileView.EnergyStop })
        assertEquals("12시 40분 고객 미팅까지 40분이에요.", card.voice)
        // 배터리 타일이 이유 한 줄과 함께 앞에 서고 오늘 일정 타일이 이어진다
        assertEquals(TileView.EnergyLevel("배터리", "45%", "· 갈 수 있는 거리 150km", "집까지 ${neededKm()}km라 한 번 충전이 필요해요"), card.tiles[0])
        assertTrue(card.tiles[1] is TileView.Schedules)
    }

    @Test
    fun 후보가_0개여도_한_문장만_붙인다_기름_차는_기름_문구() {
        know(EnergyKind.DIESEL)
        val ask = boardAndTravel().one<Effect.RequestEnergyOptions>()
        val card = answer(EnergyOptions(emptyList()), ask).card()
        assertEquals("기름이 모자랄 수 있어요. 출발할까요?", card.sub)
    }

    @Test
    fun 지금_위치를_모르면_서버를_부르지_않고_한_문장만_붙인다() {
        know(at = null)
        val out = boardAndTravel()
        assertTrue(out.has<Effect.EnergyJudged>())
        assertTrue(out.none { it is Effect.RequestEnergyOptions })
        assertEquals("배터리가 모자랄 수 있어요. 출발할까요?", out.card().sub)
    }

    @Test
    fun 한_문장은_메모_문장_뒤_출발_질문_앞에_붙는다() {
        schedules = listOf(schedule("a", "고객 미팅", 40, gangnam).copy(memo = "계약서 2부"), schedule("b", "점심 약속", 180, cityHall))
        newSession()
        know(at = null)
        assertEquals("고객 미팅 메모에 ‘계약서 2부’가 있어요. 배터리가 모자랄 수 있어요. 출발할까요?", boardAndTravel().card().sub)
    }

    @Test
    fun 연료_종류나_주행_가능_거리를_모르면_에너지_체크를_하지_않는다() {
        for ((kind, range) in listOf(null to 150.0, EnergyKind.EV to null, null to null)) {
            newSession()
            know(kind, range)
            val out = boardAndTravel()
            assertTrue("kind=$kind range=$range", out.none { it is Effect.EnergyJudged || it is Effect.RequestEnergyOptions })
            assertEquals("12시 40분 고객 미팅까지 40분이에요.", out.card().voice)
        }
    }

    @Test
    fun 음수나_NaN_주행_가능_거리는_모름이다() {
        know(range = -5.0)
        assertTrue(boardAndTravel().none { it is Effect.EnergyJudged })
        newSession()
        know(range = Double.NaN)
        assertTrue(boardAndTravel().none { it is Effect.EnergyJudged })
    }

    @Test
    fun 넉넉하면_판단_로그만_남기고_출발_제안_그대로다() {
        know(range = 5_000.0)
        val out = boardAndTravel()
        assertFalse(out.one<Effect.EnergyJudged>().short)
        assertTrue(out.none { it is Effect.RequestEnergyOptions })
        assertEquals("출발할까요?", out.card().sub)
    }

    @Test
    fun 필요_거리가_주행_가능_거리의_90퍼센트_근처에서_갈린다() {
        know()
        val need = EnergyNeed.of(here, listOf(gangnam.position, cityHall.position), busanHome.place.position)!!.km
        // 90%선 바로 위(필요 거리가 주행 가능 거리의 89%)면 모자라지 않고, 바로 아래(91%)면 모자라다.
        session.handle(Event.EnergyChanged(EnergyKind.EV, need / 0.89))
        assertTrue(boardAndTravel().none { it is Effect.RequestEnergyOptions })
        newSession()
        know(range = need / 0.91)
        assertTrue(boardAndTravel().has<Effect.RequestEnergyOptions>())
    }

    @Test
    fun 답을_기다리는_동안_다른_탑승_신호는_무시한다() {
        know()
        boardAndTravel().one<Effect.RequestEnergyOptions>()
        assertEquals(emptyList<Effect>(), session.handle(Event.Boarded))
    }

    @Test
    fun 주행_중에는_말도_카드도_없다() {
        know()
        val ask = boardAndTravel().one<Effect.RequestEnergyOptions>()
        session.handle(Event.GearChanged(Gear.DRIVE))
        val out = answer(EnergyOptions(listOf(charger)), ask)
        assertTrue(out.none { it is Effect.ShowCard || it is Effect.Speak })
    }

    @Test
    fun 주행_중에_탑승_신호가_와도_후보를_묻지_않는다() {
        know()
        session.handle(Event.GearChanged(Gear.DRIVE))
        val out = session.handle(Event.Boarded)
        assertTrue(out.none { it is Effect.RequestEnergyOptions || it is Effect.ShowCard })
    }

    @Test
    fun 낡은_요청_번호의_답은_무시한다() {
        know()
        val ask = boardAndTravel().one<Effect.RequestEnergyOptions>()
        val out = session.handle(Event.EnergyOptionsResult(ask.requestId + 99, EnergyOptions(listOf(charger))))
        assertTrue(out.none { it is Effect.ShowCard })
        // 진짜 답은 그대로 받는다
        assertNotNull(answer(EnergyOptions(listOf(charger)), ask).card())
    }

    @Test
    fun 재탑승_한_줄에도_에너지_제안을_한다() {
        // 첫 탑승은 넉넉했다
        know(range = 5_000.0)
        assertTrue(boardAndTravel().has<Effect.ShowCard>())
        session.handle(Event.Heard("아니"))
        driveAndPark()
        // 이제 모자라다
        session.handle(Event.EnergyChanged(EnergyKind.EV, 150.0, 45.0))
        session.handle(Event.LocationChanged(here))
        val card = energyCard().card()
        assertEquals("다음은 12시 40분 고객 미팅이에요.", card.voice)
        assertEquals("강남역에서 걸어서 1분 거리에 빈 완속 충전기가 있어요. 머무는 동안 충전할까요?", card.sub)
        // 재탑승도 후보 타일 + 배터리 타일 두 칸이다
        assertEquals(2, card.tiles.size)
        assertTrue(card.tiles[0] is TileView.EnergyStop)
        assertTrue(card.tiles[1] is TileView.EnergyLevel)
    }

    @Test
    fun 첫_탑승_브리핑에서도_큰_문구는_대상_일정_안내이고_타일은_후보와_배터리다() {
        know()
        val card = energyCard().card()
        assertEquals("다음은 12시 40분 고객 미팅이에요.", card.voice)
        assertEquals(2, card.tiles.size)
        assertTrue(card.tiles[0] is TileView.EnergyStop)
        assertTrue(card.tiles[1] is TileView.EnergyLevel)
    }

    @Test
    fun 늦게_탐은_에너지_제안으로_바꾸지_않는다() {
        know()
        // 지금이 일정 시작보다 30분 늦고 소요 시간 10분: 늦게 탐
        clock.now = start + Duration.ofMinutes(70)
        val request = session.handle(Event.Boarded).one<Effect.RequestTravelTime>()
        val out = session.handle(Event.TravelTimeResult(request.requestId, Duration.ofMinutes(10)))
        assertTrue(out.none { it is Effect.RequestEnergyOptions })
        assertTrue(out.card().voice.contains("지금 출발하면"))
    }

    @Test
    fun 에너지_카드가_30초_무응답으로_접힌_뒤_다시_물을_때는_에너지_없는_출발_제안이다() {
        know()
        val timer = energyCard().one<Effect.ScheduleCardTimeout>()
        session.handle(Event.CardTimedOut(timer.timerId))
        // 달린 뒤 P단에서 접힌 질문을 한 번 다시 묻는다(위치 답을 기다리다 타임아웃).
        session.handle(Event.GearChanged(Gear.DRIVE))
        clock.now += Duration.ofMinutes(15)
        val parked = session.handle(Event.GearChanged(Gear.PARK))
        val locationTimer = parked.one<Effect.ScheduleLocationTimeout>()
        val reasked = parked + session.handle(Event.LocationTimedOut(locationTimer.timerId))
        val travel = reasked.one<Effect.RequestTravelTime>()
        val out = session.handle(Event.TravelTimeResult(travel.requestId, null))
        assertTrue("그날 이미 물었으니 서버를 다시 부르지 않는다", out.none { it is Effect.RequestEnergyOptions })
        assertTrue(out.card().sub!!.endsWith("출발할까요?"))
    }

    @Test
    fun 초기화하면_표시도_지운다() {
        know()
        energyCard()
        session.handle(Event.Heard("아니"))
        val reset = session.handle(Event.Reset)
        assertFalse(reset.filterIsInstance<Effect.Save>().last().snapshot.energyOffered)
    }
}
