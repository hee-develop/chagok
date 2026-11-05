package com.chagok.car.flow

/** 경고 로그를 남기는 얇은 인터페이스. Android 구현은 runtime의 AndroidLogger. */
fun interface Logger {
    fun warn(tag: String, message: String, error: Throwable?)

    companion object {
        /** 아무것도 남기지 않는다. */
        val None = Logger { _, _, _ -> }
    }
}
