package com.cjlhll.tvlock

import android.app.Application
import com.cjlhll.tvlock.data.AppPrefs
import com.cjlhll.tvlock.lock.LockController
import com.cjlhll.tvlock.lock.LockService

class TvLockApp : Application() {
    lateinit var prefs: AppPrefs
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = AppPrefs(this)
        if (prefs.launcherHidden) {
            LockController.hideLauncherIcon(this)
        } else if (!prefs.setupDone) {
            LockController.showLauncherIcon(this)
        }
        if (prefs.setupDone) {
            LockController.hardenInstalledApp(this)
            LockService.start(this)
        } else if (LockController.isDeviceOwner(this)) {
            LockService.start(this)
        }
    }

    companion object {
        lateinit var instance: TvLockApp
            private set
    }
}
