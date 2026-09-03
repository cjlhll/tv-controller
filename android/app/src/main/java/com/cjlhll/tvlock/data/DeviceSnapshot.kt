package com.cjlhll.tvlock.data

import org.json.JSONObject

data class DeviceSnapshot(
    val deviceId: String,
    val name: String,
    val form: String,
    val status: String,
    val unlockUntil: Long,
    val boundCount: Int,
    val pairToken: String = "",
    val pairTokenExpireAt: Long = 0,
    val pendingCommand: String = "",
    val screenshotAt: Long = 0,
    val pin: String = "",
    val pinDurationMin: Int = 30,
) {
    val isUnlocked: Boolean
        get() = status == "unlocked" && unlockUntil > System.currentTimeMillis()

    val isUnbound: Boolean
        get() = status == "unbound" || boundCount <= 0

    companion object {
        fun from(obj: JSONObject?): DeviceSnapshot? {
            if (obj == null) return null
            val device = obj.optJSONObject("device") ?: obj
            return DeviceSnapshot(
                deviceId = device.optString("deviceId"),
                name = device.optString("name"),
                form = device.optString("form"),
                status = device.optString("status"),
                unlockUntil = device.optLong("unlockUntil"),
                boundCount = device.optInt("boundCount"),
                pairToken = obj.optString("pairToken", device.optString("pairToken")),
                pairTokenExpireAt = obj.optLong("pairTokenExpireAt", device.optLong("pairTokenExpireAt")),
                pendingCommand = obj.optString("pendingCommand", device.optString("pendingCommand")),
                screenshotAt = obj.optLong("screenshotAt", device.optLong("screenshotAt")),
                pin = device.optString("pin"),
                pinDurationMin = device.optInt("pinDurationMin", 30).coerceIn(1, 24 * 60),
            )
        }
    }
}
