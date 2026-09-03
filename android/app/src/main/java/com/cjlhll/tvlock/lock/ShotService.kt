package com.cjlhll.tvlock.lock

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import com.cjlhll.tvlock.TvLockApp
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class ShotService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val redirectingUninstall = AtomicBoolean(false)

    override fun onServiceConnected() {
        instance = this
        val info = serviceInfo ?: AccessibilityServiceInfo()
        info.flags = info.flags or AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
        serviceInfo = info
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        return LockRemoteKeys.shouldSwallow(this, event.keyCode)
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val cls = event.className?.toString() ?: return
        if (!cls.contains("DeviceAdminAdd")) return
        if (!TvLockApp.instance.prefs.allowUninstall) return
        if (!redirectingUninstall.compareAndSet(false, true)) return
        main.post {
            performGlobalAction(GLOBAL_ACTION_BACK)
            LockController.startSystemUninstall(this)
            main.postDelayed({ redirectingUninstall.set(false) }, 2500)
        }
    }

    override fun onInterrupt() {}

    companion object {
        @Volatile
        var instance: ShotService? = null
            private set

        fun lockScreen(): Boolean {
            if (Build.VERSION.SDK_INT < 28) return false
            return instance?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN) == true
        }

        fun captureBitmap(): Bitmap? {
            if (Build.VERSION.SDK_INT < 30) return null
            val svc = instance ?: return null
            val latch = CountDownLatch(1)
            var out: Bitmap? = null
            svc.takeScreenshot(
                Display.DEFAULT_DISPLAY,
                svc.mainExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(screenshot: ScreenshotResult) {
                        try {
                            val buf = screenshot.hardwareBuffer
                            val wrapped = Bitmap.wrapHardwareBuffer(buf, screenshot.colorSpace)
                            buf.close()
                            out = wrapped?.copy(Bitmap.Config.ARGB_8888, false)
                            wrapped?.recycle()
                        } catch (_: Exception) {
                        }
                        latch.countDown()
                    }

                    override fun onFailure(errorCode: Int) {
                        latch.countDown()
                    }
                },
            )
            latch.await(2, TimeUnit.SECONDS)
            return out
        }
    }
}
