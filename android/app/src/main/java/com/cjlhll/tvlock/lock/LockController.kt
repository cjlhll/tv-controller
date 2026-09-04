package com.cjlhll.tvlock.lock

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.cjlhll.tvlock.R
import com.cjlhll.tvlock.TvLockApp
import com.cjlhll.tvlock.data.DeviceSnapshot
import com.cjlhll.tvlock.ui.LockActivity

object LockController {
    @Volatile
    var lockForeground: Boolean = false

    @Volatile
    var allowLeave: Boolean = false

    @Volatile
    var lockActivity: Activity? = null

    @Volatile
    var tvStandby: Boolean = false

    private const val HOME_ALIAS = "com.cjlhll.tvlock.TvHomeAlias"
    private const val LAUNCHER_ALIAS = "com.cjlhll.tvlock.LauncherAlias"
    private const val TAG = "TvLock"
    private const val SHOT_RETRY_FAST_MS = 2_000L
    private const val SHOT_RETRY_SLOW_MS = 30_000L

    @Volatile
    private var nextShotEnableAt = 0L

    @Volatile
    private var shotEnableNeedsBounce = false

    fun adminComponent(context: Context): ComponentName =
        ComponentName(context, LockAdminReceiver::class.java)

    fun isTelevision(context: Context): Boolean {
        val pm = context.packageManager
        return pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            pm.hasSystemFeature("android.software.leanback") ||
            Build.MODEL.contains("BRAVIA", ignoreCase = true)
    }

    fun isDeviceOwner(context: Context): Boolean {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        return dpm.isDeviceOwnerApp(context.packageName)
    }

    fun prepareLockTask(context: Context) {
        if (!isDeviceOwner(context)) return
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = adminComponent(context)
        dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
        if (isTelevision(context) && Build.VERSION.SDK_INT >= 28) {
            try {
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
            } catch (_: Exception) {
            }
        }
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

    fun applyLocked(activity: Activity) {
        setTvHomeEnabled(activity, true)
        startLockTaskSafe(activity)
        LockVolumeGuard.sync(activity, true)
    }

    fun applyUnlocked(activity: Activity) {
        LockVolumeGuard.sync(activity, false)
        setTvHomeEnabled(activity, false)
        stopLockTaskSafe(activity)
        launchOtherHome(activity)
    }

    fun hardenInstalledApp(context: Context) {
        applyUninstallPolicy(context)
        enableShotService(context)
    }

    fun enableShotService(context: Context) {
        if (ShotService.instance != null) {
            shotEnableNeedsBounce = false
            try {
                persistShotServiceSettings(context)
            } catch (_: Exception) {
            }
            return
        }
        val now = SystemClock.uptimeMillis()
        if (now < nextShotEnableAt) return
        nextShotEnableAt = now + SHOT_RETRY_FAST_MS

        val cn = ComponentName(context, ShotService::class.java)
        val longName = cn.flattenToString()
        grantWriteSecureSettings(context)

        if (isDeviceOwner(context)) {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            val admin = adminComponent(context)
            try {
                dpm.setPermittedAccessibilityServices(admin, listOf(context.packageName))
            } catch (_: Exception) {
            }
            try {
                dpm.setSecureSetting(admin, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, longName)
            } catch (_: Exception) {
            }
            try {
                dpm.setSecureSetting(admin, Settings.Secure.ACCESSIBILITY_ENABLED, "1")
            } catch (_: Exception) {
            }
        }

        val cr = context.contentResolver
        try {
            val listed = persistShotServiceSettings(context)
            val enabled = Settings.Secure.getInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 0)
            if (listed && enabled == 1 && shotEnableNeedsBounce) {
                Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 0)
                Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
                shotEnableNeedsBounce = false
                nextShotEnableAt = now + SHOT_RETRY_SLOW_MS
                return
            }
            shotEnableNeedsBounce = listed && enabled == 1
        } catch (e: SecurityException) {
            Log.w(TAG, "ShotService needs WRITE_SECURE_SETTINGS", e)
            nextShotEnableAt = now + SHOT_RETRY_SLOW_MS
        } catch (e: Exception) {
            Log.w(TAG, "ShotService enable failed", e)
            nextShotEnableAt = now + SHOT_RETRY_SLOW_MS
        }
    }

    private fun persistShotServiceSettings(context: Context): Boolean {
        val cr = context.contentResolver
        val cn = ComponentName(context, ShotService::class.java)
        val longName = cn.flattenToString()
        val shortName = cn.flattenToShortString()
        var listed = isShotComponentListed(cr, longName, shortName)
        if (!listed) {
            val cur = Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
            val parts = cur.split(':').filter { it.isNotBlank() }
            Settings.Secure.putString(
                cr,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                (parts + longName).joinToString(":"),
            )
            listed = true
        }
        if (Settings.Secure.getInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 0) != 1) {
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        }
        return listed
    }

    private fun grantWriteSecureSettings(context: Context) {
        if (context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        if (!isDeviceOwner(context)) return
        try {
            context.getSystemService(DevicePolicyManager::class.java).setPermissionGrantState(
                adminComponent(context),
                context.packageName,
                Manifest.permission.WRITE_SECURE_SETTINGS,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
            )
        } catch (_: Exception) {
        }
    }

    private fun isShotComponentListed(cr: ContentResolver, longName: String, shortName: String): Boolean {
        val cur = Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return cur.split(':').any { it == longName || it == shortName }
    }

    fun hideLauncherIcon(context: Context) {
        val pm = context.packageManager
        val cn = ComponentName(context, LAUNCHER_ALIAS)
        val prefs = TvLockApp.instance.prefs
        try {
            val alreadyHidden =
                pm.getComponentEnabledSetting(cn) == PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            // 索尼等桌面会把已禁用入口留成黑图标，直到再收到一次组件变更。
            if (alreadyHidden && !prefs.launcherHidden) {
                pm.setComponentEnabledSetting(
                    cn,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP,
                )
            } else if (alreadyHidden) {
                prefs.launcherHidden = true
                return
            }
            pm.setComponentEnabledSetting(
                cn,
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
            prefs.launcherHidden = true
        } catch (_: Exception) {
        }
    }

    fun showLauncherIcon(context: Context) {
        setComponentEnabled(context, LAUNCHER_ALIAS, true)
        TvLockApp.instance.prefs.launcherHidden = false
    }

    fun syncLauncherIcon(context: Context, bound: Boolean) {
        val allow = TvLockApp.instance.prefs.allowUninstall
        if (!TvLockApp.instance.prefs.setupDone || !bound || allow) {
            showLauncherIcon(context)
        } else {
            hideLauncherIcon(context)
        }
        syncPackageHidden(context, bound)
    }

    /** 绑定完成且禁止卸载时，从系统/索尼桌面应用列表隐藏整包（含 Emotion UI 添加快捷应用）。 */
    fun syncPackageHidden(context: Context, bound: Boolean) {
        val prefs = TvLockApp.instance.prefs
        val hide = prefs.setupDone && bound && !prefs.allowUninstall && isDeviceOwner(context)
        setPackageHidden(context, hide)
    }

    private fun setPackageHidden(context: Context, hidden: Boolean) {
        if (!isDeviceOwner(context)) return
        try {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            // Device Owner 同时是 active device admin，系统会拒绝 hide（log: has active device admin）。
            dpm.setApplicationHidden(adminComponent(context), context.packageName, hidden)
        } catch (_: Exception) {
        }
    }

    fun applyUninstallPolicy(context: Context, allowUninstall: Boolean = TvLockApp.instance.prefs.allowUninstall) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = adminComponent(context)
        try {
            dpm.setUninstallBlocked(admin, context.packageName, !allowUninstall)
        } catch (_: Exception) {
        }
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                dpm.setUserControlDisabledPackages(
                    admin,
                    if (allowUninstall) emptyList() else listOf(context.packageName),
                )
            } catch (_: Exception) {
            }
        }
        try {
            dpm.clearUserRestriction(admin, android.os.UserManager.DISALLOW_UNINSTALL_APPS)
        } catch (_: Exception) {
        }
        if (allowUninstall) {
            setPackageHidden(context, false)
            releaseDeviceOwner(context)
        } else {
            val bound = SessionBus.last?.isUnbound == false
            syncPackageHidden(context, bound)
        }
    }

    fun startSystemUninstall(context: Context) {
        if (!TvLockApp.instance.prefs.allowUninstall) return
        applyUninstallPolicy(context, true)
        releaseDeviceOwner(context)
        val intent = Intent(Intent.ACTION_DELETE).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (_: Exception) {
        }
    }

    private fun releaseDeviceOwner(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = adminComponent(context)
        try {
            @Suppress("DEPRECATION")
            dpm.clearDeviceOwnerApp(context.packageName)
        } catch (_: Exception) {
        }
        try {
            dpm.removeActiveAdmin(admin)
        } catch (_: Exception) {
        }
    }

    fun blockUninstall(context: Context) {
        applyUninstallPolicy(context, false)
    }

    private fun setComponentEnabled(context: Context, className: String, enabled: Boolean) {
        val pm = context.packageManager
        val cn = ComponentName(context, className)
        val state = if (enabled) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }
        try {
            if (pm.getComponentEnabledSetting(cn) != state) {
                pm.setComponentEnabledSetting(cn, state, PackageManager.DONT_KILL_APP)
            }
        } catch (_: Exception) {
        }
    }

    fun setTvHomeEnabled(context: Context, enabled: Boolean) {
        if (!isTelevision(context)) return
        setComponentEnabled(context, HOME_ALIAS, enabled)
    }

    fun sleepDevice(context: Context): Boolean {
        tvStandby = true
        val slept = ShotService.lockScreen() || lockNowSafe(context) || goToSleepSafe(context)
        if (!slept) {
            val pm = context.getSystemService(PowerManager::class.java)
            if (pm.isInteractive) tvStandby = false
        }
        return slept
    }

    private fun lockNowSafe(context: Context): Boolean {
        if (!isDeviceOwner(context)) return false
        return try {
            context.getSystemService(DevicePolicyManager::class.java).lockNow()
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun goToSleepSafe(context: Context): Boolean {
        return try {
            val pm = context.getSystemService(PowerManager::class.java)
            val method = PowerManager::class.java.getMethod("goToSleep", Long::class.javaPrimitiveType)
            method.invoke(pm, SystemClock.uptimeMillis())
            true
        } catch (_: Exception) {
            false
        }
    }

    fun isScreenOn(context: Context): Boolean {
        if (tvStandby) return false
        val pm = context.getSystemService(PowerManager::class.java)
        return pm.isInteractive
    }

    fun canLaunchLock(context: Context): Boolean = isScreenOn(context)

    fun launchLock(context: Context, force: Boolean = false) {
        if (!TvLockApp.instance.prefs.setupDone) return
        val last = SessionBus.last
        if (!force && last?.isUnlocked == true) return
        if (!force && lockForeground) return
        if (!force && !canLaunchLock(context)) return
        val intent = Intent(context, LockActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_NO_ANIMATION,
            )
        }
        val canOverlay = Settings.canDrawOverlays(context)
        if (canOverlay || context is Activity) {
            context.startActivity(intent)
            if (context is Activity) context.overridePendingTransition(0, 0)
            return
        }
        showFullScreenNotice(context)
        try {
            context.startActivity(intent)
        } catch (_: Exception) {
        }
    }

    fun goHome(context: Context) {
        setTvHomeEnabled(context, false)
        launchOtherHome(context)
    }

    fun launchOtherHome(context: Context) {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val matches = context.packageManager.queryIntentActivities(home, 0)
        val other = matches.firstOrNull { it.activityInfo.packageName != context.packageName }
        val intent = if (other != null) {
            Intent().setClassName(other.activityInfo.packageName, other.activityInfo.name)
        } else {
            home
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        try {
            context.startActivity(intent)
            if (context is Activity) context.overridePendingTransition(0, 0)
        } catch (_: Exception) {
        }
    }

    fun shouldShowLock(snapshot: DeviceSnapshot?): Boolean {
        if (!TvLockApp.instance.prefs.setupDone) return false
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
