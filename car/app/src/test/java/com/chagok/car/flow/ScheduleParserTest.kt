package com.chagok.car.flow

import com.chagok.car.FixtureFile
import com.chagok.car.FixtureResponses
import com.chagok.car.domain.Favorite
import com.chagok.car.domain.FavoriteKind
import com.chagok.car.domain.LatLng
import com.chagok.car.domain.Place
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

class ScheduleParserTest {
    private val anchor = Instant.parse("2026-11-06T00:20:00Z") // 09:20 KST
    private val fixture = FixtureFile.read("schedules/gwangju-day.json")

    @Test fun `서버 응답 형식을 일정으로 바꾼다`() {
        val body = """
            {"anchor":"2026-11-06T00:20:00.000Z","schedules":[
              {"id":"s1","title":"점심","start":"2026-11-06T04:00:00.000Z","end":"2026-11-06T05:00:00.000Z",
               "allDay":false,"locationText":"광주 육전집","place":{"name":"광주 육전집","lat":35.1595,"lng":126.8526},
               "memo":"유니폼","attendees":["민수"]},
              {"id":"s2","title":"종일","start":"2026-11-06T00:20:00.000Z","end":"2026-11-07T00:20:00.000Z",
               "allDay":true,"locationText":null,"place":null,"memo":null,"attendees":[]}
            ]}
        """.trimIndent()
        val (lunch, allDay) = ScheduleParser.parse(body)
        assertEquals("s1", lunch.id)
        assertEquals(Instant.parse("2026-11-06T04:00:00Z"), lunch.start)
        assertEquals(Instant.parse("2026-11-06T05:00:00Z"), lunch.end)
        assertFalse(lunch.allDay)
        assertEquals("광주 육전집", lunch.locationText)
        assertEquals(Place("광주 육전집", LatLng(35.1595, 126.8526)), lunch.place)
        assertEquals("유니폼", lunch.memo)
        assertEquals(listOf("민수"), lunch.attendees)
        assertTrue(allDay.allDay)
        assertNull(allDay.locationText)
        assertNull(allDay.place)
        assertNull(allDay.memo)
        assertTrue(allDay.attendees.isEmpty())
    }

    @Test fun `일정이 없는 응답은 빈 목록이다`() {
        assertEquals(emptyList<Any>(), ScheduleParser.parse("""{"anchor":"2026-11-06T00:20:00.000Z","schedules":[]}"""))
    }

    @Test fun `형식이 어긋난 응답은 예외다`() {
        for (bad in listOf("not json", "{}", """{"schedules":[{"id":"x"}]}""", """{"schedules":[{"id":"x","title":"t","start":"어제","end":"내일","allDay":false}]}""")) {
            val result = runCatching { ScheduleParser.parse(bad) }
            assertTrue("예외여야 함: $bad", result.isFailure)
        }
    }

    @Test fun `광주 직관 하루 픽스처를 anchor 기준으로 파싱한다`() {
        val schedules = ScheduleParser.parse(FixtureResponses.response(fixture, anchor))
        assertEquals(listOf("광주 직관", "육전집 점심", "KIA 직관", "콩물 픽업", "친구 약속"), schedules.map { it.title })

        val allDay = schedules[0]
        assertTrue(allDay.allDay)
        assertEquals(anchor, allDay.start)
        assertNull(allDay.place)

        val lunch = schedules[1]
        // 프로토타입: 09:20에 탔을 때 육전집 점심은 13:00(3시간 40분 뒤)
        assertEquals(anchor + Duration.ofMinutes(220), lunch.start)
        assertEquals(anchor + Duration.ofMinutes(280), lunch.end)
        assertEquals("광주 육전집", lunch.place?.name)
        assertNull(lunch.memo)  // 유니폼·응원봉·티켓은 KIA 직관의 메모다

        assertEquals("유니폼·응원봉·티켓", schedules[2].memo)
        assertEquals(anchor + Duration.ofMinutes(460), schedules[2].start) // 17:00
        assertEquals(anchor + Duration.ofMinutes(700), schedules[3].start) // 21:00
        assertNull(schedules[3].memo)
    }

    @Test fun `픽스처 파일에는 이번 기능이 안 쓰는 키가 따로 있고 일정 파싱에 영향이 없다`() {
        val root = JSONObject(fixture)
        assertEquals("gwangju-day", root.getString("id"))
        assertTrue(root.has("favorites"))
        assertTrue(root.has("vehicle"))
    }

    @Test fun `자주 가는 곳을 읽고 없거나 모르는 자리는 빈 목록과 OTHER로 본다`() {
        val body = """
            {"anchor":"2026-11-06T00:20:00.000Z","schedules":[],"favorites":[
              {"kind":"home","name":"예시 아파트 101동","address":"광주 북구 샘플로 12","lat":35.1743,"lng":126.9121},
              {"kind":"work","name":"광주 예시 업무지구","address":"광주 서구 상무대로 800","lat":35.1531,"lng":126.8514},
              {"kind":"other","name":"광주송정역","address":null,"lat":35.1378,"lng":126.7912},
              {"kind":"gym","name":"체육관","lat":35.1527,"lng":126.8483}
            ]}
        """.trimIndent()
        val day = ScheduleParser.parseDay(body)
        assertEquals(
            listOf(
                Favorite(FavoriteKind.HOME, Place("예시 아파트 101동", LatLng(35.1743, 126.9121)), "광주 북구 샘플로 12"),
                Favorite(FavoriteKind.WORK, Place("광주 예시 업무지구", LatLng(35.1531, 126.8514)), "광주 서구 상무대로 800"),
                Favorite(FavoriteKind.OTHER, Place("광주송정역", LatLng(35.1378, 126.7912)), null),
                Favorite(FavoriteKind.OTHER, Place("체육관", LatLng(35.1527, 126.8483)), null),
            ),
            day.favorites,
        )
        // 기능 전에 저장한 사본처럼 favorites가 없으면 빈 목록
        assertEquals(emptyList<Favorite>(), ScheduleParser.parseDay("""{"schedules":[]}""").favorites)
        // 자주 가는 곳 형식이 어긋나면 응답 전체를 실패로 본다(일정과 같은 규칙)
        assertTrue(runCatching { ScheduleParser.parseDay("""{"schedules":[],"favorites":[{"kind":"home"}]}""") }.isFailure)
    }

    @Test fun `앱 채비를 읽고 없으면 null이다`() {
        val body = """
            {"schedules":[
              {"id":"a","title":"KIA 직관","start":"2026-11-06T08:00:00.000Z","end":"2026-11-06T11:00:00.000Z",
               "allDay":false,"locationText":null,"place":null,"memo":null,"care":"유니폼·응원봉·티켓","attendees":[]},
              {"id":"b","title":"점심","start":"2026-11-06T04:00:00.000Z","end":"2026-11-06T05:00:00.000Z",
               "allDay":false,"locationText":null,"place":null,"memo":"메모","attendees":[]}
            ]}
        """.trimIndent()
        val (a, b) = ScheduleParser.parse(body)
        assertEquals("유니폼·응원봉·티켓", a.care)
        assertNull(b.care)
    }

    @Test fun `장소 별칭을 읽고 없으면 장소 이름이 짧은 이름이다`() {
        val body = """
            {"schedules":[
              {"id":"a","title":"KIA 직관","start":"2026-11-06T08:00:00.000Z","end":"2026-11-06T11:00:00.000Z",
               "allDay":false,"locationText":null,"place":{"name":"광주-기아 챔피언스필드","alias":"챔필","lat":35.1681,"lng":126.8888},"memo":null,"attendees":[]},
              {"id":"b","title":"점심","start":"2026-11-06T04:00:00.000Z","end":"2026-11-06T05:00:00.000Z",
               "allDay":false,"locationText":null,"place":{"name":"광주 육전집","lat":35.1595,"lng":126.8526},"memo":null,"attendees":[]}
            ]}
        """.trimIndent()
        val (a, b) = ScheduleParser.parse(body)
        assertEquals("챔필", a.place!!.alias)
        assertEquals("챔필", a.place!!.shortName)
        assertNull(b.place!!.alias)
        assertEquals("광주 육전집", b.place!!.shortName)
    }

    @Test fun `광주 직관 하루 픽스처의 챔피언스필드는 챔필 별칭을 준다`() {
        val kia = ScheduleParser.parse(FixtureResponses.response(fixture, anchor)).first { it.id == "gwangju-kia" }
        assertEquals("챔필", kia.place!!.shortName)
    }
}
