package com.cjlhll.tvlock.lock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (!com.cjlhll.tvlock.TvLockApp.instance.prefs.setupDone) return
        LockService.start(context)
    }
}
