package com.chagok.car.domain

import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 집 하차의 물건 추출('픽업·찾기·사기·수령')과 대상 일정 고르기. */
class HomePickupTest {
    @Test fun `제목에서 픽업을 빼면 물건이다`() {
        assertEquals("콩물", HomePickup.itemName("콩물 픽업"))
        assertEquals("콩물", HomePickup.itemName("콩물픽업"))
        assertEquals("택배", HomePickup.itemName("택배 수령"))
    }

    @Test fun `찾기와 사기도 센다`() {
        assertEquals("세탁물", HomePickup.itemName("세탁물 찾기"))
        assertEquals("우유", HomePickup.itemName("우유 사기"))
    }

    @Test fun `픽업류 단어는 제목 끝에 있을 때만 센다`() {
        // 가운데·앞에 있으면 물건이 아니다.
        assertNull(HomePickup.itemName("사기 예방 교육"))
        assertNull(HomePickup.itemName("찾기 쉬운 길 안내"))
        assertNull(HomePickup.itemName("택배 수령 장소 확인"))
        assertNull(HomePickup.itemName("아이 픽업 후 학원"))
        assertNull(HomePickup.itemName("찾기 세탁물"))
        assertNull(HomePickup.itemName("픽업 콩물"))
    }

    @Test fun `제목 끝의 괄호 덩어리와 구두점과 공백은 정리하고 센다`() {
        assertEquals("콩물", HomePickup.itemName("콩물 픽업 (2개)"))
        assertEquals("콩물", HomePickup.itemName("콩물 픽업 [오후]"))
        assertEquals("콩물", HomePickup.itemName("콩물 픽업 (2개) (냉장) !"))
        assertEquals("콩물", HomePickup.itemName("콩물 픽업."))
        assertEquals("세탁물", HomePickup.itemName("세탁물 찾기   "))
        assertEquals("택배", HomePickup.itemName("택배 수령~"))
        // 끝이 '확인'이라 괄호 안의 수령은 세지 않는다.
        assertNull(HomePickup.itemName("택배 (수령) 확인"))
    }

    @Test fun `단어가 앞이나 뒤에 붙은 다른 낱말이면 세지 않는다`() {
        assertNull(HomePickup.itemName("사기꾼 조심"))
        assertNull(HomePickup.itemName("치사기 모임"))
        assertNull(HomePickup.itemName("픽업하기 연습"))
        assertNull(HomePickup.itemName("고객 미팅"))
    }

    @Test fun `단어를 빼고 남는 말이 없으면 물건이 없다`() {
        assertNull(HomePickup.itemName("픽업"))
        assertNull(HomePickup.itemName(" 수령 "))
    }

    @Test fun `앞뒤 구두점과 중복 공백을 정리한다`() {
        assertEquals("콩물 두 병", HomePickup.itemName("콩물  두 병 - 픽업"))
        assertEquals("콩물", HomePickup.itemName("[콩물] 픽업!"))
    }

    private fun pickup(id: String, title: String, start: String, end: String, memo: String? = null) =
        Schedule(id, title, at(start), at(end), place = OFFICE, memo = memo)

    @Test fun `시작이 지난 픽업 일정만 센다`() {
        val kong = pickup("k", "콩물 픽업", "21:00", "22:00")
        val plan = DayPlan(listOf(kong))
        assertEquals(emptyList<PickupItem>(), HomePickup.items(plan, at("20:59")))
        assertEquals(listOf("콩물"), HomePickup.items(plan, at("21:00")).map { it.name })
    }

    @Test fun `도착으로 기록된 일정은 시작 전이어도 센다`() {
        val kong = pickup("k", "콩물 픽업", "21:00", "22:00")
        val plan = DayPlan(listOf(kong)).markArrived("k")
        assertEquals(listOf("콩물"), HomePickup.items(plan, at("20:30")).map { it.name })
    }

    @Test fun `장소가 있는데 건너뜀이면 빼고 장소가 없으면 건너뜀이어도 넣는다`() {
        val kong = pickup("k", "콩물 픽업", "21:00", "22:00")
        val noPlace = pickup("n", "우유 사기", "21:00", "22:00").copy(place = null)
        val skipped = DayPlan(listOf(kong, noPlace)).skipOverdue(at("22:30"))
        assertEquals(ScheduleStatus.SKIPPED, skipped.statusOf("k"))
        assertEquals(ScheduleStatus.SKIPPED, skipped.statusOf("n"))
        assertEquals(listOf("우유"), HomePickup.items(skipped, at("22:30")).map { it.name })
    }

    @Test fun `종일 일정은 세지 않고 이미 알린 일정도 뺀다`() {
        val kong = pickup("k", "콩물 픽업", "21:00", "22:00")

        val allDay = kong.copy(id = "d", allDay = true)
        assertEquals(emptyList<PickupItem>(), HomePickup.items(DayPlan(listOf(allDay)), at("21:30")))
        assertEquals(emptyList<PickupItem>(), HomePickup.items(DayPlan(listOf(kong)), at("21:30"), announced = setOf("k")))
    }

    @Test fun `카드에는 같은 이름을 합치고 세 개까지만 올린다`() {
        val items = listOf("a" to "콩물 픽업", "b" to "콩물 수령", "c" to "우유 사기", "d" to "빵 찾기", "e" to "책 수령").map { (id, t) ->
            PickupItem(HomePickup.itemName(t)!!, pickup(id, t, "21:00", "22:00"))
        }
        assertEquals(listOf("콩물", "우유", "빵"), HomePickup.dedupedForCard(items).map { it.name })
    }

    @Test fun `기준값은 Rules에 있다`() {
        assertEquals(300.0, Rules.ARRIVAL_RADIUS_METERS, 0.0)
        assertEquals(300.0, Rules.HOME_RADIUS_METERS, 0.0)
        assertEquals(Duration.ofMinutes(5), Rules.LOCATION_MAX_AGE)
        assertEquals(Rules.ASK_DESTINATION_LEAD, Rules.ARRIVAL_WINDOW_LEAD)
    }
}
