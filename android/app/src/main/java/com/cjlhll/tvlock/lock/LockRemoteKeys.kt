package com.cjlhll.tvlock.lock

import android.content.Context
import android.view.KeyEvent

/** 电视锁定时遥控器只允许方向、确定、返回、睡眠。 */
object LockRemoteKeys {
    fun isAllowed(keyCode: Int): Boolean = when (keyCode) {
        KeyEvent.KEYCODE_DPAD_UP,
        KeyEvent.KEYCODE_DPAD_DOWN,
        KeyEvent.KEYCODE_DPAD_LEFT,
        KeyEvent.KEYCODE_DPAD_RIGHT,
        KeyEvent.KEYCODE_DPAD_CENTER,
        KeyEvent.KEYCODE_ENTER,
        KeyEvent.KEYCODE_NUMPAD_ENTER,
        KeyEvent.KEYCODE_BACK,
        KeyEvent.KEYCODE_POWER,
        KeyEvent.KEYCODE_SLEEP,
        KeyEvent.KEYCODE_SOFT_SLEEP,
        KeyEvent.KEYCODE_TV_POWER -> true
        else -> false
    }

    fun shouldSwallow(context: Context, keyCode: Int): Boolean {
        if (!LockController.isTelevision(context)) return false
        if (LockController.allowLeave) return false
        if (!LockController.shouldShowLock(SessionBus.last)) return false
        return !isAllowed(keyCode)
    }
}
