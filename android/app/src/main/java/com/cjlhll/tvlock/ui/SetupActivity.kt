package com.cjlhll.tvlock.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.cjlhll.tvlock.TvLockApp
import com.cjlhll.tvlock.databinding.ActivitySetupBinding
import com.cjlhll.tvlock.lock.LockController
import com.cjlhll.tvlock.lock.LockService
import com.cjlhll.tvlock.net.CloudClient
import kotlin.concurrent.thread

class SetupActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySetupBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = TvLockApp.instance.prefs
        if (prefs.setupDone && intent?.getBooleanExtra(EXTRA_FORCE, false) != true) {
            LockService.start(this)
            startActivity(Intent(this, LockActivity::class.java))
            finish()
            return
        }

        binding = ActivitySetupBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.serverUrl.setText(prefs.serverUrl)
        binding.deviceName.setText(prefs.deviceName)
        refreshOwner()

        binding.overlayButton.setOnClickListener {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName"),
                )
            )
        }
        binding.batteryButton.setOnClickListener {
            val pm = getSystemService(PowerManager::class.java)
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                        .setData(Uri.parse("package:$packageName"))
                )
            } else {
                Toast.makeText(this, "已忽略电池优化", Toast.LENGTH_SHORT).show()
            }
        }
        if (LockController.isTelevision(this)) {
            binding.batteryButton.visibility = View.GONE
            binding.overlayButton.nextFocusDownId = binding.saveButton.id
            binding.saveButton.nextFocusUpId = binding.overlayButton.id
        }
        if (prefs.setupDone) {
            binding.backButton.visibility = View.VISIBLE
            binding.saveButton.text = "保存并返回锁屏"
            binding.backButton.setOnClickListener { goLock() }
            if (LockController.isTelevision(this)) {
                binding.overlayButton.nextFocusDownId = binding.backButton.id
                binding.backButton.nextFocusUpId = binding.overlayButton.id
                binding.backButton.nextFocusDownId = binding.saveButton.id
                binding.saveButton.nextFocusUpId = binding.backButton.id
            }
        }
        binding.saveButton.setOnClickListener { save() }
        if (LockController.isTelevision(this)) {
            binding.saveButton.requestFocus()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::binding.isInitialized) refreshOwner()
    }

    private fun refreshOwner() {
        if (!::binding.isInitialized) return
        val owner = if (LockController.isDeviceOwner(this)) "已是 Device Owner，可 Lock Task" else "尚未 Device Owner（基础档）"
        val overlay = if (Settings.canDrawOverlays(this)) "叠加层已授权" else "叠加层未授权"
        binding.ownerStatus.text = "$owner\n$overlay"
    }

    private fun save() {
        val prefs = TvLockApp.instance.prefs
        val pin = binding.pin.text?.toString().orEmpty()
        if (!prefs.hasPin()) {
            if (pin.length !in 4..6) {
                Toast.makeText(this, "请设置 4-6 位家长 PIN", Toast.LENGTH_SHORT).show()
                return
            }
            prefs.setPin(pin)
        } else if (pin.length in 4..6) {
            prefs.setPin(pin)
        }
        prefs.serverUrl = binding.serverUrl.text?.toString().orEmpty().ifBlank { prefs.serverUrl }
        prefs.deviceName = binding.deviceName.text?.toString().orEmpty().ifBlank { Build.MODEL }
        binding.saveButton.isEnabled = false
        thread {
            try {
                val res = CloudClient(prefs).register(if (pin.length in 4..6) pin else "")
                Log.i(TAG, "register $res")
                runOnUiThread {
                    if (!res.optBoolean("ok")) {
                        Toast.makeText(this, res.optString("message", "注册失败"), Toast.LENGTH_LONG).show()
                        binding.saveButton.isEnabled = true
                        return@runOnUiThread
                    }
                    prefs.setupDone = true
                    LockController.hardenInstalledApp(this)
                    LockService.start(this)
                    goLock()
                }
            } catch (e: Exception) {
                Log.e(TAG, "register failed", e)
                runOnUiThread {
                    Toast.makeText(this, "连不上服务器：${e.message}", Toast.LENGTH_LONG).show()
                    binding.saveButton.isEnabled = true
                }
            }
        }
    }

    private fun goLock() {
        startActivity(Intent(this, LockActivity::class.java))
        finish()
    }

    companion object {
        const val EXTRA_FORCE = "force"
        private const val TAG = "TvLock"
    }
}
