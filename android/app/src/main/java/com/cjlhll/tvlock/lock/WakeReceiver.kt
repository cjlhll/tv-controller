package com.cjlhll.tvlock.lock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class WakeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_SCREEN_OFF,
            Intent.ACTION_DREAMING_STARTED,
            -> {
                DeviceCommands.rememberLockedFrame()
                LockController.tvStandby = true
            }
            Intent.ACTION_SCREEN_ON,
            Intent.ACTION_DREAMING_STOPPED,
            Intent.ACTION_USER_PRESENT,
            -> {
                LockController.tvStandby = false
                if (com.cjlhll.tvlock.TvLockApp.instance.prefs.setupDone) {
                    LockService.start(context, reportWake = true)
                }
            }
        }
    }
}
