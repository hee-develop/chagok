package com.chagok.car.fakenavi

import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class FakeNaviPhrasesTest {
    private val seoul = ZoneId.of("Asia/Seoul")
    private val now = Instant.parse("2026-11-06T00:20:00Z") // 서울 09:20
    private val route = FakeRoute.to(Place("광주 육전집", LatLng(35.1595, 126.8526)))

    @Test fun `남은 거리는 10km부터 정수 km이고 그 아래는 소수 한 자리다`() {
        assertEquals("212km", FakeNaviPhrases.km(212_000.0))
        assertEquals("212km", FakeNaviPhrases.km(211_600.0))
        assertEquals("211km", FakeNaviPhrases.km(211_400.0))
        assertEquals("10km", FakeNaviPhrases.km(10_000.0))
        assertEquals("10km", FakeNaviPhrases.km(9_960.0)) // 소수 한 자리로 올리면 10.0이 되는 경우
        assertEquals("9.9km", FakeNaviPhrases.km(9_940.0))
        assertEquals("4.2km", FakeNaviPhrases.km(4_200.0))
        assertEquals("1.0km", FakeNaviPhrases.km(1_000.0))
        assertEquals("0.5km", FakeNaviPhrases.km(480.0))
    }

    @Test fun `아주 조금 남아도 0km로 적지 않는다`() {
        assertEquals("0.1km", FakeNaviPhrases.km(20.0))
        assertEquals("0km", FakeNaviPhrases.km(0.0))
    }

    @Test fun `목적지 줄과 도착 줄 문구`() {
        assertEquals("목적지 · 광주 육전집", FakeNaviPhrases.destination("광주 육전집"))
        assertEquals("도착 · 212km 남음", FakeNaviPhrases.detail(212_000.0))
        assertEquals("도착 · 3.1km 남음", FakeNaviPhrases.detail(3_100.0))
    }

    @Test fun `출발 직후 패널은 목적지와 도착 시각과 남은 거리를 보인다`() {
        val p = FakeNaviPhrases.panel(FakeTrip(route, 10_000, now), seoul)
        assertEquals("목적지 · 광주 육전집", p.destination)
        assertTrue(p.headline, p.headline.matches(Regex("\\d\\d:\\d\\d")))
        val expectedEta = DateTimeFormatter.ofPattern("HH:mm").format((now + route.duration).atZone(seoul))
        assertEquals(expectedEta, p.headline)
        assertNotNull(p.detail)
        assertTrue(p.detail, p.detail!!.matches(Regex("도착 · \\d+(\\.\\d)?km 남음")))
    }

    @Test fun `회전 안내 문구는 없다`() {
        val p = FakeNaviPhrases.panel(FakeTrip(route, 10_000, now), seoul)
        for (text in listOfNotNull(p.destination, p.headline, p.detail)) {
            assertTrue(text, !text.contains("회전") && !text.contains("직진"))
        }
    }

    @Test fun `도착하면 장소 이름 도착만 보인다`() {
        val t = FakeTrip(route, 10_000, now)
        t.advance(10_000, true)
        val p = FakeNaviPhrases.panel(t, seoul)
        assertEquals("광주 육전집 도착", p.headline)
        assertNull(p.destination)
        assertNull(p.detail)
    }

    @Test fun `도착 예정 시각은 서울 시간대로 적는다`() {
        // 출발 04:50Z = 서울 13:50. 소요는 경로 길이로 구한 시간이라 도착은 14시대다.
        val t = FakeTrip(route, 10_000, Instant.parse("2026-11-06T04:50:00Z"))
        val eta = FakeNaviPhrases.eta(t, seoul)
        assertTrue(eta, Regex("1[3-4]:\\d\\d").matches(eta))
        // 같은 도착 예정도 호출자가 준 시간대로 적는다(UTC로 적으면 서울보다 9시간 이르다).
        assertEquals((eta.substring(0, 2).toInt() + 15) % 24, FakeNaviPhrases.eta(t, java.time.ZoneOffset.UTC).substring(0, 2).toInt())
    }

    @Test fun `달리는 동안 큰 도착 시각은 그대로이고 남은 거리만 줄어든다`() {
        // 회귀: 도착 예정을 '지금 시각 + 남은 시간'으로 매번 구하면, 경로를 몇 초에 압축해 달릴 때 남은 시간만 수십 분 줄어 도착 시각이 앞당겨져 보였다.
        val t = FakeTrip(route, 4_500, now, java.time.Duration.ofMinutes(200))
        val first = FakeNaviPhrases.panel(t, seoul)
        assertEquals("12:40", first.headline) // 출발 09:20 + 소요 200분
        var previousDetail = first.detail
        for (ratio in listOf(0.1, 0.25, 0.5, 0.75, 0.99)) {
            t.seek(ratio)
            val p = FakeNaviPhrases.panel(t, seoul)
            assertEquals("진행률 $ratio", first.headline, p.headline)
            assertTrue("남은 거리는 줄어든다: $previousDetail → ${p.detail}", p.detail != previousDetail)
            previousDetail = p.detail
        }
    }

    @Test fun `육전집 경로의 진행률 0점5 패널 문구는 정해져 있다`() {
        // e2e/maestro/car/fake-navi.yaml이 같은 형식을 확인한다. 경로나 시속을 바꾸면 flow도 고친다.
        val t = FakeTrip(route, 10_000, now)
        t.seek(0.5)
        val p = FakeNaviPhrases.panel(t, seoul)
        assertEquals("목적지 · 광주 육전집", p.destination)
        assertEquals("09:32", p.headline) // 출발 09:20 + 경로 소요 12분. 진행률과 상관없이 고정이다
        assertEquals("도착 · 3.1km 남음", p.detail)
    }

    @Test
    fun `도착 문구는 긴 장소 이름을 12자로 줄인다`() {
        assertEquals("광주 육전집 도착", FakeNaviPhrases.arrived("광주 육전집"))
        assertEquals("가나다라마바사아자차카타… 도착", FakeNaviPhrases.arrived("가나다라마바사아자차카타파하"))
        assertEquals("가나다라마바사아자차카타 도착", FakeNaviPhrases.arrived("가나다라마바사아자차카타"))
    }
}
