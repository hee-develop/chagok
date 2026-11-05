package com.chagok.car.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

val SEOUL: ZoneId = ZoneId.of("Asia/Seoul")
val TODAY: LocalDate = LocalDate.of(2026, 12, 3)

fun at(hhmm: String, date: LocalDate = TODAY): Instant =
    date.atTime(LocalTime.parse(hhmm)).atZone(SEOUL).toInstant()

val OFFICE = Place("회사", LatLng(37.5009, 127.0363))

fun schedule(
    id: String,
    start: String,
    end: String,
    place: Place? = OFFICE,
    memo: String? = null,
) = Schedule(id = id, title = "일정 $id", start = at(start), end = at(end), place = place, memo = memo)
