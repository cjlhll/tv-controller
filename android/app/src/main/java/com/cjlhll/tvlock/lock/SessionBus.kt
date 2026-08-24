package com.cjlhll.tvlock.lock

import android.os.Handler
import android.os.Looper
import com.cjlhll.tvlock.data.DeviceSnapshot

object SessionBus {
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableSetOf<(DeviceSnapshot) -> Unit>()

    @Volatile
    var last: DeviceSnapshot? = null
        private set

    @Synchronized
    fun listen(listener: (DeviceSnapshot) -> Unit) {
        listeners += listener
        last?.let { listener(it) }
    }

    @Synchronized
    fun unlisten(listener: (DeviceSnapshot) -> Unit) {
        listeners -= listener
    }

    fun post(snapshot: DeviceSnapshot) {
        last = snapshot
        val copy = synchronized(this) { listeners.toList() }
        main.post {
            copy.forEach { it(snapshot) }
        }
    }
}
