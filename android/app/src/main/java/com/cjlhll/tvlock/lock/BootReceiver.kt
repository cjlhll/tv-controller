package com.cjlhll.tvlock.lock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val prefs = com.cjlhll.tvlock.TvLockApp.instance.prefs
        if (!prefs.setupDone && !LockController.isDeviceOwner(context)) return
        LockService.start(context)
    }
}
