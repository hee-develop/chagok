package com.chagok.car.runtime

import android.car.Car
import android.car.VehiclePropertyIds
import android.car.hardware.CarPropertyConfig
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import android.util.Log
import com.chagok.car.domain.EnergyKind
import com.chagok.car.flow.Event
import kotlin.math.abs

/**
 * AAOS Car API의 연료 종류(`INFO_FUEL_TYPE`, 권한 `CAR_INFO`)와 주행 가능 거리(`RANGE_REMAINING`, 단위 미터, 권한 `CAR_ENERGY`)를 읽어
 * [Event.EnergyChanged]로 알린다(km로 바꿔). 못 읽는 쪽(속성 없음·권한 거부·예외)은 null이라 세션이 에너지 체크를 하지 않는다.
 *
 * 주행 가능 거리는 달리는 동안 계속 바뀌므로 [REPORT_STEP_KM] 이상 달라졌을 때만 다시 알린다(이벤트·로그가 쌓이지 않게).
 * 실차에서 두 권한의 등급(normal·dangerous)과 단위는 `docs/sdk-check.md`의 확인 항목이다. 런타임 동의 대상이면 [com.chagok.car.ChagokApp.RUNTIME_PERMISSIONS]에 더한다.
 */
class EnergyAdapter(
    private val context: Context,
    private val sink: (Event) -> Unit,
) : EnergySignals {
    private var car: Car? = null
    private var propertyManager: CarPropertyManager? = null

    private var kind: EnergyKind? = null
    private var rangeKm: Double? = null

    /** 마지막으로 알린 값. 같으면 다시 알리지 않는다. */
    private var reportedKind: EnergyKind? = null
    private var reportedRange: Double? = null
    private var reportedOnce = false

    private val callback = object : CarPropertyManager.CarPropertyEventCallback {
        override fun onChangeEvent(value: CarPropertyValue<*>) {
            if (value.propertyId == VehiclePropertyIds.RANGE_REMAINING) {
                rangeKm = rangeKmOf(value.value)
                report()
            }
        }

        override fun onErrorEvent(propertyId: Int, areaId: Int) {
            Log.w(TAG, "속성 오류 id=$propertyId area=$areaId")
        }
    }

    override fun start() {
        if (car != null) return
        val connected = try {
            Car.createCar(context)
        } catch (e: Throwable) {
            Log.w(TAG, "Car 연결 실패", e)
            null
        } ?: return
        car = connected
        val pm = try {
            connected.getCarManager(Car.PROPERTY_SERVICE) as? CarPropertyManager
        } catch (e: Throwable) {
            Log.w(TAG, "속성 관리자 없음", e)
            null
        }
        propertyManager = pm
        if (pm != null) {
            kind = fuelKindOf(read(pm, VehiclePropertyIds.INFO_FUEL_TYPE))
            rangeKm = rangeKmOf(read(pm, VehiclePropertyIds.RANGE_REMAINING))
            subscribe(pm, VehiclePropertyIds.RANGE_REMAINING)
        }
        // 못 읽었어도(null) 한 번은 알려 세션이 '모름'으로 안다.
        reportedOnce = false
        report()
    }

    override fun stop() {
        propertyManager?.unregisterCallback(callback)
        car?.disconnect()
        car = null
        propertyManager = null
    }

    private fun report() {
        val k = kind
        val r = rangeKm
        val changed = !reportedOnce || k != reportedKind || !sameRange(r, reportedRange)
        if (!changed) return
        reportedOnce = true
        reportedKind = k
        reportedRange = r
        sink(Event.EnergyChanged(k, r))
    }

    private fun sameRange(a: Double?, b: Double?): Boolean = when {
        a == null || b == null -> a == b
        else -> abs(a - b) < REPORT_STEP_KM
    }

    private fun read(pm: CarPropertyManager, propertyId: Int): Any? = try {
        if (pm.getCarPropertyConfig(propertyId) == null) null else pm.getProperty<Any>(propertyId, GLOBAL_AREA)?.value
    } catch (e: Exception) {
        // 권한 거부(SecurityException)·값 없음 모두 '모름'으로 둔다.
        Log.w(TAG, "읽기 실패 id=$propertyId", e)
        null
    }

    private fun subscribe(pm: CarPropertyManager, propertyId: Int) {
        val config = pm.getCarPropertyConfig(propertyId) ?: return
        val rate = if (config.changeMode == CarPropertyConfig.VEHICLE_PROPERTY_CHANGE_MODE_CONTINUOUS) {
            CarPropertyManager.SENSOR_RATE_NORMAL
        } else {
            CarPropertyManager.SENSOR_RATE_ONCHANGE
        }
        try {
            pm.registerCallback(callback, propertyId, rate)
        } catch (e: Exception) {
            Log.w(TAG, "구독 실패 id=$propertyId", e)
        }
    }

    private companion object {
        const val TAG = "ChagokEnergy"
        const val GLOBAL_AREA = 0
        const val REPORT_STEP_KM = 2.0

        /** INFO_FUEL_TYPE는 연료 목록(int 배열)이다. 배열 모양은 구현마다 달라 둘 다 받는다. */
        fun fuelKindOf(value: Any?): EnergyKind? {
            val types = when (value) {
                is IntArray -> value.toList()
                is Array<*> -> value.mapNotNull { it as? Int }
                is Int -> listOf(value)
                else -> return null
            }
            return EnergyKind.fromFuelTypes(types)
        }

        /** RANGE_REMAINING은 미터(float). km로 바꾸고 음수·NaN은 모름이다. */
        fun rangeKmOf(value: Any?): Double? =
            (value as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0.0 }?.div(1000.0)
    }
}
