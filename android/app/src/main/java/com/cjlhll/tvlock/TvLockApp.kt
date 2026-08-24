package com.cjlhll.tvlock

import android.app.Application
import com.cjlhll.tvlock.data.AppPrefs
import com.cjlhll.tvlock.lock.LockController

class TvLockApp : Application() {
    lateinit var prefs: AppPrefs
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = AppPrefs(this)
        if (prefs.setupDone) {
            LockController.hardenInstalledApp(this)
        }
    }

    companion object {
        lateinit var instance: TvLockApp
            private set
    }
}
