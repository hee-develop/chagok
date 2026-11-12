package com.chagok.car.ui

import java.time.Duration

/** 카드 안 정보 타일(ContextTile) 한 줄의 일정. 시각은 24시간제 "13:00". */
data class TileRow(val time: String, val title: String, val next: Boolean)

/** 카드 안 정보 타일. 2열 두 개 또는 한 줄 가득 하나. */
sealed interface TileView {
    /** 오늘 일정 타일. 다음 일정(next) 시각만 accent. */
    data class Schedules(val rows: List<TileRow>) : TileView

    /** 채비 타일. 항목은 care 테두리 태그. */
    data class Care(val items: List<String>) : TileView

    /** 목적지 묻기에서 보이는 일정 장소 타일. [line]은 "13:00 육전집 점심". */
    data class PlaceTile(val name: String, val line: String) : TileView

    /** 목적지 묻기의 후보 목록 타일(한 줄 가득). 줄 순서가 후보 번호이고 줄을 누르면 그 후보로 길안내한다. */
    data class Candidates(val label: String, val rows: List<CandidateRow>) : TileView
}

/** 후보 한 줄. [name]은 부르는 이름("집", "광주송정역"), [detail]은 장소 이름·주소나 "13:00 육전집 점심". */
data class CandidateRow(val name: String, val detail: String)

/**
 * BriefingCard 한 장의 화면 내용. 순서는 규격 그대로다:
 * 머리(상태 칩) → [voice] → [sub] → 타일 → 버튼 줄(주·보조, 오른쪽 끝 음성 힌트).
 */
data class CardContent(
    /** StatusChip 문구. 비어 있으면 칩을 두지 않는다(권한 설명 카드) */
    val status: String,
    /** t-voice. 화면용 줄바꿈("\n")을 쓸 수 있다. */
    val voice: String,
    /** true면 t-voice-alert(하차 인사처럼 한 문장이 전부인 카드) */
    val alert: Boolean = false,
    /** t-voice-sub */
    val sub: String? = null,
    val tiles: List<TileView> = emptyList(),
    /** 주 버튼 라벨. 없으면 보조 하나만 둔다 */
    val primary: String? = null,
    val secondary: String? = null,
    /** 버튼 줄 오른쪽 끝 음성 힌트 두 줄. 비어 있으면 두지 않는다 */
    val hints: List<String> = emptyList(),
    /** 있으면 AutoDismissBar를 보이고 이 시간 동안 줄어든다 */
    val autoDismiss: Duration? = null,
    /** 일정을 새로 못 받았을 때 붙이는 한 줄 */
    val footnote: String? = null,
    /** 알아듣지 못함·대안 없음 같은 안내 한 줄 */
    val notice: String? = null,
    /** true면 카드 높이를 규격(592)으로 고정하고 버튼을 아래에 붙인다. 도착 카드는 내용 높이 */
    val fixedHeight: Boolean = true,
)
