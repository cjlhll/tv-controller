# TV Lock 联调与部署

仓库在 WSL：`/home/cjlhll/test/tv-controller`。Windows 资源管理器打开：

`\\wsl$\Debian\home\cjlhll\test\tv-controller`

（发行版名以 `wsl -l` 为准。）

## 1. 本机 API（一期先用这个联调手机）

在 WSL：

```bash
node cloudfunctions/api/logic.test.js
node cloud/local-server/server.js
```

- API：`POST https://armbian.caojian.shop:8787/api`（Docker 在 `192.168.1.2`，Caddy 终结 TLS，`./scripts/deploy-api.sh`）
- 审批页：https://armbian.caojian.shop:8787/
- 健康检查：https://armbian.caojian.shop:8787/health

手机 USB 在 **Windows** 上，WSL2 看不到这台设备。用 Windows 的 `adb.exe`：

```bash
adb.exe devices
```

不要 `adb reverse`。APK 和小程序都走域名。

若 WSL 里直接打 `adb.exe` 找不到，用完整路径，常见位置：

`/mnt/c/adb/platform-tools/adb.exe`

或：

```bash
./scripts/install-phone.sh
```

## 2. 编译并安装 APK

需要 Android SDK（`platforms;android-34`、`build-tools`）和带 `jlink` 的 JDK 17。本仓库已把 `org.gradle.java.home` 指到 `~/.local/jdk-17`。在 `android/local.properties` 写：

```
sdk.dir=/home/cjlhll/Android/Sdk
```

```bash
cd android
./gradlew :app:assembleDebug
# 由脚本调用 Windows adb.exe 安装
```

首次在测试机打开应用：

1. 填服务器：`https://armbian.caojian.shop:8787/api`（已装过的测试机若还是 `op.caojian.shop` / 本机/内网 IP，长按锁屏标题改回来）
2. 设 4–6 位家长 PIN
3. 授予「显示在其他应用上层」
4. 忽略电池优化
5. 保存并进入锁屏，用小程序或本机审批页绑定 6 位码

长按锁屏标题可回到设置。

## 3. Device Owner（专用测试机）

**会失败的情况：** 设备上已有账号（Google / 厂商账号）。专用机可先移除账号再执行。

```text
adb.exe shell dpm set-device-owner com.cjlhll.tvlock/.lock.LockAdminReceiver
```

成功后锁屏会走 Lock Task，Home / 最近任务在锁定期间无效。解锁后 `stopLockTask`，其它应用可正常用。

卸掉（避免变砖）：

```text
adb.exe shell dpm remove-active-admin com.cjlhll.tvlock/.lock.LockAdminReceiver
```

本机 PIN 可在云或手机都不可用时解锁 30 分钟。

当前这台 M6 Note 测试机已经设过 Device Owner。若重装同包名应用，Owner 会保留；要卸掉再用上面的 `remove-active-admin`。

部分系统（含 Device Owner）会禁止应用明文 HTTP。APK 对 `http://` 走套接字回退；正式上线再改 HTTPS。

## 4. 微信小程序 + 云开发

**当前用正式 AppID `wx0ae9a52d7f29cc39`，仍走自建 API**，不走云开发。开发者工具必须打开这个号，不要再打开旧测试号。

1. 用 **Windows 微信开发者工具** 打开 `C:\Users\caoji\tv-controller`（不要用 `\\wsl.localhost\...`，WSL 路径经常不重新编译 JS，会一直走旧的 `cloud.callFunction`）。云函数目录是 `cloudfunctions/api`。详情里勾选「不校验合法域名」。
2. `project.config.json` 已是正式 AppID `wx0ae9a52d7f29cc39`。
3. 开通云开发，把环境 ID 写入：
   - [`miniprogram/env.js`](../miniprogram/env.js) 的 `cloudEnv`
   - 云函数 [`cloudfunctions/api/config.json`](../cloudfunctions/api/config.json) 的模板 ID
4. 上传并部署云函数 `api`（在函数目录执行 `npm install` 后再上传）。
5. 控制台创建集合：`devices`、`bindings`、`logs`。权限先用「仅创建者可读写」不够，因为设备端走 HTTP、云函数用管理员权限写库；集合权限建议「仅云函数可写」，或开发阶段「所有用户可读，仅云函数可写」。
6. 订阅消息：已选用模板「解锁进度通知」`0FiHP-u3-tnliKxfAEg_22HXQ17NAdR-dPHsWmUIknQ`，字段 `thing1` 解锁名称、`thing2` 活动进度、`thing3` 温馨提示、`time4` 解锁时间。
7. 为云函数开通 **HTTP 访问**，把得到的 URL 填进 APK 设置里的服务器地址（POST JSON，`action` 字段与本机 API 相同）。

绑定后、每次批准结束时，小程序会再拉一次订阅，方便接收下一次「设备已打开」。

开发版预览才能测订阅弹窗，开发者工具模拟器不可靠。

## 4.1 如何申请小程序订阅消息（推送到家长微信）

正式号 `wx0ae9a52d7f29cc39` 已接入。模板「解锁进度通知」`0FiHP-u3-tnliKxfAEg_22HXQ17NAdR-dPHsWmUIknQ` 字段为 `thing1` / `thing2` / `thing3` / `time4`。AppSecret 只放 `cloud/local-server/.env`（已 gitignore），部署到 `192.168.1.2:/opt/tvlock/cloud/local-server/.env`。

发送条件：

1. 家长用**正式号**打开小程序（开发者工具项目 AppID 必须是 `wx0ae9a52d7f29cc39`）。
2. `wx.login` 换到真实 openid，并重新扫码绑定（旧的 `mp-dev` 绑不到推送）。
3. 点「接收打开提醒」或批准页弹出的订阅框，允许「解锁结果通知」。一次性订阅，同意一次只能发一条。
4. 孩子在锁屏点「申请解锁」。服务端调 `subscribe/send`，通知点进 `pages/approve/approve?deviceId=...`。

必须用**真机微信**测。模拟器、本机审批页的 `local-parent` 都收不到。

一次订阅只能发一条。家长每次打开小程序或点批准时再订阅，才能收下一次申请。

## 5. 索尼电视（二期）

同一份 APK，已带 `LEANBACK_LAUNCHER`、电视尺寸、横屏字号、遥控器焦点框、`DREAMING_STOPPED` 唤醒。

```text
adb connect <电视IP>
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

与手机差异：

- 睡眠常走屏保/Dream，不是重启。看 Logcat 是否收到 `SCREEN_ON` / `DREAMING_STOPPED`。
- 必须给叠加层权限，否则 Android 10+ 后台拉不起锁屏。
- Device Owner 若电视已登录 Google，需先移除账号再 `dpm set-device-owner`，然后再加回账号。
- 若希望开机直接进锁屏，可用 Device Owner 把本应用设为 Home；仓库里 `TvHomeAlias` 默认关闭（避免手机变成只能进本应用）。索尼上如需桌面替换，再启用该 alias。

## 6. API 一览

`POST {server}/api`，JSON：

设备（带 `deviceId` + `deviceSecret`，`register` 可首次不带）：

- `register` / `refreshPair` / `wake` / `requestUnlock` / `state` / `pinUnlock` / `lock`

家长（小程序云函数带 openid；本机页可带 `openid`）：

- `bind`（`pairToken`）
- `myDevices`
- `approve`（`deviceId`, `durationMin`）
- `reject`
- `logs`
- `setDeviceName`
- `setPin`（`deviceId`, 4–6 位数字 `pin`；`myDevices` 会返回当前 PIN）
