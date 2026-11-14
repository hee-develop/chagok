package com.chagok.car

import android.app.Activity
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.chagok.car.domain.Gear
import com.chagok.car.fakenavi.FakeNaviSession
import com.chagok.car.flow.Event
import com.chagok.car.runtime.SessionHost
import java.time.Duration

/**
 * 디버그 빌드 전용 버튼 줄(탑승·주행·정차·도착·시간·초기화). 릴리스 소스셋에는 null을 돌려주는 같은 이름의 객체가 있다.
 * 창 아래쪽 오른편에 놓고 글자는 작게 쓴다(카드 아래 빈 자리). 세로 창에서 넘치지 않게 버튼을 좁게 만들고 두 줄로 나눈다:
 * 윗줄은 탑승·주행·정차·도착·시간·초기화, 아랫줄은 [가짜 내비]와 "들은 말 처리: …" 글자.
 * [탑승]은 앱 진입 규칙을 건너뛰고 바로 탑승으로 처리한다.
 * [주행]·[정차]는 기어 D·P 이벤트를 넣는다. [도착]은 내비 목적지 도착 알림을 넣는다(차곡이 길안내를 시작한 일정이 도착이 된다).
 * [가짜 내비]는 가짜 길안내 지도를 켜고 끈다(글자에 지금 상태를 보인다). [데모 초기화]는 가짜 경로도 지운다.
 */
object DebugRow {
    fun create(activity: Activity, host: SessionHost): View {
        fun row() = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }
        val top = row().apply {
            addView(button(activity, "탑승") { host.post(Event.Boarded) })
            addView(button(activity, "주행") { host.post(Event.GearChanged(Gear.DRIVE)) })
            addView(button(activity, "정차") { host.post(Event.GearChanged(Gear.PARK)) })
            addView(button(activity, "도착") { host.post(Event.DestinationArrived) })
            addView(button(activity, "시간 +10분") {
                host.advanceClock(Duration.ofMinutes(10))
                // 가짜 내비 패널의 도착 예정 시각도 바로 갱신한다.
                FakeNaviSession.shared.onChanged?.invoke()
            })
            addView(button(activity, "데모 초기화") {
                FakeNaviSession.shared.clear()
                host.resetDemo()
            })
        }
        val navi = button(activity, "") { FakeNaviSession.shared.setEnabled(!FakeNaviSession.shared.enabled) }
        fun showNavi(on: Boolean) { navi.text = if (on) "가짜 내비 켬" else "가짜 내비 끔" }
        showNavi(FakeNaviSession.shared.enabled)
        FakeNaviSession.shared.onModeChanged = ::showNavi
        // 남은 폭만 쓰고 넘치면 화면에서만 말줄임(접근성 text는 전체 그대로)
        val heard = TextView(activity).apply {
            textSize = 12f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        DebugInjection.heardProcessed = { heard.text = "들은 말 처리: $it" }
        val bottom = row().apply {
            addView(navi)
            addView(heard, LinearLayout.LayoutParams(0, -2, 1f))
        }
        return LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(top)
            // 폭은 윗줄에 맞춘다. 들은 말 글자는 그 안의 남은 폭만 쓴다.
            addView(bottom, LinearLayout.LayoutParams(-1, -2))
        }
    }

    private fun button(activity: Activity, label: String, onClick: () -> Unit) = Button(activity).apply {
        text = label
        textSize = 12f
        isAllCaps = false
        minWidth = 0
        minimumWidth = 0
        val pad = (8 * resources.displayMetrics.density).toInt()
        setPadding(pad, paddingTop, pad, paddingBottom)
        setOnClickListener { onClick() }
    }
}
