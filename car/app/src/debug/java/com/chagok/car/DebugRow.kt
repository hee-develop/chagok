package com.chagok.car

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import com.chagok.car.domain.Gear
import com.chagok.car.flow.Event
import com.chagok.car.runtime.SessionHost
import java.time.Duration

/**
 * 디버그 빌드 전용 버튼 줄(탑승·주행·정차·시간·초기화). 릴리스 소스셋에는 null을 돌려주는 같은 이름의 객체가 있다.
 * 창 아래쪽 오른편에 가로로 놓고 글자는 작게 쓴다(카드 아래 빈 자리).
 * [탑승]은 앱 진입 규칙을 건너뛰고 바로 탑승으로 처리한다.
 * [주행]·[정차]는 기어 D·P 이벤트를 넣는다.
 */
object DebugRow {
    fun create(activity: Activity, host: SessionHost): View = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(button(activity, "탑승") { host.post(Event.Boarded) })
        addView(button(activity, "주행") { host.post(Event.GearChanged(Gear.DRIVE)) })
        addView(button(activity, "정차") { host.post(Event.GearChanged(Gear.PARK)) })
        addView(button(activity, "시간 +10분") { host.advanceClock(Duration.ofMinutes(10)) })
        addView(button(activity, "데모 초기화") { host.resetDemo() })
    }

    private fun button(activity: Activity, label: String, onClick: () -> Unit) = Button(activity).apply {
        text = label
        textSize = 12f
        isAllCaps = false
        setOnClickListener { onClick() }
    }
}
