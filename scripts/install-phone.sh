#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="$("$ROOT/scripts/find-adb.sh")"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

echo "Using adb: $ADB"
"$ADB" devices
"$ADB" reverse --remove tcp:8787 >/dev/null 2>&1 || true

if [[ ! -f "$APK" ]]; then
  echo "APK 不存在，先编译：cd android && ./gradlew :app:assembleDebug" >&2
  exit 1
fi

"$ADB" install -r "$APK"
PKG=com.cjlhll.tvlock
SHOT="$PKG/$PKG.lock.ShotService"
if ! "$ADB" shell pm grant "$PKG" android.permission.WRITE_SECURE_SETTINGS; then
  echo "警告：未能授予 WRITE_SECURE_SETTINGS，解锁后远程截图可能失败" >&2
fi
"$ADB" shell settings put secure enabled_accessibility_services "$SHOT" >/dev/null
"$ADB" shell settings put secure accessibility_enabled 1 >/dev/null
echo "已安装。服务器默认 https://armbian.caojian.shop:8787/api"
echo "Device Owner（专用机、需先移除账号）："
echo "  $ADB shell dpm set-device-owner com.cjlhll.tvlock/.lock.LockAdminReceiver"
