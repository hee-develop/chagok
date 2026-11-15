package com.chagok.car.domain

sealed interface Intent {
    data object Accept : Intent
    data object Reject : Intent
    data object Hold : Intent
    data object Alternative : Intent
    data class Pick(val index: Int) : Intent

    /** 차 안 대화(긴 문장): 반응하지도, 다시 묻지도 않는다. */
    data object Chatter : Intent

    /** 짧은데 목록에 없거나 의도가 둘 이상 섞인 말: 한 번만 다시 묻는다. */
    data object Unrecognized : Intent

    /** STT 결과가 비었음: 다시 묻지 않고 버튼으로 기다린다. */
    data object Silence : Intent
}

/**
 * 정책서 7장: STT 결과를 정해 둔 단어 목록과 대조한다. 자유 문장 해석은 하지 않는다.
 * 거절은 단어 목록에 버튼 라벨 "그냥 갈게"([REJECT_PHRASE])를 한 덩어리로 더한다.
 */
object IntentMatcher {
    private val WORDS = mapOf(
        Intent.Accept to setOf("응", "어", "그래", "좋아", "출발", "거기로"),
        Intent.Reject to setOf("아니", "괜찮아", "됐어"),
        Intent.Hold to setOf("잠깐만", "이따가"),
    )
    private const val REJECT_PHRASE = "그냥갈게"
    private val ORDINALS = listOf(listOf("첫번째", "첫째"), listOf("두번째", "둘째"), listOf("세번째", "셋째"))

    /**
     * @param candidates 화면에 보인 후보 이름(장소 후보, 일정 겹침). 순서가 Pick.index다.
     * @param shortForms 후보의 화면에 보인 줄임 이름(말줄임 앞부분). [candidates]와 같은 순서이고 줄이지 않은 후보는 null이다.
     *   화면에 보인 만큼만 읽어 말해도 그 후보를 고르게 한다(일정 겹침 카드의 긴 제목).
     * @param acceptPick 수락("응")이 가리키는 후보 번호. "응, 서울시청"처럼 수락과 그 후보 고르기가
     *   같이 들리면 같은 결과이므로 Pick(acceptPick) 하나로 합친다. 후보가 없으면 null
     */
    fun match(utterance: String, candidates: List<String> = emptyList(), acceptPick: Int? = null, shortForms: List<String?> = emptyList()): Intent {
        val tokens = utterance.lowercase()
            .replace(PUNCTUATION, " ")
            .split(WHITESPACE)
            .filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return Intent.Silence
        if (tokens.size > Rules.CHATTER_OVER_WORDS) return Intent.Chatter

        val stems = tokens.map { it.removePolite() }
        val joined = tokens.joinToString("")
        val found = buildSet {
            WORDS.forEach { (intent, words) -> if (stems.any { it in words }) add(intent) }
            if (REJECT_PHRASE in joined) add(Intent.Reject)
            if (stems.any { it.startsWith("다른") }) add(Intent.Alternative)
            ORDINALS.forEachIndexed { i, words -> if (words.any { it in joined }) add(Intent.Pick(i)) }
            // 한 후보 이름이 다른 후보 이름 안에 들어 있으면("집"과 "단골 콩물집") 둘 다 들렸을 때 긴 이름만 고른다.
            // 후보마다 줄이지 않은 이름과 화면에 보인 줄임 이름 중 들린 것 가운데 가장 긴 것을 그 후보가 들린 이름으로 본다.
            val heard = candidates.indices.mapNotNull { i ->
                val names = listOfNotNull(candidates[i], shortForms.getOrNull(i)).map { it.lowercase().replace(PUNCTUATION, "").replace(WHITESPACE, "") }
                names.filter { it.isNotEmpty() && it in joined }.maxByOrNull { it.length }?.let { i to it }
            }
            heard.filterNot { (i, key) -> heard.any { (j, other) -> j != i && other.length > key.length && key in other } }
                .forEach { (i, _) -> add(Intent.Pick(i)) }
        }
        if (acceptPick != null && Intent.Accept in found) {
            val rest = found - Intent.Accept
            if (rest.isNotEmpty() && rest.all { it == Intent.Pick(acceptPick) }) return Intent.Pick(acceptPick)
        }
        return found.singleOrNull() ?: Intent.Unrecognized
    }

    /** "좋아요", "아니요"처럼 끝의 '요'만 떼어 같은 말로 본다. */
    private fun String.removePolite() = if (length > 1 && endsWith('요')) dropLast(1) else this

    private val PUNCTUATION = Regex("[\\p{P}\\p{S}]")
    private val WHITESPACE = Regex("\\s+")
}
