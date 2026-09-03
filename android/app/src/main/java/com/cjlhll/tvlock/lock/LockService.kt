package com.cjlhll.tvlock.lock

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.cjlhll.tvlock.R
import com.cjlhll.tvlock.TvLockApp
import com.cjlhll.tvlock.net.CloudClient
import com.cjlhll.tvlock.ui.LockActivity
import java.util.concurrent.Executors

class LockService : Service() {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val wakeReceiver = WakeReceiver()
    private val homeReceiver = HomeCatchReceiver()
    private lateinit var client: CloudClient
    private var pollWake = false
    private var shotFails = 0

    private val poller = object : Runnable {
        override fun run() {
            tick()
            main.postDelayed(this, POLL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        client = CloudClient(TvLockApp.instance.prefs)
        createChannel()
        startForeground(NOTIF_ID, buildNotification("正在守护锁定状态"))
        if (!TvLockApp.instance.prefs.setupDone && !LockController.isDeviceOwner(this)) {
            stopSelf()
            return
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_DREAMING_STOPPED)
            addAction(Intent.ACTION_DREAMING_STARTED)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(wakeReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(wakeReceiver, filter)
        }
        val homeFilter = IntentFilter(Intent.ACTION_CLOSE_SYSTEM_DIALOGS)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(homeReceiver, homeFilter, RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(homeReceiver, homeFilter)
        }
        LockController.prepareLockTask(this)
        if (LockController.shouldShowLock(SessionBus.last)) {
            LockController.setTvHomeEnabled(this, true)
        }
        main.post(poller)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!TvLockApp.instance.prefs.setupDone && !LockController.isDeviceOwner(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.getBooleanExtra(EXTRA_WAKE, false) == true) {
            pollWake = true
        }
        tick()
        return START_STICKY
    }

    override fun onDestroy() {
        main.removeCallbacks(poller)
        try {
            unregisterReceiver(wakeReceiver)
        } catch (_: Exception) {
        }
        try {
            unregisterReceiver(homeReceiver)
        } catch (_: Exception) {
        }
        io.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun tick() {
        val prefs = TvLockApp.instance.prefs
        val ownerOnly = !prefs.setupDone && LockController.isDeviceOwner(this)
        if (!prefs.setupDone && !ownerOnly) return
        val shouldWake = pollWake
        pollWake = false
        io.execute {
            try {
                if (ownerOnly) {
                    if (prefs.deviceId.isEmpty()) {
                        val reg = client.register()
                        client.snapshotFrom(reg)?.let { SessionBus.post(it) }
                    }
                    val res = client.state()
                    val snap = client.snapshotFrom(res)
                    if (snap != null) {
                        prefs.allowUninstall = snap.allowUninstall
                        main.post {
                            LockController.applyUninstallPolicy(this)
                            LockController.syncLauncherIcon(this, !snap.isUnbound)
                        }
                    }
                    return@execute
                }
                if (prefs.deviceId.isEmpty()) {
                    val reg = client.register()
                    client.snapshotFrom(reg)?.let { SessionBus.post(it) }
                }
                val res = if (shouldWake) client.wake() else client.state()
                val snap = client.snapshotFrom(res) ?: return@execute
                if (snap.pin.isNotEmpty()) {
                    prefs.applyCloudPin(snap.pin)
                }
                if (snap.pinDurationMin > 0) {
                    prefs.pinDurationMin = snap.pinDurationMin
                }
                prefs.allowUninstall = snap.allowUninstall
                SessionBus.post(snap)
                handleRemoteCommand(snap.pendingCommand)
                val localExpired = snap.status == "unlocked" &&
                    snap.unlockUntil > 0 &&
                    snap.unlockUntil <= System.currentTimeMillis()
                if (localExpired) {
                    try {
                        client.lock()
                    } catch (_: Exception) {
                    }
                    SessionBus.post(snap.copy(status = "locked", unlockUntil = 0))
                }
                main.post {
                    LockController.hardenInstalledApp(this)
                    LockController.syncLauncherIcon(this, !snap.isUnbound)
                    val locked = LockController.shouldShowLock(SessionBus.last)
                    LockVolumeGuard.sync(this, locked)
                    if (locked) {
                        LockController.launchLock(this)
                    }
                    updateNotification(SessionBus.last)
                }
            } catch (_: Exception) {
                main.post {
                    val locked = LockController.shouldShowLock(SessionBus.last)
                    LockVolumeGuard.sync(this, locked)
                    if (locked) {
                        LockController.launchLock(this)
                    }
                }
            }
        }
    }

    private fun handleRemoteCommand(command: String) {
        if (command == "sleep") {
            shotFails = 0
            main.post { LockController.sleepDevice(this) }
            try {
                client.ackCommand()
            } catch (_: Exception) {
            }
            return
        }
        if (command != "screenshot") {
            shotFails = 0
            return
        }
        if (DeviceCommands.captureAndUpload(client)) {
            shotFails = 0
            return
        }
        shotFails += 1
        if (shotFails >= 2 && DeviceCommands.reportCaptureFailure(client)) {
            shotFails = 0
        }
    }

    private fun updateNotification(snap: com.cjlhll.tvlock.data.DeviceSnapshot?) {
        val text = when {
            snap == null -> "正在连接…"
            snap.isUnlocked -> {
                val min = ((snap.unlockUntil - System.currentTimeMillis()) / 60000L).coerceAtLeast(0)
                "使用中，剩余 ${min} 分钟"
            }
            snap.isUnbound -> "等待扫码绑定"
            else -> "已锁定，等待批准"
        }
        startForeground(NOTIF_ID, buildNotification(text))
    }

    private fun buildNotification(text: String) =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_lock)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    Intent(this, LockActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            )
            .build()

    private fun createChannel() {
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notify_channel), NotificationManager.IMPORTANCE_LOW)
        )
    }

    companion object {
        const val CHANNEL_ID = "tvlock"
        const val NOTIF_ID = 1001
        const val EXTRA_WAKE = "wake"
        const val POLL_MS = 800L

        fun start(context: Context, reportWake: Boolean = false) {
            val i = Intent(context, LockService::class.java).putExtra(EXTRA_WAKE, reportWake)
            context.startForegroundService(i)
        }
    }
}
