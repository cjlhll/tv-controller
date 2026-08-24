package com.cjlhll.tvlock.lock

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ShotService : AccessibilityService() {
    override fun onServiceConnected() {
        instance = this
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    companion object {
        @Volatile
        var instance: ShotService? = null
            private set

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
