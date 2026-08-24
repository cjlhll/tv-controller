#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="$("$ROOT/scripts/find-adb.sh")"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

echo "Using adb: $ADB"
"$ADB" devices
"$ADB" reverse tcp:8787 tcp:8787 || true

if [[ ! -f "$APK" ]]; then
  echo "APK 不存在，先编译：cd android && ./gradlew :app:assembleDebug" >&2
  exit 1
fi

"$ADB" install -r "$APK"
echo "已安装。请确认本机 API 已启动：node cloud/local-server/server.js"
echo "Device Owner（专用机、需先移除账号）："
echo "  $ADB shell dpm set-device-owner com.cjlhll.tvlock/.lock.LockAdminReceiver"
