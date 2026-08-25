package com.cjlhll.tvlock.lock

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.os.UserManager

/**
 * 电视锁定时禁止调音量。遥控器音量键由系统在到达 Activity 前处理，
 * 只能靠 Device Owner 限制 + 监听回滚。
 */
object LockVolumeGuard {
    private val streams = intArrayOf(
        AudioManager.STREAM_VOICE_CALL,
        AudioManager.STREAM_SYSTEM,
        AudioManager.STREAM_RING,
        AudioManager.STREAM_MUSIC,
        AudioManager.STREAM_ALARM,
        AudioManager.STREAM_NOTIFICATION,
        AudioManager.STREAM_DTMF,
        AudioManager.STREAM_ACCESSIBILITY,
    )

    @Volatile
    private var enabled = false

    @Volatile
    private var reverting = false

    private var frozen: Map<Int, Int>? = null
    private var receiver: BroadcastReceiver? = null

    @Synchronized
    fun sync(context: Context, locked: Boolean) {
        if (!LockController.isTelevision(context)) {
            disable(context)
            return
        }
        if (locked && !LockController.allowLeave) {
            enable(context)
        } else {
            disable(context)
        }
    }

    private fun enable(context: Context) {
        val app = context.applicationContext
        setAdjustBlocked(app, true)
        if (enabled) return
        enabled = true
        frozen = snapshot(app)
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                if (!enabled || reverting) return
                restore(app)
            }
        }
        receiver = r
        val filter = IntentFilter("android.media.VOLUME_CHANGED_ACTION")
        if (Build.VERSION.SDK_INT >= 33) {
            app.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            app.registerReceiver(r, filter)
        }
    }

    private fun disable(context: Context) {
        val app = context.applicationContext
        enabled = false
        receiver?.let {
            try {
                app.unregisterReceiver(it)
            } catch (_: Exception) {
            }
        }
        receiver = null
        frozen = null
        setAdjustBlocked(app, false)
    }

    private fun snapshot(context: Context): Map<Int, Int> {
        val am = context.getSystemService(AudioManager::class.java)
        return streams.associateWith { stream ->
            try {
                am.getStreamVolume(stream)
            } catch (_: Exception) {
                0
            }
        }
    }

    private fun restore(context: Context) {
        val saved = frozen ?: return
        val am = context.getSystemService(AudioManager::class.java)
        reverting = true
        try {
            for ((stream, want) in saved) {
                try {
                    if (am.getStreamVolume(stream) != want) {
                        am.setStreamVolume(stream, want, 0)
                    }
                } catch (_: Exception) {
                }
            }
        } finally {
            reverting = false
        }
    }

    private fun setAdjustBlocked(context: Context, blocked: Boolean) {
        if (!LockController.isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = LockController.adminComponent(context)
        try {
            if (blocked) {
                dpm.addUserRestriction(admin, UserManager.DISALLOW_ADJUST_VOLUME)
            } else {
                dpm.clearUserRestriction(admin, UserManager.DISALLOW_ADJUST_VOLUME)
            }
        } catch (_: Exception) {
        }
    }
}
