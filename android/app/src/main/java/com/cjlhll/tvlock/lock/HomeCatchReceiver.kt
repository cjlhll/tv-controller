package com.cjlhll.tvlock.lock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class HomeCatchReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_CLOSE_SYSTEM_DIALOGS) return
        if (LockController.allowLeave) return
        if (!LockController.shouldShowLock(SessionBus.last)) return
        val reason = intent.getStringExtra("reason")
        if (reason != null && reason != "homekey" && reason != "recentapps") return
        LockController.launchLock(context, force = true)
    }
}
