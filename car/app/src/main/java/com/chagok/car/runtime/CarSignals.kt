package com.chagok.car.runtime

import android.car.Car
import android.car.VehicleGear
import android.car.VehicleIgnitionState
import android.car.VehiclePropertyIds
import android.car.drivingstate.CarUxRestrictions
import android.car.drivingstate.CarUxRestrictionsManager
import android.car.hardware.CarPropertyConfig
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import android.util.Log
import com.chagok.car.domain.Gear
import com.chagok.car.domain.Ignition
import com.chagok.car.flow.Event

/**
 * AAOS Car API의 기어·시동·주행 제한을 세션 이벤트로 바꾼다.
 * 주행 제한은 [start]에서, 기어·시동은 [startPermissionGated]에서 시작한다.
 * 시동(IGNITION_STATE) 설정이 있으면 읽은 값을 그대로 세션에 넣고(탑승·Suspend 판단은 세션이 한다),
 * 없으면 [onIgnitionSupport]에 false를 알려 호출한 쪽이 앱 진입(onResume)을 탑승 신호로 쓰게 한다.
 */
class CarSignals(
    private val context: Context,
    private val sink: (Event) -> Unit,
    private val onIgnitionSupport: (Boolean) -> Unit,
) : VehicleSignals {
    private var car: Car? = null
    private var propertyManager: CarPropertyManager? = null
    private var uxManager: CarUxRestrictionsManager? = null

    private val callback = object : CarPropertyManager.CarPropertyEventCallback {
        override fun onChangeEvent(value: CarPropertyValue<*>) = handle(value.propertyId, value.value)
        override fun onErrorEvent(propertyId: Int, areaId: Int) {
            Log.w(TAG, "속성 오류 id=$propertyId area=$areaId")
        }
    }

    /** Car에 연결하고 주행 제한 신호를 시작한다. 여러 번 불러도 한 번만 연결한다. */
    override fun start() {
        if (car != null) return
        val connected = try {
            Car.createCar(context)
        } catch (e: Throwable) {
            Log.w(TAG, "Car 연결 실패", e)
            null
        }
        if (connected == null) {
            onIgnitionSupport(false)
            return
        }
        car = connected

        val ux = connected.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as CarUxRestrictionsManager
        uxManager = ux
        ux.currentCarUxRestrictions?.let { sink(Event.RestrictionChanged(restrictsDriving(it))) }
        ux.registerListener { sink(Event.RestrictionChanged(restrictsDriving(it))) }
    }

    /** 기어·시동 속성을 읽고 구독한다. 필요한 권한을 받은 뒤 부른다. 여러 번 불러도 한 번만 시작한다. */
    override fun startPermissionGated() {
        val connected = car ?: return
        if (propertyManager != null) return
        val pm = connected.getCarManager(Car.PROPERTY_SERVICE) as CarPropertyManager
        propertyManager = pm
        val ignitionSupported = pm.getCarPropertyConfig(VehiclePropertyIds.IGNITION_STATE) != null

        // 구독 전에 현재 값을 먼저 읽어 세션에 알린다. 세션이 '이미 켜진 채 시작'과 '켜지는 전환'을 가른다.
        readOnce(pm, VehiclePropertyIds.GEAR_SELECTION)
        if (ignitionSupported) readOnce(pm, VehiclePropertyIds.IGNITION_STATE)
        listOfNotNull(
            VehiclePropertyIds.GEAR_SELECTION,
            VehiclePropertyIds.IGNITION_STATE.takeIf { ignitionSupported },
        ).forEach { subscribe(pm, it) }

        onIgnitionSupport(ignitionSupported)
    }

    override fun stop() {
        propertyManager?.unregisterCallback(callback)
        uxManager?.unregisterListener()
        car?.disconnect()
        car = null
        propertyManager = null
        uxManager = null
    }

    /** 주행 제한: distraction optimization이 필요하거나 설정 조작 금지(NO_SETUP)가 켜져 있다. */
    private fun restrictsDriving(restrictions: CarUxRestrictions) =
        restrictions.isRequiresDistractionOptimization ||
            (restrictions.activeRestrictions and CarUxRestrictions.UX_RESTRICTIONS_NO_SETUP) != 0

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

    private fun readOnce(pm: CarPropertyManager, propertyId: Int) {
        try {
            handle(propertyId, pm.getProperty<Any>(propertyId, GLOBAL_AREA)?.value)
        } catch (e: Exception) {
            Log.w(TAG, "읽기 실패 id=$propertyId", e)
        }
    }

    private fun handle(propertyId: Int, value: Any?) {
        when (propertyId) {
            VehiclePropertyIds.GEAR_SELECTION -> (value as? Int)?.let { sink(Event.GearChanged(gearOf(it))) }
            VehiclePropertyIds.IGNITION_STATE -> (value as? Int)?.let { sink(Event.IgnitionChanged(ignitionOf(it))) }
        }
    }

    private fun ignitionOf(value: Int) = when (value) {
        VehicleIgnitionState.LOCK -> Ignition.LOCK
        VehicleIgnitionState.OFF -> Ignition.OFF
        VehicleIgnitionState.ACC -> Ignition.ACC
        VehicleIgnitionState.ON -> Ignition.ON
        VehicleIgnitionState.START -> Ignition.START
        else -> Ignition.UNDEFINED
    }

    private fun gearOf(value: Int) = when (value) {
        VehicleGear.GEAR_PARK -> Gear.PARK
        VehicleGear.GEAR_NEUTRAL -> Gear.NEUTRAL
        VehicleGear.GEAR_REVERSE -> Gear.REVERSE
        VehicleGear.GEAR_DRIVE -> Gear.DRIVE
        else -> Gear.UNKNOWN
    }

    private companion object {
        const val TAG = "ChagokCarSignals"
        const val GLOBAL_AREA = 0
    }
}
