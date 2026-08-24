package com.cjlhll.tvlock.lock

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.PixelCopy
import com.cjlhll.tvlock.TvLockApp
import com.cjlhll.tvlock.net.CloudClient
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object DeviceCommands {
    @Volatile
    private var lastJpeg: ByteArray? = null

    fun captureAndUpload(client: CloudClient): Boolean {
        val jpeg = captureJpeg() ?: return false
        return try {
            client.uploadScreenshot(jpeg).optBoolean("ok")
        } catch (_: Exception) {
            false
        }
    }

    fun reportCaptureFailure(client: CloudClient): Boolean {
        return try {
            client.uploadScreenshotError(failReason()).optBoolean("ok")
        } catch (_: Exception) {
            false
        }
    }

    fun rememberLockedFrame() {
        if (!LockController.lockForeground) return
        LockController.lockActivity?.let { act ->
            captureView(act)?.let { lastJpeg = it }
        }
    }

    fun captureJpeg(): ByteArray? {
        if (LockController.lockForeground) {
            LockController.lockActivity?.let { act ->
                captureView(act)?.also { lastJpeg = it; return it }
                captureWindow(act)?.also { lastJpeg = it; return it }
            }
        }
        ShotService.captureBitmap()?.let { lastJpeg = bitmapToJpeg(it); return lastJpeg }
        return lastJpeg
    }

    fun failReason(): String {
        val pm = TvLockApp.instance.getSystemService(PowerManager::class.java)
        if (LockController.tvStandby || !pm.isInteractive) return "设备已待机，亮屏后再截"
        if (!LockController.lockForeground && ShotService.instance == null) {
            return "截图服务未打开"
        }
        return "当前画面无法截取"
    }

    private fun captureView(activity: Activity): ByteArray? {
        val latch = CountDownLatch(1)
        var result: ByteArray? = null
        activity.runOnUiThread {
            try {
                val view = activity.window.decorView.rootView
                if (view.width > 0 && view.height > 0) {
                    val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
                    view.draw(Canvas(bmp))
                    result = bitmapToJpeg(bmp)
                }
            } catch (_: Exception) {
            }
            latch.countDown()
        }
        latch.await(1500, TimeUnit.MILLISECONDS)
        return result
    }

    private fun captureWindow(activity: Activity): ByteArray? {
        val view = activity.window.decorView
        if (view.width <= 0 || view.height <= 0) return null
        val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        val latch = CountDownLatch(1)
        var ok = false
        activity.runOnUiThread {
            try {
                PixelCopy.request(activity.window, bmp, { result ->
                    ok = result == PixelCopy.SUCCESS
                    latch.countDown()
                }, Handler(Looper.getMainLooper()))
            } catch (_: Exception) {
                latch.countDown()
            }
        }
        if (!latch.await(1500, TimeUnit.MILLISECONDS) || !ok) {
            bmp.recycle()
            return null
        }
        return bitmapToJpeg(bmp)
    }

    private fun bitmapToJpeg(bmp: Bitmap): ByteArray {
        val scaled = scale(bmp, 960)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 45, out)
        if (scaled !== bmp) scaled.recycle()
        bmp.recycle()
        return out.toByteArray()
    }

    private fun scale(src: Bitmap, maxEdge: Int): Bitmap {
        val edge = maxOf(src.width, src.height)
        if (edge <= maxEdge) return src
        val ratio = maxEdge.toFloat() / edge
        return Bitmap.createScaledBitmap(
            src,
            (src.width * ratio).toInt().coerceAtLeast(1),
            (src.height * ratio).toInt().coerceAtLeast(1),
            true,
        )
    }
}
