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
"$ADB" shell pm grant com.cjlhll.tvlock android.permission.WRITE_SECURE_SETTINGS >/dev/null 2>&1 || true
echo "已安装。服务器默认 https://armbian.caojian.shop:8787/api"
echo "Device Owner（专用机、需先移除账号）："
echo "  $ADB shell dpm set-device-owner com.cjlhll.tvlock/.lock.LockAdminReceiver"
