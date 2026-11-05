package com.chagok.car

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner

/** 계측 테스트에서는 가짜 신호·고정 시계·픽스처 일정을 쓰는 [E2eApp]으로 앱을 띄운다. */
class E2eRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader, className: String, context: Context): Application =
        super.newApplication(cl, E2eApp::class.java.name, context)
}
