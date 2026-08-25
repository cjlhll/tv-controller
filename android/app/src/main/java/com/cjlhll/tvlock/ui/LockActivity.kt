package com.cjlhll.tvlock.ui

import android.app.Dialog
import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.cjlhll.tvlock.R
import com.cjlhll.tvlock.TvLockApp
import com.cjlhll.tvlock.data.DeviceSnapshot
import com.cjlhll.tvlock.databinding.ActivityLockBinding
import com.cjlhll.tvlock.lock.LockController
import com.cjlhll.tvlock.lock.LockRemoteKeys
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
    private var extraPairToken: String = ""
    private var extraPairExpireAt: Long = 0
    private var keepPairVisible = false
    private var pairRefreshing = false
    private var requesting = false
    private var didFocusAction = false

    private val listener: (DeviceSnapshot) -> Unit = { snap ->
        render(snap)
        if (snap.isUnlocked) {
            LockController.applyUnlocked(this)
            finish()
        } else {
            LockController.applyLocked(this)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!TvLockApp.instance.prefs.setupDone) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
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
        if (!LockController.isTelevision(this)) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        overridePendingTransition(0, 0)
        binding = ActivityLockBinding.inflate(layoutInflater)
        setContentView(binding.root)

        LockService.start(this)
        binding.deviceId.text = shortId(TvLockApp.instance.prefs.deviceId)
        restorePairCache()
        binding.requestButton.setOnClickListener { requestUnlock() }
        binding.pinButton.setOnClickListener { askPin() }
        binding.refreshButton.setOnClickListener { refreshPair() }
        binding.lockNowButton.setOnClickListener { lockNow() }
        binding.title.setOnLongClickListener {
            LockController.allowLeave = true
            startActivity(Intent(this, SetupActivity::class.java).putExtra(SetupActivity.EXTRA_FORCE, true))
            true
        }
        maybeAskHomeRole()
        SessionBus.last?.let { render(it) }
        val last = SessionBus.last
        if (last == null || last.isUnbound || keepPairVisible) {
            val remaining = extraPairExpireAt - System.currentTimeMillis()
            if (last == null || last.isUnbound || extraPairToken.isEmpty() || remaining <= 20_000L) {
                refreshPair()
            }
        }
        focusPrimaryAction()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        overridePendingTransition(0, 0)
    }

    override fun onResume() {
        super.onResume()
        if (!::binding.isInitialized) return
        LockController.allowLeave = false
        LockController.lockForeground = true
        LockController.lockActivity = this
        SessionBus.listen(listener)
        SessionBus.last?.let {
            if (it.isUnlocked) {
                LockController.applyUnlocked(this)
                finish()
            } else {
                LockController.applyLocked(this)
            }
        }
        focusPrimaryAction()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (LockController.allowLeave) return
        if (LockController.shouldShowLock(SessionBus.last)) {
            LockController.launchLock(this, force = true)
        }
    }

    override fun onPause() {
        LockController.lockForeground = false
        if (::binding.isInitialized) SessionBus.unlisten(listener)
        super.onPause()
    }

    override fun onDestroy() {
        if (LockController.lockActivity === this) LockController.lockActivity = null
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (SessionBus.last?.isUnlocked == true) {
            super.onBackPressed()
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (LockRemoteKeys.shouldSwallow(this, event.keyCode)) return true
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (LockRemoteKeys.shouldSwallow(this, keyCode)) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (LockRemoteKeys.shouldSwallow(this, keyCode)) return true
        return super.onKeyUp(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent?): Boolean {
        if (LockRemoteKeys.shouldSwallow(this, keyCode)) return true
        return super.onKeyLongPress(keyCode, event)
    }

    override fun onSearchRequested(): Boolean {
        if (LockRemoteKeys.shouldSwallow(this, KeyEvent.KEYCODE_SEARCH)) return false
        return super.onSearchRequested()
    }

    private fun render(snap: DeviceSnapshot) {
        binding.deviceId.text = shortId(snap.deviceId.ifBlank { TvLockApp.instance.prefs.deviceId })
        val pairToken = rememberPair(snap)
        val showPair = pairToken.isNotEmpty()
        when {
            snap.isUnlocked -> {
                binding.title.text = getString(R.string.lock_unlocked)
                val min = ((snap.unlockUntil - System.currentTimeMillis()) / 60000L).coerceAtLeast(0)
                binding.subtitle.text = "剩余 $min 分钟，长按标题可改设置"
                setBadge("使用中", R.drawable.bg_pill_ok, R.color.ok)
                binding.qr.visibility = View.GONE
                binding.pairCode.visibility = View.GONE
                binding.requestButton.visibility = View.GONE
                binding.refreshButton.visibility = View.GONE
                binding.lockNowButton.visibility = View.VISIBLE
            }
            snap.isUnbound -> {
                binding.title.text = getString(R.string.lock_unbound)
                binding.subtitle.text = "微信小程序扫码，或手动输入下方配对码"
                setBadge("未绑定", R.drawable.bg_pill, R.color.muted)
                binding.qr.visibility = if (showPair) View.VISIBLE else View.GONE
                binding.pairCode.visibility = if (showPair) View.VISIBLE else View.GONE
                binding.requestButton.visibility = View.GONE
                binding.refreshButton.visibility = View.VISIBLE
                binding.lockNowButton.visibility = View.GONE
                if (showPair) showQr(snap.copy(pairToken = pairToken))
            }
            else -> {
                val pending = snap.status == "pending"
                binding.title.text = if (pending) getString(R.string.lock_title) else getString(R.string.lock_locked)
                binding.subtitle.text = if (showPair) {
                    "扫码或输入配对码可绑定新家长。一次订阅只能推一条。"
                } else if (pending) {
                    getString(R.string.lock_pending)
                } else {
                    "点申请解锁通知家长，或点刷新配对码重新绑定"
                }
                if (pending) {
                    setBadge("等待批准", R.drawable.bg_pill_pending, R.color.accent)
                } else {
                    setBadge("已锁定", R.drawable.bg_pill, R.color.muted)
                }
                binding.qr.visibility = if (showPair) View.VISIBLE else View.GONE
                binding.pairCode.visibility = if (showPair) View.VISIBLE else View.GONE
                binding.requestButton.visibility = View.VISIBLE
                binding.requestButton.text = if (pending) "再次提醒家长" else getString(R.string.request_unlock)
                binding.refreshButton.visibility = View.VISIBLE
                binding.lockNowButton.visibility = View.GONE
                if (showPair) showQr(snap.copy(pairToken = pairToken))
            }
        }
    }

    private fun restorePairCache() {
        val prefs = TvLockApp.instance.prefs
        keepPairVisible = prefs.pairKeepVisible
        extraPairToken = prefs.cachedPairToken
        extraPairExpireAt = prefs.cachedPairExpireAt
    }

    private fun persistPairCache() {
        val prefs = TvLockApp.instance.prefs
        prefs.pairKeepVisible = keepPairVisible
        prefs.cachedPairToken = extraPairToken
        prefs.cachedPairExpireAt = extraPairExpireAt
    }

    private fun rememberPair(snap: DeviceSnapshot): String {
        if (snap.pairToken.isNotEmpty()) {
            extraPairToken = snap.pairToken
            extraPairExpireAt = if (snap.pairTokenExpireAt > 0) {
                snap.pairTokenExpireAt
            } else {
                System.currentTimeMillis() + 10 * 60 * 1000
            }
            keepPairVisible = true
            persistPairCache()
        }
        val remaining = extraPairExpireAt - System.currentTimeMillis()
        if (keepPairVisible && (snap.pairToken.isEmpty() || extraPairToken.isEmpty() || remaining <= 20_000L)) {
            refreshPair()
        }
        return extraPairToken
    }

    private fun maybeAskHomeRole() {
        if (!LockController.isTelevision(this)) return
        val prefs = TvLockApp.instance.prefs
        if (prefs.homeRoleAsked || Build.VERSION.SDK_INT < 29) return
        val rm = getSystemService(RoleManager::class.java) ?: return
        if (!rm.isRoleAvailable(RoleManager.ROLE_HOME) || rm.isRoleHeld(RoleManager.ROLE_HOME)) return
        prefs.homeRoleAsked = true
        try {
            startActivity(rm.createRequestRoleIntent(RoleManager.ROLE_HOME))
        } catch (_: Exception) {
        }
    }

    private fun focusPrimaryAction() {
        if (didFocusAction || !::binding.isInitialized) return
        val target = when {
            binding.requestButton.visibility == View.VISIBLE -> binding.requestButton
            binding.lockNowButton.visibility == View.VISIBLE -> binding.lockNowButton
            binding.refreshButton.visibility == View.VISIBLE -> binding.refreshButton
            else -> return
        }
        target.post {
            if (!didFocusAction && target.visibility == View.VISIBLE) {
                target.requestFocus()
                didFocusAction = true
            }
        }
    }

    private fun setBadge(text: String, background: Int, color: Int) {
        binding.statusBadge.text = text
        binding.statusBadge.setBackgroundResource(background)
        binding.statusBadge.setTextColor(getColor(color))
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
        if (pairRefreshing) return
        pairRefreshing = true
        thread {
            try {
                var res = if (TvLockApp.instance.prefs.deviceId.isEmpty()) {
                    client.register()
                } else {
                    client.refreshPair()
                }
                if (!res.optBoolean("ok")) res = client.register()
                val snap = client.snapshotFrom(res) ?: return@thread
                if (snap.pairToken.isNotEmpty()) {
                    extraPairToken = snap.pairToken
                    extraPairExpireAt = if (snap.pairTokenExpireAt > 0) {
                        snap.pairTokenExpireAt
                    } else {
                        System.currentTimeMillis() + 10 * 60 * 1000
                    }
                    keepPairVisible = true
                    persistPairCache()
                }
                SessionBus.post(snap)
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "刷新失败：${e.message}", Toast.LENGTH_SHORT).show()
                }
            } finally {
                pairRefreshing = false
            }
        }
    }

    private fun requestUnlock() {
        if (requesting) return
        requesting = true
        binding.requestButton.isEnabled = false
        thread {
            try {
                val res = client.requestUnlock()
                val snap = client.snapshotFrom(res)
                if (snap != null) SessionBus.post(snap)
                val notify = res.optJSONObject("notify")
                val skipped = notify?.optBoolean("skipped", true) ?: true
                val reason = notify?.optString("reason").orEmpty()
                val sent = !skipped && notifyHasSent(notify)
                runOnUiThread {
                    Toast.makeText(this, requestMessage(res.optBoolean("ok"), reason, sent), Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, e.message ?: "申请失败", Toast.LENGTH_SHORT).show()
                }
            } finally {
                runOnUiThread {
                    requesting = false
                    binding.requestButton.isEnabled = true
                }
            }
        }
    }

    private fun notifyHasSent(notify: JSONObject?): Boolean {
        val results = notify?.optJSONArray("results") ?: return false
        for (i in 0 until results.length()) {
            if (results.optJSONObject(i)?.optBoolean("sent") == true) return true
        }
        return false
    }

    private fun requestMessage(ok: Boolean, reason: String, sent: Boolean): String {
        if (!ok) return "申请失败"
        return when {
            sent -> "已推送给家长微信"
            reason == "debounced" -> "刚提醒过，请稍后再试"
            reason == "unbound" -> "请先绑定小程序"
            reason == "still_unlocked" -> "当前已解锁"
            reason == "need_subscribe" -> "已申请。家长请先打开小程序点接收提醒"
            reason == "wechat_not_configured" || reason == "no_real_openid" ->
                "已申请。订阅消息需正式小程序，家长请打开小程序批准"
            else -> "已申请，请家长打开小程序批准"
        }
    }

    private fun askPin() {
        val dialog = Dialog(this, R.style.Theme_TvLock_Dialog)
        dialog.setContentView(R.layout.dialog_pin)
        val dialogWidth = resources.getDimensionPixelSize(R.dimen.pin_dialog_width)
        dialog.window?.setLayout(
            if (dialogWidth > 0) dialogWidth else (resources.displayMetrics.widthPixels * 0.86).toInt(),
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        val input = dialog.findViewById<EditText>(R.id.pinInput)
        val error = dialog.findViewById<TextView>(R.id.pinError)
        dialog.findViewById<Button>(R.id.pinCancel).setOnClickListener { dialog.dismiss() }
        if (LockController.isTelevision(this)) {
            dialog.setCancelable(true)
            dialog.setCanceledOnTouchOutside(false)
            dialog.setOnKeyListener { _, keyCode, _ ->
                LockRemoteKeys.shouldSwallow(this, keyCode)
            }
        }
        dialog.findViewById<Button>(R.id.pinConfirm).setOnClickListener {
            val pin = input.text?.toString().orEmpty()
            if (!TvLockApp.instance.prefs.verifyPin(pin)) {
                error.visibility = View.VISIBLE
                return@setOnClickListener
            }
            dialog.dismiss()
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
        dialog.show()
        input.requestFocus()
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
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

    private fun shortId(id: String): String {
        if (id.length <= 8) return id
        return id.takeLast(8)
    }
}
