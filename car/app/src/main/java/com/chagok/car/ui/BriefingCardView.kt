package com.chagok.car.ui

import android.content.Context
import android.graphics.Color
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.chagok.car.R

/**
 * BriefingCard: 차곡이 정차 중에 말을 거는 유일한 카드.
 * 크기 800×592(환산), surface-100 바탕, 1px line 테두리, radius-2xl, shadow-card, 패딩 세로 32·가로 36, 블록 사이 20.
 * 안 순서는 고정: 머리(로고, VoiceIndicator, StatusChip) → t-voice → t-voice-sub → ContextTile → 버튼 줄.
 * 카드 안에 스크롤은 없다. 글은 최대 2줄이고 넘치면 말줄임으로 자른다.
 */
class BriefingCardView(context: Context, private val d: DesignScale) : LinearLayout(context) {
    var onPrimary: () -> Unit = {}
    var onSecondary: () -> Unit = {}

    /** 후보 타일의 줄을 눌렀다. 0부터 센 후보 번호 */
    var onPick: (Int) -> Unit = {}

    private val voiceIndicator = VoiceIndicator(context, d)
    private val statusSlot = LinearLayout(context)
    private val body = LinearLayout(context).apply { orientation = VERTICAL }
    private var dismissBar: AutoDismissBar? = null

    /** 지금 그린 카드의 목적지 후보 줄. 고정 높이 카드에서 내용이 넘치면 [onMeasure]가 이 줄들의 높이를 줄인다. */
    private var candidateRows: List<View> = emptyList()

    /** 말하는 동안만 true. 파형이 움직인다. */
    var speaking: Boolean
        get() = voiceIndicator.speaking
        set(value) {
            voiceIndicator.speaking = value
        }

    init {
        id = R.id.briefing_card
        orientation = VERTICAL
        background = d.shape(
            d.color(R.color.surface_100),
            d.dimen(R.dimen.radius_2xl),
            d.color(R.color.line),
            d.dimen(R.dimen.hairline),
        )
        val h = d.dimenInt(R.dimen.space_4xl)
        val v = d.dimenInt(R.dimen.space_3xl)
        setPadding(h, v, h, v)
        // shadow-card는 카드에만. 0 24 60 rgba(0,0,0,.5)에 가깝게 elevation으로 낸다.
        elevation = d.dimen(R.dimen.shadow_card_dy)
        outlineSpotShadowColor = Color.argb(128, 0, 0, 0)
        outlineAmbientShadowColor = outlineSpotShadowColor

        addView(
            LinearLayout(context).apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(logoLockup(context, d))
                addView(voiceIndicator, LayoutParams(-2, -2).apply { marginStart = d.dimenInt(R.dimen.space_m) })
                addView(View(context), LayoutParams(0, 1, 1f))
                addView(statusSlot)
            },
            LayoutParams(-1, -2),
        )
        addView(body, LayoutParams(-1, 0, 1f))
    }

    private fun gap() = d.dimenInt(R.dimen.space_xl)

    /** 카드 내용을 그린다. [freshlyShown]이 true일 때만 AutoDismissBar를 처음부터 다시 줄인다. */
    fun bind(card: CardContent, freshlyShown: Boolean = true) {
        statusSlot.removeAllViews()
        if (card.status.isNotEmpty()) statusSlot.addView(statusChip(context, d, card.status))

        val params = layoutParams
        val wantHeight = if (card.fixedHeight) d.dimenInt(R.dimen.size_card_h) else ViewGroup.LayoutParams.WRAP_CONTENT
        if (params != null && params.height != wantHeight) {
            params.height = wantHeight
            layoutParams = params
        }
        (body.layoutParams as LayoutParams).apply {
            height = if (card.fixedHeight) 0 else ViewGroup.LayoutParams.WRAP_CONTENT
            weight = if (card.fixedHeight) 1f else 0f
        }

        body.removeAllViews()
        body.addView(
            d.text(if (card.alert) R.style.t_voice_alert else R.style.t_voice, d.color(R.color.ink)).apply {
                text = d.keepTimesTogether(card.voice)
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
            },
            LayoutParams(-1, -2).apply { topMargin = gap() },
        )
        card.sub?.let { sub ->
            body.addView(
                d.text(R.style.t_voice_sub, d.color(R.color.ink_2)).apply {
                    text = d.keepTimesTogether(sub)
                    maxLines = 2
                    ellipsize = TextUtils.TruncateAt.END
                },
                LayoutParams(-1, -2).apply { topMargin = gap() },
            )
        }
        if (card.tiles.isNotEmpty()) body.addView(tileRow(card.tiles), LayoutParams(-1, -2).apply { topMargin = gap() })
        card.footnote?.let { note ->
            body.addView(
                d.text(R.style.t_body, d.color(R.color.ink_3)).apply { text = d.keepTimesTogether(note); maxLines = 2; ellipsize = TextUtils.TruncateAt.END },
                LayoutParams(-1, -2).apply { topMargin = gap() },
            )
        }
        card.notice?.let { note ->
            body.addView(
                d.text(R.style.t_body, d.color(R.color.ink_2)).apply { text = d.keepTimesTogether(note); maxLines = 2; ellipsize = TextUtils.TruncateAt.END },
                LayoutParams(-1, -2).apply { topMargin = gap() },
            )
        }

        if (card.fixedHeight) body.addView(View(context), LayoutParams(-1, 0, 1f))

        if (card.primary != null || card.secondary != null || card.hints.isNotEmpty()) {
            body.addView(buttonRow(card), LayoutParams(-1, -2).apply { topMargin = gap() })
        }
        candidateRows = body.descendants().filter { it.getTag(R.id.candidate_row) == true }
        if (card.autoDismiss != null) {
            val bar = AutoDismissBar(context, d)
            dismissBar = bar
            body.addView(bar, LayoutParams(-1, -2).apply { topMargin = gap() })
            if (freshlyShown) bar.start(card.autoDismiss)
        } else {
            dismissBar = null
        }
    }

    /**
     * 후보 줄은 버튼 높이(candidate_row_h)로 먼저 재 보고, 고정 높이 카드의 내용이 넘치면 넘친 만큼을 줄 수로 나눠
     * 줄 높이를 줄여(candidate_row_min_h까지) 다시 잰다. 두 줄 t-voice·안내 한 줄·후보 3줄이 함께 있어도 버튼 줄이 잘리지 않는다.
     */
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val full = d.dimenInt(R.dimen.candidate_row_h)
        candidateRows.forEach { it.minimumHeight = full }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        if (candidateRows.isEmpty()) return
        val used = (0 until body.childCount).map { body.getChildAt(it) }.sumOf {
            val lp = it.layoutParams as MarginLayoutParams
            it.measuredHeight + lp.topMargin + lp.bottomMargin
        }
        val overflow = used - body.measuredHeight
        if (overflow <= 0) return
        val shrink = (overflow + candidateRows.size - 1) / candidateRows.size
        val reduced = maxOf(d.dimenInt(R.dimen.candidate_row_min_h), full - shrink)
        candidateRows.forEach { it.minimumHeight = reduced }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }

    private fun View.descendants(): List<View> =
        if (this is ViewGroup) (0 until childCount).flatMap { listOf(getChildAt(it)) + getChildAt(it).descendants() } else emptyList()

    /** 2열 두 개 또는 한 줄 가득 하나. 사이 간격 space-l */
    private fun tileRow(tiles: List<TileView>): View = LinearLayout(context).apply {
        tiles.take(2).forEachIndexed { i, tile ->
            addView(
                contextTile(context, d, tile) { onPick(it) },
                LayoutParams(0, -2, 1f).apply { if (i > 0) marginStart = d.dimenInt(R.dimen.space_l) },
            )
        }
    }

    /** 주 버튼 → 보조 버튼(사이 space-m) → 오른쪽 끝 음성 힌트 두 줄(t-label, ink-3) */
    private fun buttonRow(card: CardContent): View = LinearLayout(context).apply {
        gravity = Gravity.CENTER_VERTICAL
        val buttonH = d.dimenInt(R.dimen.size_button)
        card.primary?.let { addView(chagokButton(context, d, it, true) { onPrimary() }, LayoutParams(-2, buttonH)) }
        card.secondary?.let {
            addView(
                chagokButton(context, d, it, false) { onSecondary() },
                LayoutParams(-2, buttonH).apply { if (card.primary != null) marginStart = d.dimenInt(R.dimen.space_m) },
            )
        }
        addView(View(context), LayoutParams(0, 1, 1f))
        if (card.hints.isNotEmpty()) {
            addView(
                LinearLayout(context).apply {
                    orientation = VERTICAL
                    gravity = Gravity.END
                    card.hints.forEachIndexed { i, hint ->
                        addView(
                            d.text(R.style.t_label, d.color(R.color.ink_3)).apply {
                                text = hint
                                gravity = Gravity.END
                                isSingleLine = true
                            } as TextView,
                            LayoutParams(-2, -2).apply { if (i > 0) topMargin = d.dimenInt(R.dimen.hint_gap) },
                        )
                    }
                },
            )
        }
    }
}
