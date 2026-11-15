package com.chagok.car.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class IntentMatcherTest {
    private fun match(text: String, candidates: List<String> = emptyList()) = IntentMatcher.match(text, candidates)

    @Test fun `수락`() {
        listOf("응", "응.", "어", "그래요", "좋아!", "출발", "거기로", "응 좋아").forEach {
            assertEquals(it, Intent.Accept, match(it))
        }
    }

    @Test fun `거절`() {
        listOf("아니", "아니요", "괜찮아요", "됐어").forEach { assertEquals(it, Intent.Reject, match(it)) }
    }

    @Test fun `그냥 갈게는 한 덩어리일 때만 거절이고 갈게나 그냥만으로는 거절이 아니다`() {
        assertEquals(Intent.Reject, match("그냥 갈게"))
        assertEquals(Intent.Unrecognized, match("지금 갈게"))
        assertEquals(Intent.Unrecognized, match("그냥"))
        assertEquals(Intent.Unrecognized, match("갈게"))
        assertEquals(Intent.Accept, match("응 갈게"))
    }

    @Test fun `화면에 보인 줄임 이름만 말해도 그 후보를 고르고 줄이지 않은 이름도 고른다`() {
        val titles = listOf("아주아주긴제목의 점심약속입니다 확인", "짧은 모임")
        // 큰 문구·버튼에는 12자로 줄여 "아주아주긴제목의 점심…"처럼 보인다(말줄임 앞부분만 읽을 수 있다).
        val shorts = listOf("아주아주긴제목의 점심", null)
        assertEquals(Intent.Pick(0), IntentMatcher.match("아주아주긴제목의 점심", titles, 0, shorts))
        assertEquals(Intent.Pick(0), IntentMatcher.match("아주아주긴제목의 점심약속입니다 확인", titles, 0, shorts))
        assertEquals(Intent.Pick(1), IntentMatcher.match("짧은 모임", titles, 0, shorts))
        // 줄임 이름을 모르면 앞부분만으로는 알아듣지 못한다(기존 동작).
        assertEquals(Intent.Unrecognized, IntentMatcher.match("아주아주긴제목의 점심", titles, 0))
        // 두 후보의 줄임 이름 앞부분이 같으면 둘 다 들린 것이라 알아듣지 못한다.
        val same = listOf("회의실 예약 확인 일정 하나", "회의실 예약 확인 일정 둘")
        assertEquals(Intent.Unrecognized, IntentMatcher.match("회의실 예약 확인 일", same, 0, listOf("회의실 예약 확인 일", "회의실 예약 확인 일")))
    }

    @Test fun `후보 이름의 문장부호는 들은 말과 같이 정리해 대조한다`() {
        val candidates = listOf("광주-기아 챔피언스필드")
        assertEquals(Intent.Pick(0), match("광주 기아 챔피언스필드", candidates))
        assertEquals(Intent.Pick(0), match("광주-기아 챔피언스필드", candidates))
        assertEquals(Intent.Pick(0), IntentMatcher.match("응, 광주기아챔피언스필드", candidates, acceptPick = 0))
    }

    @Test fun `보류와 대안`() {
        assertEquals(Intent.Hold, match("잠깐만"))
        assertEquals(Intent.Hold, match("이따가"))
        assertEquals(Intent.Alternative, match("다른 데"))
        assertEquals(Intent.Alternative, match("다른 휴게소"))
    }

    @Test fun `후보 고르기는 순서나 이름으로`() {
        val candidates = listOf("스타벅스 강남점", "스타벅스 역삼점")
        assertEquals(Intent.Pick(0), match("첫 번째", candidates))
        assertEquals(Intent.Pick(1), match("두번째요", candidates))
        assertEquals(Intent.Pick(1), match("역삼점", listOf("강남점", "역삼점")))
        assertEquals(Intent.Pick(0), match("스타벅스 강남점", candidates))
    }

    @Test fun `4어절이 넘으면 차 안 대화로 보고 반응하지 않음`() {
        assertEquals(Intent.Chatter, match("응 근데 오늘 점심 뭐 먹지"))
    }

    @Test fun `목록에 없거나 의도가 섞이면 알아듣지 못함`() {
        assertEquals(Intent.Unrecognized, match("글쎄"))
        assertEquals(Intent.Unrecognized, match("응 아니"))
        assertEquals(Intent.Unrecognized, match("어디"))
    }

    @Test fun `빈 결과는 무응답`() {
        assertEquals(Intent.Silence, match(""))
        assertEquals(Intent.Silence, match(" ?! "))
    }

    @Test fun `수락과 그 후보 고르기가 같이 들리면 하나로 합침`() {
        val candidates = listOf("서울시청")
        assertEquals(Intent.Pick(0), IntentMatcher.match("응, 서울시청", candidates, acceptPick = 0))
        assertEquals(Intent.Pick(0), IntentMatcher.match("서울시청 출발", candidates, acceptPick = 0))
        // 수락만 하면 그대로 수락이고, 후보와 거절이 섞이면 알아듣지 못함
        assertEquals(Intent.Accept, IntentMatcher.match("응", candidates, acceptPick = 0))
        assertEquals(Intent.Unrecognized, IntentMatcher.match("아니 서울시청", candidates, acceptPick = 0))
        // 수락이 가리키지 않는 후보와 섞이면 알아듣지 못함
        assertEquals(Intent.Unrecognized, IntentMatcher.match("응 역삼점", listOf("강남점", "역삼점"), acceptPick = 0))
    }

    // 버튼 라벨은 운전자가 소리 내 말할 문장 그대로라서, 같은 말을 해도 버튼과 같은 결과여야 한다(README '말투').
    @Test fun `버튼 라벨을 말해도 같은 결과`() {
        assertEquals(Intent.Accept, IntentMatcher.match("응, 출발"))
        assertEquals(Intent.Accept, IntentMatcher.match("응 출발"))
        assertEquals(Intent.Hold, IntentMatcher.match("잠깐만"))
        assertEquals(Intent.Hold, IntentMatcher.match("잠깐만요"))
        assertEquals(Intent.Reject, IntentMatcher.match("그냥 갈게"))
        assertEquals(Intent.Reject, IntentMatcher.match("그냥 갈게요."))
        assertEquals(Intent.Reject, IntentMatcher.match("그냥 갈게!"))
    }

    @Test fun `장소 버튼 라벨을 말해도 그 장소로 간다`() {
        val candidates = listOf("광주 육전집")
        assertEquals(Intent.Pick(0), IntentMatcher.match("광주 육전집으로", candidates, acceptPick = 0))
        assertEquals(Intent.Pick(0), IntentMatcher.match("응, 광주 육전집으로", candidates, acceptPick = 0))
        // 후보 옆의 "그냥 갈게"는 거절이다
        assertEquals(Intent.Reject, IntentMatcher.match("그냥 갈게", candidates, acceptPick = 0))
    }

    @Test fun `후보 세 개는 세 번째로도 고른다`() {
        val candidates = listOf("집", "회사", "광주송정역")
        assertEquals(Intent.Pick(2), match("세 번째", candidates))
        assertEquals(Intent.Pick(2), match("셋째", candidates))
        assertEquals(Intent.Pick(1), match("회사로", candidates))
    }

    @Test fun `짧은 후보 이름이 긴 후보 이름 안에 있으면 긴 이름을 고른다`() {
        val candidates = listOf("집", "회사", "단골 콩물집")
        assertEquals(Intent.Pick(2), match("단골 콩물집", candidates))
        assertEquals(Intent.Pick(0), match("집으로", candidates))
        // 서로 다른 두 후보를 말하면 고르지 않는다.
        assertEquals(Intent.Unrecognized, match("집 말고 회사", candidates))
    }
}
