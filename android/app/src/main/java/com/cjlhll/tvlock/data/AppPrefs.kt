package com.cjlhll.tvlock.data

import android.content.Context
import android.os.Build
import java.security.MessageDigest
import java.security.SecureRandom

class AppPrefs(context: Context) {
    private val sp = context.getSharedPreferences("tvlock", Context.MODE_PRIVATE)

    var serverUrl: String
        get() {
            val raw = (sp.getString("serverUrl", DEFAULT_SERVER) ?: DEFAULT_SERVER).trim()
            val migrated = canonicalizeServerUrl(raw)
            if (migrated != raw) {
                sp.edit().putString("serverUrl", migrated).apply()
            }
            return migrated
        }
        set(value) {
            sp.edit().putString("serverUrl", canonicalizeServerUrl(value.trim())).apply()
        }

    var deviceId: String
        get() = sp.getString("deviceId", "") ?: ""
        set(value) { sp.edit().putString("deviceId", value).apply() }

    var deviceSecret: String
        get() = sp.getString("deviceSecret", "") ?: ""
        set(value) { sp.edit().putString("deviceSecret", value).apply() }

    var deviceName: String
        get() = sp.getString("deviceName", Build.MODEL) ?: Build.MODEL
        set(value) { sp.edit().putString("deviceName", value).apply() }

    var setupDone: Boolean
        get() = sp.getBoolean("setupDone", false)
        set(value) { sp.edit().putBoolean("setupDone", value).apply() }

    var homeRoleAsked: Boolean
        get() = sp.getBoolean("homeRoleAsked", false)
        set(value) { sp.edit().putBoolean("homeRoleAsked", value).apply() }

    val pinSalt: String
        get() {
            val existing = sp.getString("pinSalt", "")
            if (!existing.isNullOrEmpty()) return existing
            val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
                .joinToString("") { "%02x".format(it) }
            sp.edit().putString("pinSalt", salt).apply()
            return salt
        }

    fun hasPin(): Boolean = !sp.getString("pinHash", "").isNullOrEmpty()

    fun setPin(pin: String) {
        sp.edit().putString("pinHash", hashPin(pin, pinSalt)).apply()
    }

    fun verifyPin(pin: String): Boolean {
        val stored = sp.getString("pinHash", "") ?: return false
        return stored.isNotEmpty() && stored == hashPin(pin, pinSalt)
    }

    companion object {
        const val DEFAULT_SERVER = "http://op.caojian.shop:8787/api"

        fun canonicalizeServerUrl(url: String): String {
            if (url.isEmpty()) return DEFAULT_SERVER
            if (url.contains("127.0.0.1") || url.contains("localhost") || url.contains("192.168.1.2")) {
                return DEFAULT_SERVER
            }
            return url
        }

        fun hashPin(pin: String, salt: String): String {
            val md = MessageDigest.getInstance("SHA-256")
            val bytes = md.digest("$salt:$pin".toByteArray())
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}
