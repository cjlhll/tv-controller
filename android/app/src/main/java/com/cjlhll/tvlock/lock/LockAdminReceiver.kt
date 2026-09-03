package com.cjlhll.tvlock.lock

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

class LockAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        LockController.prepareLockTask(context)
        LockController.blockUninstall(context)
        LockController.hideLauncherIcon(context)
    }
}
