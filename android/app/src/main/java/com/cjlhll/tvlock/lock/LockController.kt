package com.cjlhll.tvlock.lock

import android.app.Activity
import android.app.ActivityManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.cjlhll.tvlock.R
import com.cjlhll.tvlock.data.DeviceSnapshot
import com.cjlhll.tvlock.ui.LockActivity

object LockController {
    fun adminComponent(context: Context): ComponentName =
        ComponentName(context, LockAdminReceiver::class.java)

    fun isDeviceOwner(context: Context): Boolean {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        return dpm.isDeviceOwnerApp(context.packageName)
    }

    fun prepareLockTask(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        dpm.setLockTaskPackages(adminComponent(context), arrayOf(context.packageName))
    }

    fun startLockTaskSafe(activity: Activity) {
        if (!isDeviceOwner(activity)) return
        try {
            prepareLockTask(activity)
            val am = activity.getSystemService(ActivityManager::class.java)
            if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.startLockTask()
            }
        } catch (_: Exception) {
        }
    }

    fun stopLockTaskSafe(activity: Activity) {
        try {
            val am = activity.getSystemService(ActivityManager::class.java)
            if (am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.stopLockTask()
            }
        } catch (_: Exception) {
        }
    }

    fun launchLock(context: Context, force: Boolean = false) {
        val last = SessionBus.last
        if (!force && last?.isUnlocked == true) return
        val intent = Intent(context, LockActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val canOverlay = Settings.canDrawOverlays(context)
        if (canOverlay || context is Activity) {
            context.startActivity(intent)
            return
        }
        showFullScreenNotice(context)
        try {
            context.startActivity(intent)
        } catch (_: Exception) {
        }
    }

    fun goHome(context: Context) {
        val home = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(home)
    }

    fun shouldShowLock(snapshot: DeviceSnapshot?): Boolean {
        if (snapshot == null) return true
        return !snapshot.isUnlocked
    }

    private fun showFullScreenNotice(context: Context) {
        val pending = PendingIntent.getActivity(
            context,
            1,
            Intent(context, LockActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, LockService.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_lock)
            .setContentTitle(context.getString(R.string.lock_title))
            .setContentText(context.getString(R.string.lock_pending))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(pending, true)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        if (Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            NotificationManagerCompat.from(context).notify(1002, n)
        }
    }
}
