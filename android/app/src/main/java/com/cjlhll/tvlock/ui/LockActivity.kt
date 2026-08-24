package com.cjlhll.tvlock.ui

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.cjlhll.tvlock.R
import com.cjlhll.tvlock.TvLockApp
import com.cjlhll.tvlock.data.DeviceSnapshot
import com.cjlhll.tvlock.databinding.ActivityLockBinding
import com.cjlhll.tvlock.lock.LockController
import com.cjlhll.tvlock.lock.LockService
import com.cjlhll.tvlock.lock.SessionBus
import com.cjlhll.tvlock.net.CloudClient
import com.cjlhll.tvlock.qr.QrEncoder
import org.json.JSONObject
import kotlin.concurrent.thread

class LockActivity : AppCompatActivity() {
    private lateinit var binding: ActivityLockBinding
    private val client by lazy { CloudClient(TvLockApp.instance.prefs) }
    private var lastToken: String = ""

    private val listener: (DeviceSnapshot) -> Unit = { snap ->
        render(snap)
        if (snap.isUnlocked) {
            LockController.stopLockTaskSafe(this)
            LockController.goHome(this)
            finish()
        } else {
            LockController.startLockTaskSafe(this)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        binding = ActivityLockBinding.inflate(layoutInflater)
        setContentView(binding.root)

        LockService.start(this)
        binding.deviceId.text = TvLockApp.instance.prefs.deviceId
        binding.pinButton.setOnClickListener { askPin() }
        binding.refreshButton.setOnClickListener { refreshPair() }
        binding.lockNowButton.setOnClickListener { lockNow() }
        binding.title.setOnLongClickListener {
            startActivity(Intent(this, SetupActivity::class.java).putExtra(SetupActivity.EXTRA_FORCE, true))
            true
        }
        SessionBus.last?.let { render(it) }
        if (SessionBus.last == null || SessionBus.last?.isUnbound == true) {
            refreshPair()
        }
    }

    override fun onResume() {
        super.onResume()
        SessionBus.listen(listener)
        SessionBus.last?.let { if (it.isUnlocked) {
            LockController.stopLockTaskSafe(this)
            finish()
        } else {
            LockController.startLockTaskSafe(this)
        } }
    }

    override fun onPause() {
        SessionBus.unlisten(listener)
        super.onPause()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (SessionBus.last?.isUnlocked == true) {
            super.onBackPressed()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_HOME || keyCode == KeyEvent.KEYCODE_APP_SWITCH) {
            if (SessionBus.last?.isUnlocked != true) return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun render(snap: DeviceSnapshot) {
        binding.deviceId.text = snap.deviceId.ifBlank { TvLockApp.instance.prefs.deviceId }
        when {
            snap.isUnlocked -> {
                binding.title.text = getString(R.string.lock_unlocked)
                val min = ((snap.unlockUntil - System.currentTimeMillis()) / 60000L).coerceAtLeast(0)
                binding.subtitle.text = "剩余 ${min} 分钟，长按标题可改设置"
                binding.qr.visibility = View.GONE
                binding.pairCode.visibility = View.GONE
                binding.refreshButton.visibility = View.GONE
                binding.lockNowButton.visibility = View.VISIBLE
            }
            snap.isUnbound -> {
                binding.title.text = getString(R.string.lock_unbound)
                binding.subtitle.text = "微信小程序扫码，或手动输入下方配对码"
                binding.qr.visibility = View.VISIBLE
                binding.pairCode.visibility = View.VISIBLE
                binding.refreshButton.visibility = View.VISIBLE
                binding.lockNowButton.visibility = View.GONE
                if (snap.pairToken.isNotEmpty()) showQr(snap)
            }
            else -> {
                binding.title.text = getString(R.string.lock_title)
                binding.subtitle.text = getString(R.string.lock_pending)
                binding.qr.visibility = View.GONE
                binding.pairCode.visibility = View.GONE
                binding.refreshButton.visibility = View.GONE
                binding.lockNowButton.visibility = View.GONE
            }
        }
    }

    private fun showQr(snap: DeviceSnapshot) {
        if (snap.pairToken == lastToken) {
            binding.pairCode.text = snap.pairToken
            return
        }
        lastToken = snap.pairToken
        binding.pairCode.text = snap.pairToken
        val payload = JSONObject()
            .put("v", 1)
            .put("deviceId", snap.deviceId)
            .put("pairToken", snap.pairToken)
            .toString()
        val size = resources.getDimensionPixelSize(R.dimen.qr_size)
        binding.qr.setImageBitmap(QrEncoder.encode(payload, size))
    }

    private fun refreshPair() {
        thread {
            try {
                var res = if (TvLockApp.instance.prefs.deviceId.isEmpty()) {
                    client.register()
                } else {
                    client.refreshPair()
                }
                if (!res.optBoolean("ok")) res = client.register()
                val snap = client.snapshotFrom(res) ?: return@thread
                SessionBus.post(snap)
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "刷新失败：${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun askPin() {
        val box = layoutInflater.inflate(R.layout.dialog_pin, null)
        val input = box.findViewById<EditText>(R.id.pinInput)
        AlertDialog.Builder(this)
            .setView(box)
            .setPositiveButton("解锁 30 分钟") { _, _ ->
                val pin = input.text?.toString().orEmpty()
                if (!TvLockApp.instance.prefs.verifyPin(pin)) {
                    Toast.makeText(this, "PIN 错误", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                thread {
                    try {
                        val res = client.pinUnlock(30)
                        val snap = client.snapshotFrom(res)
                        if (snap != null) SessionBus.post(snap)
                    } catch (e: Exception) {
                        runOnUiThread {
                            Toast.makeText(this, e.message, Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
            .setNegativeButton("取消", null)
            .show()
        input.requestFocus()
    }

    private fun lockNow() {
        thread {
            try {
                val res = client.lock()
                client.snapshotFrom(res)?.let { SessionBus.post(it) }
            } catch (_: Exception) {
            }
        }
    }
}
