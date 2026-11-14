package com.chagok.car.runtime

import android.content.Context
import com.chagok.car.flow.ScheduleCopyStore
import com.chagok.car.flow.Snapshot
import com.chagok.car.flow.StoredCopy
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 세션 상태(JSON, [SnapshotCodec]), 데모 기준 시각, 마지막으로 받은 일정 응답, 익명 차 id·휴대폰 연결 여부를 SharedPreferences에 둔다. */
class ChagokStore(context: Context) : ScheduleCopyStore {
    private val prefs = context.getSharedPreferences("chagok_state", Context.MODE_PRIVATE)

    fun load(): Snapshot? = prefs.getString(KEY_SNAPSHOT, null)?.let(SnapshotCodec::decode)

    fun save(snapshot: Snapshot) {
        prefs.edit().putString(KEY_SNAPSHOT, SnapshotCodec.encode(snapshot)).apply()
    }

    /** 데모 일정의 기준 시각. 처음이면 지금으로 정한다. */
    fun anchor(clock: Clock): Instant {
        val saved = prefs.getLong(KEY_ANCHOR, NONE)
        if (saved != NONE) return Instant.ofEpochMilli(saved)
        return clock.instant().also { setAnchor(it) }
    }

    fun setAnchor(instant: Instant) {
        prefs.edit().putLong(KEY_ANCHOR, instant.toEpochMilli()).apply()
    }

    override fun loadCopy(): StoredCopy? {
        val body = prefs.getString(KEY_COPY_BODY, null) ?: return null
        val date = prefs.getString(KEY_COPY_DATE, null)?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return null
        return StoredCopy(body, date)
    }

    override fun saveCopy(copy: StoredCopy) {
        prefs.edit().putString(KEY_COPY_BODY, copy.body).putString(KEY_COPY_DATE, copy.date.toString()).apply()
    }

    override fun clearCopy() {
        prefs.edit().remove(KEY_COPY_BODY).remove(KEY_COPY_DATE).apply()
    }

    /** 설치 때 한 번 만드는 익명 차 id(UUID). 휴대폰과 연결할 때 서버에 보낸다. 사람·차량 식별 정보는 담지 않는다. */
    @Synchronized
    fun carId(): String = prefs.getString(KEY_CAR_ID, null) ?: UUID.randomUUID().toString().also {
        prefs.edit().putString(KEY_CAR_ID, it).apply()
    }

    /** 휴대폰과 연결돼 있는가. 한 번 연결되면 데모 초기화(디버그)로 풀 때까지 그대로다. */
    var paired: Boolean
        get() = prefs.getBoolean(KEY_PAIRED, false)
        set(value) {
            prefs.edit().putBoolean(KEY_PAIRED, value).apply()
        }

    private companion object {
        const val NONE = Long.MIN_VALUE
        const val KEY_SNAPSHOT = "snapshot"
        const val KEY_ANCHOR = "demoAnchor"
        const val KEY_COPY_BODY = "scheduleCopyBody"
        const val KEY_COPY_DATE = "scheduleCopyDate"
        const val KEY_CAR_ID = "carId"
        const val KEY_PAIRED = "paired"
    }
}
