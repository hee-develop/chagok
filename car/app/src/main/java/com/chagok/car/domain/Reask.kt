package com.chagok.car.domain

/**
 * 다시 물을 질문의 갈래(정책서 6장 '무응답'·7장 '보류'). [Snapshot][com.chagok.car.flow.Snapshot]에 이름으로 저장한다.
 * 다시 물을 때는 이 질문을 그대로 되살리지 않고, 그 시점의 일정·시각으로 판단을 다시 해 만든 질문을 한 번 묻는다(`docs/reask.md`).
 */
enum class ReaskKind { DEPART, DEPART_LATE, ASK_DESTINATION, OVERLAP }

/**
 * 30초 동안 대답이 없어 접힌 질문 하나(보류한 뒤 접힌 것 포함). 다음 정차 때 한 번만 다시 묻는다.
 * [scheduleId]는 그 질문이 다룬 대상 일정이고(일정 없음·후보 묻기는 null), 그 일정이 도착·건너뜀이 되면 다시 묻지 않는다.
 */
data class PendingReask(val kind: ReaskKind, val scheduleId: String? = null) {
    companion object {
        fun of(question: Question): PendingReask = when (question) {
            is Question.Depart -> PendingReask(ReaskKind.DEPART, question.target.id)
            // 에너지 제안은 하루 한 번이라 다시 물을 때는 에너지 없는 출발 제안으로 돌아간다(그날 이미 물었다).
            is Question.Energy -> PendingReask(ReaskKind.DEPART, question.target.id)
            is Question.DepartLate -> PendingReask(ReaskKind.DEPART_LATE, question.target.id)
            is Question.AskDestination -> PendingReask(ReaskKind.ASK_DESTINATION, question.suggested?.id)
            is Question.Overlap -> PendingReask(ReaskKind.OVERLAP, question.first.id)
        }
    }
}
