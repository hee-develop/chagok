package com.chagok.car.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

enum class BoardingKind { QUICK_STOP, FIRST, AGAIN }

/**
 * 3장 '첫 탑승 / 재탑승'과 '잠깐 정차'를 가르는 기록.
 * 시동이 꺼져도 남아야 하므로 차량 앱이 영구 저장한다.
 */
data class BoardingLog(
    val lastBoardedOn: LocalDate? = null,
    val lastParkedAt: Instant? = null,
    /** 마지막 탑승 뒤에 주행(D·R)을 하고 P단에 넣은 적이 있는가. 시동 신호가 없을 때 앱 재진입을 탑승으로 볼지 가른다. */
    val parkedAfterDriveSinceBoarding: Boolean = false,
) {
    /** 5장 1단계: 마지막 P단에서 10분이 안 됐으면 잠깐 정차. 아니면 그날 첫 탑승인지 본다. */
    fun classify(now: Instant, zone: ZoneId): BoardingKind {
        val parkedAt = lastParkedAt
        if (parkedAt != null && !parkedAt.isAfter(now) && Duration.between(parkedAt, now) < Rules.QUICK_STOP) {
            return BoardingKind.QUICK_STOP
        }
        return if (lastBoardedOn == now.atZone(zone).toLocalDate()) BoardingKind.AGAIN else BoardingKind.FIRST
    }

    /**
     * 시동 신호가 없을 때 앱 진입(onResume)을 탑승으로 인정할지: 그날 첫 진입이거나,
     * 마지막 탑승 뒤 주행하고 P단에 넣은 적이 있을 때만. 내비·진단 화면에서 돌아오기는 해당 없음.
     */
    fun acceptsAppEntry(now: Instant, zone: ZoneId): Boolean =
        lastBoardedOn != now.atZone(zone).toLocalDate() || parkedAfterDriveSinceBoarding

    fun boarded(now: Instant, zone: ZoneId) =
        copy(lastBoardedOn = now.atZone(zone).toLocalDate(), parkedAfterDriveSinceBoarding = false)

    /** 주행(D·R)한 뒤 P단에 넣었을 때만 부른다. */
    fun parked(now: Instant) = copy(lastParkedAt = now, parkedAfterDriveSinceBoarding = true)
}
