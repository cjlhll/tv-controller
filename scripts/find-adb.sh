#!/usr/bin/env bash
set -euo pipefail

candidates=(
  "adb.exe"
  "/mnt/c/adb/platform-tools/adb.exe"
  "/mnt/c/Users/caoji/AppData/Local/Android/Sdk/platform-tools/adb.exe"
  "/mnt/c/Android/platform-tools/adb.exe"
  "/mnt/c/platform-tools/adb.exe"
)

if command -v adb.exe >/dev/null 2>&1; then
  command -v adb.exe
  exit 0
fi

for p in "${candidates[@]}"; do
  if [[ -x "$p" || -f "$p" ]]; then
    echo "$p"
    exit 0
  fi
done

# Last resort: ask Windows PATH
if command -v cmd.exe >/dev/null 2>&1; then
  win=$(cmd.exe /c "where adb.exe" 2>/dev/null | tr -d '\r' | head -n 1 || true)
  if [[ -n "${win:-}" ]]; then
    echo "$win"
    exit 0
  fi
fi

echo "未找到 Windows adb.exe。请安装 Android platform-tools，或把 adb.exe 加入 PATH。" >&2
exit 1
