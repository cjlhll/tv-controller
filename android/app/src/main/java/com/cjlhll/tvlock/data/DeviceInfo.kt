package com.cjlhll.tvlock.data

import android.app.ActivityManager
import android.content.Context
import android.graphics.Point
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import android.view.WindowManager
import org.json.JSONObject
import java.util.Locale

object DeviceInfo {
    fun marketingName(context: Context): String {
        val named = Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
            ?.trim()
            .orEmpty()
        return named.ifEmpty { Build.MODEL }
    }

    fun toJson(context: Context): JSONObject {
        val ram = context.getSystemService(ActivityManager::class.java)?.let { am ->
            val mi = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            formatGb(mi.totalMem)
        } ?: ""
        val data = Environment.getDataDirectory()
        val stat = StatFs(data.absolutePath)
        val total = stat.totalBytes
        val used = (total - stat.availableBytes).coerceAtLeast(0)
        return JSONObject()
            .put("os", "Android ${Build.VERSION.RELEASE}")
            .put("model", marketingName(context))
            .put("screen", screenSize(context))
            .put("ram", ram)
            .put("storage", "${formatGb(used)} / ${formatGb(total)}")
    }

    private fun screenSize(context: Context): String {
        val wm = context.getSystemService(WindowManager::class.java)
        if (wm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.maximumWindowMetrics.bounds
            if (bounds.width() > 0 && bounds.height() > 0) {
                return "${bounds.width()}×${bounds.height()}"
            }
        }
        if (wm != null) {
            val point = Point()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealSize(point)
            if (point.x > 0 && point.y > 0) {
                return "${point.x}×${point.y}"
            }
        }
        val dm = context.resources.displayMetrics
        return "${dm.widthPixels}×${dm.heightPixels}"
    }

    private fun formatGb(bytes: Long): String {
        val gb = bytes / (1024.0 * 1024.0 * 1024.0)
        return if (gb >= 10) {
            String.format(Locale.US, "%.0f GB", gb)
        } else {
            String.format(Locale.US, "%.1f GB", gb)
        }
    }
}
