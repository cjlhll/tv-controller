package com.cjlhll.tvlock

import android.app.Application
import com.cjlhll.tvlock.data.AppPrefs

class TvLockApp : Application() {
    lateinit var prefs: AppPrefs
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = AppPrefs(this)
    }

    companion object {
        lateinit var instance: TvLockApp
            private set
    }
}
