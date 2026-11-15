package com.chagok.car.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.LayerDrawable
import android.graphics.drawable.StateListDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.chagok.car.R
import com.chagok.car.flow.Phrases
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.time.Duration

/** 곡 심볼과 워드마크를 ink 색 VectorDrawable로 그린 이미지 */
private fun ImageView.vector(res: Int, w: Float, h: Float) {
    setImageResource(res)
    scaleType = ImageView.ScaleType.FIT_CENTER
    layoutParams = LinearLayout.LayoutParams(w.toInt(), h.toInt())
}

/** 카드 머리의 로고: size-mark 타일(surface-200, radius-m) 안 30 심볼 + 높이 26 워드마크 */
fun logoLockup(context: Context, d: DesignScale): View = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    val mark = FrameLayout(context).apply {
        background = d.shape(d.color(R.color.surface_200), d.dimen(R.dimen.radius_m))
        layoutParams = LinearLayout.LayoutParams(d.dimenInt(R.dimen.size_mark), d.dimenInt(R.dimen.size_mark))
        addView(
            ImageView(context).apply {
                setImageResource(R.drawable.ic_logo_symbol)
                contentDescription = "차곡"
            },
            FrameLayout.LayoutParams(d.dimenInt(R.dimen.symbol_in_mark), d.dimenInt(R.dimen.symbol_in_mark), Gravity.CENTER),
        )
    }
    addView(mark)
    addView(
        ImageView(context).apply {
            vector(R.drawable.ic_logo_wordmark, d.dimen(R.dimen.wordmark_w), d.dimen(R.dimen.wordmark_h))
            contentDescription = "차곡"
        },
        LinearLayout.LayoutParams(d.dimenInt(R.dimen.wordmark_w), d.dimenInt(R.dimen.wordmark_h)).apply {
            marginStart = d.dimenInt(R.dimen.space_s)
        },
    )
}

/**
 * VoiceIndicator: 40×24, 막대 다섯 개(선 3, 둥근 끝, accent).
 * 말하는 동안에만 막대 높이가 35–100% 사이로 움직이고, 아니면 모두 30% 높이로 멈춘다.
 * 움직임 줄이기(시스템 애니메이션 꺼짐)에서는 움직이지 않고 말하는 동안 막대를 진하게만 한다.
 */
class VoiceIndicator(context: Context, private val d: DesignScale) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = d.color(R.color.accent)
        strokeCap = Paint.Cap.ROUND
        style = Paint.Style.STROKE
    }
    private val offsets = floatArrayOf(0f, 0.22f, 0.5f, 0.11f, 0.67f)
    private var phase = 0f
    private var animator: ValueAnimator? = null

    var speaking: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            if (value) start() else stop()
            invalidate()
        }

    private fun start() {
        if (!ValueAnimator.areAnimatorsEnabled()) return
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 900
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            addUpdateListener {
                phase = it.animatedValue as Float
                invalidate()
            }
            start()
        }
    }

    private fun stop() {
        animator?.cancel()
        animator = null
    }

    override fun onDetachedFromWindow() {
        stop()
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(d.dimenInt(R.dimen.voice_w), d.dimenInt(R.dimen.voice_h))
    }

    override fun onDraw(canvas: Canvas) {
        val bar = d.dimen(R.dimen.voice_bar)
        paint.strokeWidth = bar
        val moving = speaking && animator != null
        paint.alpha = if (!speaking && !ValueAnimator.areAnimatorsEnabled()) 153 else 255
        val step = width / 5f
        for (i in 0 until 5) {
            val ratio = when {
                moving -> {
                    // 0.9초 주기 삼각파: 35% → 100% → 35%
                    val t = (phase + offsets[i]) % 1f
                    val tri = if (t < 0.5f) t * 2f else (1f - t) * 2f
                    0.35f + 0.65f * tri
                }
                speaking -> 1f
                else -> 0.3f
            }
            val half = height * ratio / 2f - bar / 2f
            val x = step * i + step / 2f
            val cy = height / 2f
            canvas.drawLine(x, cy - half.coerceAtLeast(0f), x, cy + half.coerceAtLeast(0f), paint)
        }
    }
}

/** StatusChip: t-status, ink-3, 1px line 테두리, 바탕 없음, radius-pill, 패딩 8×16 */
fun statusChip(context: Context, d: DesignScale, label: String): TextView =
    d.text(R.style.t_status, d.color(R.color.ink_3)).apply {
        text = label
        background = d.shape(null, d.dimen(R.dimen.radius_pill), d.color(R.color.line), d.dimen(R.dimen.hairline))
        val h = d.dimenInt(R.dimen.status_pad_h)
        val v = d.dimenInt(R.dimen.status_pad_v)
        setPadding(h, v, h, v)
        maxLines = 1
    }

/**
 * Button. 주 버튼은 accent 바탕 + on-accent 글자(t-button, 가로 패딩 36), 보조 버튼은 line-strong 1.5 테두리 + ink 글자
 * (굵기 400, 가로 패딩 28). 높이 size-button. 눌림은 크기 96%와 안쪽 링 6(투명도 45%).
 */
fun chagokButton(context: Context, d: DesignScale, label: String, primary: Boolean, onClick: () -> Unit): TextView {
    val radius = d.dimen(R.dimen.radius_l)
    val base = if (primary) {
        d.shape(d.color(R.color.accent), radius)
    } else {
        d.shape(null, radius, d.color(R.color.line_strong), d.dimen(R.dimen.button_stroke))
    }
    val ringColor = (if (primary) d.color(R.color.on_accent) else d.color(R.color.accent)) and 0x00ffffff or 0x73000000
    val ring = d.shape(null, radius, ringColor, d.dimen(R.dimen.press_ring))
    val pressed = LayerDrawable(arrayOf(base, ring))
    return d.text(
        if (primary) R.style.t_button else R.style.t_button_regular,
        d.color(if (primary) R.color.on_accent else R.color.ink),
    ).apply {
        text = label
        gravity = Gravity.CENTER
        isSingleLine = true
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_pressed), pressed)
            addState(intArrayOf(), base)
        }
        val pad = d.dimenInt(if (primary) R.dimen.button_pad_primary else R.dimen.button_pad_secondary)
        setPadding(pad, 0, pad, 0)
        minHeight = d.dimenInt(R.dimen.size_button)
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
        setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> v.animate().scaleX(0.96f).scaleY(0.96f).setDuration(80).start()
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
            }
            false
        }
    }
}

/** 한 줄씩 채우다 넘치면 다음 줄로 내려가는 간단한 배치. 채비 태그에 쓴다. */
class FlowLayout(context: Context, private val gap: Int) : ViewGroup(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val maxW = MeasureSpec.getSize(widthMeasureSpec)
        var x = 0
        var y = 0
        var rowH = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            c.measure(MeasureSpec.makeMeasureSpec(maxW, MeasureSpec.AT_MOST), MeasureSpec.UNSPECIFIED)
            if (x > 0 && x + c.measuredWidth > maxW) {
                x = 0
                y += rowH + gap
                rowH = 0
            }
            x += c.measuredWidth + gap
            rowH = maxOf(rowH, c.measuredHeight)
        }
        setMeasuredDimension(maxW, y + rowH)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val maxW = r - l
        var x = 0
        var y = 0
        var rowH = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (x > 0 && x + c.measuredWidth > maxW) {
                x = 0
                y += rowH + gap
                rowH = 0
            }
            c.layout(x, y, x + c.measuredWidth, y + c.measuredHeight)
            x += c.measuredWidth + gap
            rowH = maxOf(rowH, c.measuredHeight)
        }
    }
}

/** 600 굵기 글자(폰트 가족의 semibold)로 바꾼다. 스타일(styles.xml)에 없는 400 글자 속 강조에만 쓴다. */
private fun TextView.semibold() {
    typeface = Typeface.create(typeface, 600, false)
}

/** ContextTile 공통 바탕: surface-200, radius-l, 패딩 세로 space-l 가로 space-xl */
private fun tileBase(context: Context, d: DesignScale, gap: Int): LinearLayout = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    background = d.shape(d.color(R.color.surface_200), d.dimen(R.dimen.radius_l))
    val h = d.dimenInt(R.dimen.space_xl)
    val v = d.dimenInt(R.dimen.space_l)
    setPadding(h, v, h, v)
    showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
    dividerDrawable = android.graphics.drawable.GradientDrawable().apply { setSize(1, gap) }
}

/** 타일 하나를 만든다. [onPick]은 후보 타일의 줄을 눌렀을 때 0부터 센 후보 번호로 부른다. */
fun contextTile(context: Context, d: DesignScale, tile: TileView, onPick: (Int) -> Unit = {}): View = when (tile) {
    is TileView.Schedules -> tileBase(context, d, d.dimenInt(R.dimen.tile_gap)).apply {
        addView(d.text(R.style.t_label, d.color(R.color.ink_3)).apply { text = "오늘 일정" })
        tile.rows.forEach { addView(scheduleRow(context, d, it)) }
    }
    is TileView.Care -> tileBase(context, d, d.dimenInt(R.dimen.tile_care_gap)).apply {
        addView(d.text(R.style.t_label, d.color(R.color.care_label)).apply { text = "채비" })
        addView(
            FlowLayout(context, d.dimenInt(R.dimen.space_xs)).apply {
                tile.items.forEach { addView(careTag(context, d, it)) }
            },
        )
    }
    is TileView.PlaceTile -> tileBase(context, d, d.dimenInt(R.dimen.tile_gap)).apply {
        addView(d.text(R.style.t_label, d.color(R.color.ink_3)).apply { text = "일정 장소" })
        addView(d.text(R.style.t_body, d.color(R.color.ink)).apply { text = tile.name; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END })
        addView(d.text(R.style.t_body, d.color(R.color.ink_2)).apply { text = tile.line; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END })
    }
    is TileView.EnergyStop -> tileBase(context, d, d.dimenInt(R.dimen.tile_gap)).apply {
        addView(d.text(R.style.t_label, d.color(R.color.ink_3)).apply { text = tile.name; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END })
        if (tile.badge != null || tile.detail.isNotEmpty()) {
            addView(
                LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    tile.badge?.let { badge ->
                        addView(
                            d.text(R.style.t_body, d.color(R.color.ink)).apply {
                                text = badge
                                isSingleLine = true
                                semibold()
                                background = d.shape(d.color(R.color.surface_300), d.dimen(R.dimen.radius_s))
                                setPadding(d.dimenInt(R.dimen.space_s), d.dimenInt(R.dimen.space_2xs), d.dimenInt(R.dimen.space_s), d.dimenInt(R.dimen.space_2xs))
                            },
                        )
                    }
                    if (tile.detail.isNotEmpty()) {
                        addView(
                            d.text(R.style.t_body, d.color(R.color.ink_2)).apply { text = tile.detail; isSingleLine = true },
                            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                if (tile.badge != null) marginStart = d.dimenInt(R.dimen.space_xs)
                            },
                        )
                    }
                },
            )
        }
        tile.note?.let { note ->
            addView(d.text(R.style.t_body, d.color(R.color.ink)).apply { text = note; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END })
        }
        tile.source?.let { source ->
            addView(d.text(R.style.t_meta, d.color(R.color.ink_3)).apply { text = source; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END })
        }
    }
    is TileView.EnergyLevel -> tileBase(context, d, d.dimenInt(R.dimen.tile_gap)).apply {
        addView(d.text(R.style.t_label, d.color(R.color.ink_3)).apply { text = tile.title })
        addView(
            LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                tile.percent?.let { percent ->
                    addView(d.text(R.style.t_body, d.color(R.color.ink)).apply { text = percent; isSingleLine = true; semibold() })
                }
                addView(
                    d.text(R.style.t_body, d.color(R.color.ink)).apply { text = tile.level; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END },
                    LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        if (tile.percent != null) marginStart = d.dimenInt(R.dimen.space_2xs)
                    },
                )
            },
        )
        // 이유 한 줄은 '챙길 것'과 같은 주황 계열(care-label)로 강조한다.
        addView(d.text(R.style.t_body, d.color(R.color.care_label)).apply { text = tile.reason; maxLines = 2; ellipsize = TextUtils.TruncateAt.END })
    }
    // 고정 높이 카드에 줄 세 개가 들어가도록 세로 패딩을 줄이고 줄 사이 간격 없이 붙인다(줄 높이가 터치 영역이다).
    is TileView.Candidates -> tileBase(context, d, d.dimenInt(R.dimen.tile_gap)).apply {
        val h = d.dimenInt(R.dimen.space_xl)
        val v = d.dimenInt(R.dimen.space_s)
        setPadding(h, v, h, v)
        addView(d.text(R.style.t_label, d.color(R.color.ink_3)).apply { text = tile.label })
        addView(
            LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                tile.rows.forEachIndexed { i, row -> addView(candidateRow(context, d, i, row) { onPick(i) }) }
            },
        )
    }
    is TileView.Pairing -> pairingTile(context, d, tile)
}

/**
 * 휴대폰 연결 타일: 흰 바탕 QR(검은 점, 카메라가 읽기 쉽게) + 오른쪽에 '연결 번호' 라벨과 숫자(t-voice).
 * 숫자 뷰는 [R.id.pairing_code]라 E2E가 읽어 폰 대신 서버에 보낸다.
 */
private fun pairingTile(context: Context, d: DesignScale, tile: TileView.Pairing): View =
    LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = d.shape(d.color(R.color.surface_200), d.dimen(R.dimen.radius_l))
        val pad = d.dimenInt(R.dimen.space_xl)
        setPadding(pad, pad, pad, pad)
        val side = d.dimenInt(R.dimen.pairing_qr)
        val qrPad = d.dimenInt(R.dimen.pairing_qr_pad)
        addView(
            ImageView(context).apply {
                setImageBitmap(qrBitmap(tile.qr, side - qrPad * 2))
                scaleType = ImageView.ScaleType.FIT_CENTER
                background = d.shape(Color.WHITE, d.dimen(R.dimen.radius_m))
                setPadding(qrPad, qrPad, qrPad, qrPad)
                contentDescription = "연결 QR"
            },
            LinearLayout.LayoutParams(side, side),
        )
        addView(
            LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                addView(d.text(R.style.t_label, d.color(R.color.ink_3)).apply { text = "연결 번호" })
                addView(
                    d.text(R.style.t_voice, d.color(R.color.ink)).apply {
                        id = R.id.pairing_code
                        text = tile.code
                        isSingleLine = true
                    },
                )
                addView(d.text(R.style.t_body, d.color(R.color.ink_3)).apply { text = "휴대폰 차곡 앱 › 차 연결" })
            },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = d.dimenInt(R.dimen.space_3xl) },
        )
    }

/** [text]를 담은 QR 그림(검은 점·흰 바탕, 여백 없음). 한 변 [size]px */
private fun qrBitmap(text: String, size: Int): Bitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 0))
    val pixels = IntArray(size * size) { i -> if (matrix.get(i % size, i / size)) Color.BLACK else Color.WHITE }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
}

/**
 * 후보 한 줄: 번호(t-time, 1번만 accent) + 부르는 이름(t-body ink) + 장소 이름·주소(t-body ink-3, 넘치면 말줄임).
 * 줄 전체가 누름 대상이고 높이는 candidate_row_h(카드에 안 들어가면 [BriefingCardView]가 줄인다). 눌림은 surface-300 바탕.
 */
private fun candidateRow(context: Context, d: DesignScale, index: Int, row: CandidateRow, onClick: () -> Unit): View =
    LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = d.dimenInt(R.dimen.candidate_row_h)
        val pad = d.dimenInt(R.dimen.space_xs)
        setPadding(pad, 0, pad, 0)
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_pressed), d.shape(d.color(R.color.surface_300), d.dimen(R.dimen.radius_m)))
        }
        setTag(R.id.candidate_row, true)
        isClickable = true
        isFocusable = true
        contentDescription = "${index + 1} ${row.name}"
        setOnClickListener { onClick() }
        addView(
            d.text(R.style.t_time, d.color(if (index == 0) R.color.accent else R.color.ink_3)).apply {
                text = "${index + 1}"
                isSingleLine = true
            },
            LinearLayout.LayoutParams(d.dimenInt(R.dimen.candidate_number_w), ViewGroup.LayoutParams.WRAP_CONTENT),
        )
        addView(
            d.text(R.style.t_body, d.color(R.color.ink)).apply {
                text = row.name
                isSingleLine = true
                ellipsize = TextUtils.TruncateAt.END
            },
        )
        addView(
            d.text(R.style.t_body, d.color(R.color.ink_3)).apply {
                text = row.detail
                isSingleLine = true
                ellipsize = TextUtils.TruncateAt.END
            },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = d.dimenInt(R.dimen.space_s) },
        )
    }

/** 일정 한 줄: 시각(t-time, 다음 일정만 accent·나머지 ink-3) + 제목(t-body) */
private fun scheduleRow(context: Context, d: DesignScale, row: TileRow): View = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    isBaselineAligned = true
    addView(
        d.text(R.style.t_time, d.color(if (row.next) R.color.accent else R.color.ink_3)).apply {
            text = row.time
            isSingleLine = true
        },
    )
    addView(
        d.text(R.style.t_body, d.color(R.color.ink)).apply {
            text = row.title
            isSingleLine = true
            ellipsize = TextUtils.TruncateAt.END
        },
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = d.dimenInt(R.dimen.space_xs) },
    )
}

/** 채비 태그: care 1.5 테두리, radius-m, 높이 38, 글자 care-ink. 색만이 아니라 테두리 모양으로도 구분된다. */
private fun careTag(context: Context, d: DesignScale, label: String): TextView =
    d.text(R.style.t_body, d.color(R.color.care_ink)).apply {
        text = label
        gravity = Gravity.CENTER
        isSingleLine = true
        background = d.shape(null, d.dimen(R.dimen.radius_m), d.color(R.color.care), d.dimen(R.dimen.care_tag_stroke))
        val pad = d.dimenInt(R.dimen.care_tag_pad)
        setPadding(pad, 0, pad, 0)
        minHeight = d.dimenInt(R.dimen.care_tag_h)
        height = d.dimenInt(R.dimen.care_tag_h)
    }

/** 말풍선처럼 한 줄 알약. */
private fun pillBase(context: Context, d: DesignScale): LinearLayout = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    background = d.shape(d.color(R.color.surface_100), d.dimen(R.dimen.radius_pill), d.color(R.color.line), d.dimen(R.dimen.hairline))
    minimumHeight = d.dimenInt(R.dimen.size_chip)
}

/** 안내 한 줄(권한 거부 안내 등)을 알약으로 보인다. */
class NoticePill(context: Context, d: DesignScale) : LinearLayout(context) {
    private val label = d.text(R.style.t_chip, d.color(R.color.ink)).apply { maxLines = 2 }

    init {
        addView(pillBase(context, d).apply {
            val h = d.dimenInt(R.dimen.space_xl)
            setPadding(h, 0, h, 0)
            addView(label)
        })
        visibility = GONE
    }

    fun show(text: String) {
        label.text = text
        visibility = if (text.isEmpty()) GONE else VISIBLE
    }
}

/**
 * NextChip: 주행 중 화면에 남는 유일한 표시. "다음"(ink-3) + "13:00 육전집 점심"(굵게, ink) 한 줄 알약이다.
 * 높이 size-chip, 왼쪽 패딩 10·오른쪽 24, surface-100에 line 테두리, 안에 size-mark-s 타일(surface-200, radius-s)과 곡 심볼.
 * 타일·"다음"·본문 사이 간격은 space-s(12)다.
 *
 * 주행 규제를 위해 표시 전용이다: 누를 수 없고(클릭·포커스 없음), 애니메이션 없이 정적인 글자뿐이다.
 * 내용이 바뀔 때만 글자를 다시 쓴다. 긴 제목은 한 줄에서 말줄임한다.
 * 접근성에는 부모의 contentDescription("다음 13:00 육전집 점심")만 읽히고 자식 글자·로고는 건너뛴다.
 */
class NextChip(context: Context, d: DesignScale) : LinearLayout(context) {
    private val label = d.text(R.style.t_chip, d.color(R.color.ink_3)).apply {
        maxLines = 1
        text = Phrases.NEXT_CHIP_LABEL
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private val body = d.text(R.style.t_chip, d.color(R.color.ink)).apply {
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
        d.semibold(this)
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private var shown = ""

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = d.shape(d.color(R.color.surface_100), d.dimen(R.dimen.radius_pill), d.color(R.color.line), d.dimen(R.dimen.hairline))
        minimumHeight = d.dimenInt(R.dimen.size_chip)
        setPadding(d.dimenInt(R.dimen.chip_pad_left), 0, d.dimenInt(R.dimen.chip_pad_right), 0)
        val mark = FrameLayout(context).apply {
            background = d.shape(d.color(R.color.surface_200), d.dimen(R.dimen.radius_s))
        }
        mark.addView(
            ImageView(context).apply {
                setImageResource(R.drawable.ic_logo_symbol)
                importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            },
            FrameLayout.LayoutParams(d.dimenInt(R.dimen.symbol_in_mark_s), d.dimenInt(R.dimen.symbol_in_mark_s), Gravity.CENTER),
        )
        addView(mark, LayoutParams(d.dimenInt(R.dimen.size_mark_s), d.dimenInt(R.dimen.size_mark_s)))
        val gap = d.dimenInt(R.dimen.space_s)
        addView(label, LayoutParams(-2, -2).apply { marginStart = gap })
        addView(body, LayoutParams(-2, -2).apply { marginStart = gap })
        // 표시 전용: 눌러도 아무 일도 없고 포커스도 받지 않는다.
        isClickable = false
        isFocusable = false
        visibility = GONE
    }

    /** [bodyText]는 "13:00 육전집 점심". 비어 있으면 숨긴다. 같은 내용이면 아무것도 다시 쓰지 않는다. */
    fun show(bodyText: String) {
        if (bodyText == shown) return
        shown = bodyText
        if (bodyText.isEmpty()) {
            visibility = GONE
            contentDescription = null
            return
        }
        body.text = bodyText
        contentDescription = "${Phrases.NEXT_CHIP_LABEL} $bodyText"
        visibility = VISIBLE
    }
}

/**
 * DuckingPill: 말하는 동안 차곡 창 안에서 볼륨을 잠깐 낮췄다고 알린다.
 * radius-pill, surface-100, line 테두리, 패딩 8×16, 스피커 18 + 글자 16(accent-ink).
 */
class DuckingPill(context: Context, d: DesignScale, text: String) : LinearLayout(context) {
    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = d.shape(d.color(R.color.surface_100), d.dimen(R.dimen.radius_pill), d.color(R.color.line), d.dimen(R.dimen.hairline))
        val h = d.dimenInt(R.dimen.status_pad_h)
        val v = d.dimenInt(R.dimen.status_pad_v)
        setPadding(h, v, h, v)
        addView(ImageView(context).apply { setImageResource(R.drawable.ic_speaker) }, LayoutParams(d.dimenInt(R.dimen.ducking_icon), d.dimenInt(R.dimen.ducking_icon)))
        addView(
            TextView(context).apply {
                this.text = text
                setTextColor(d.color(R.color.accent_ink))
                setTextSize(TypedValue.COMPLEX_UNIT_PX, d.dimen(R.dimen.ducking_text))
                typeface = resources.getFont(R.font.ibm_plex_sans_kr)
                includeFontPadding = false
                isSingleLine = true
            },
            LayoutParams(-2, -2).apply { marginStart = d.dimenInt(R.dimen.space_xs) },
        )
        visibility = GONE
    }
}

/**
 * AutoDismissBar: 남은 시간을 보이는 얇은 막대. 바탕 line, 남은 시간 ink-3. 시간이 지나는 만큼 오른쪽에서 왼쪽으로 줄어든다.
 * 시스템 애니메이션이 꺼져 있으면 움직이지 않는다(닫히는 시점은 세션의 타이머가 정한다).
 */
class AutoDismissBar(context: Context, private val d: DesignScale) : View(context) {
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = d.color(R.color.line) }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = d.color(R.color.ink_3) }
    private var remaining = 1f
    private var animator: ValueAnimator? = null

    fun start(duration: Duration) {
        animator?.cancel()
        remaining = 1f
        if (!ValueAnimator.areAnimatorsEnabled()) return
        animator = ValueAnimator.ofFloat(1f, 0f).apply {
            this.duration = duration.toMillis()
            interpolator = LinearInterpolator()
            addUpdateListener { remaining = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), d.dimenInt(R.dimen.dismiss_bar_h))
    }

    override fun onDraw(canvas: Canvas) {
        val r = height / 2f
        canvas.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), r, r, track)
        if (remaining > 0f) canvas.drawRoundRect(0f, 0f, width * remaining, height.toFloat(), r, r, fill)
    }
}
