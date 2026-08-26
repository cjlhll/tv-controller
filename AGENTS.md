# TV Lock — 给后续 Agent 的项目说明

家用限时解锁：被控设备开机/唤醒先锁屏，家长在微信小程序批准并选时长后才能正常使用，到期自动回锁。

一期目标机是 **Windows USB 上的专用测试机（魅族 M6 Note / Lineage，已 root、已 Device Owner）**。索尼电视是二期，同一份 APK。

细节命令以 [docs/setup.md](docs/setup.md) 为准。改代码前先读本文。

---

## 1. 产品逻辑

```
开机 / 睡眠唤醒
    → 被控 APK 全屏锁屏（未绑定显示二维码+6 位配对码）
    → POST wake（已绑定则 status=pending，并尝试给家长发订阅消息）
    → 家长在小程序选时长 approve，或本机 PIN
    → APK 退出锁屏，系统桌面可用；前台服务继续轮询
    → unlockUntil 到期，或再次唤醒且已过期 → 回锁
```

状态机（云端/本机 API 是授权真相；设备本地再守一份倒计时，断网也能回锁）：

- `unbound`：未扫码。锁屏只出配对码。
- `locked`：已绑定，未授权。
- `pending`：已上报打开，等批准。
- `unlocked`：`unlockUntil > now`。服务仍在跑。

配对码 6 位，10 分钟过期，用一次即作废。锁屏在锁定/未绑定时都显示「刷新配对码」；点了才出二维码。长按标题进设置，不要靠这个找配对码。应用图标直接进锁屏，不再进初始设置页。

本机 PIN（4–6 位数字）存在云端，家长可在小程序查看和修改；设备轮询 `state` 后同步到本机哈希（SHA-256+salt）。走 `pinUnlock`，默认 30 分钟。当前测试机 PIN 是 **`2468`**。长按锁屏标题回设置页。云端已有 PIN 时，本机设置页改 PIN 不会覆盖。

Device Owner + Lock Task：锁定时 Home / 最近任务无效；解锁 `stopLockTask`。包名 `com.cjlhll.tvlock`，Admin：`.lock.LockAdminReceiver`。

---

## 2. 三端与数据

```
被控 APK  --HTTP POST /api-->  本机 Node 或 微信云函数 api
微信小程序 --wx.request 或 callFunction-->  同一套 action
```

**现在（一期联调）不走云开发。** 小程序已切正式 AppID `wx0ae9a52d7f29cc39`，只请求自建 API。订阅消息走 `subscribe/send`，密钥在服务器 `.env`，不要写进仓库。旧测试号 `wx7d3b9c23e55f5c53` 不要再打开。

### 自建 API（Docker @ 192.168.1.2）

- 公网：`POST https://armbian.caojian.shop:8787/api`（路由器已转发到内网 `192.168.1.2:8787`，Caddy 终结 TLS）
- 审批页：https://armbian.caojian.shop:8787/
- 健康检查：https://armbian.caojian.shop:8787/health
- 容器：`tvlock-api`，数据卷 `/opt/tvlock/data/data.json`
- 部署：本机已 SSH 免密到 `root@192.168.1.2` 后执行 `./scripts/deploy-api.sh`
- 本机调试仍可用：`node cloud/local-server/server.js`（监听 `0.0.0.0:8787`）
- 状态机实现：[`cloudfunctions/api/logic.js`](cloudfunctions/api/logic.js)（云函数与自建 API 共用）
- 云函数入口：[`cloudfunctions/api/index.js`](cloudfunctions/api/index.js)（正式 AppID 开通云开发后再上传）

`POST /api` JSON 必有 `action`：

| 调用方 | action | 鉴权 |
|---|---|---|
| 设备 | `register` `refreshPair` `wake` `state` `heartbeat` `pinUnlock` `lock` `requestUnlock` `ackCommand` `uploadScreenshot` | `deviceId` + `deviceSecret`（`register` 可首次不带） |
| 家长 | `login` `bind` `myDevices` `approve` `reject` `logs` `setDeviceName` `setPin` `remoteLock` `requestScreenshot` `getScreenshot` | 小程序 `wx.login` → `login` 换真实 openid；本机审批页用 `local-parent` |

`bind` 需要 `pairToken`。`approve` 需要 `deviceId` + `durationMin`。`setPin` 需要 `deviceId` + 4–6 位数字 `pin`；`myDevices` 会带上当前 `pin`。

联调 openid：

- 小程序：`wx.login` 换真实 openid（[`miniprogram/utils/api.js`](miniprogram/utils/api.js)）
- 本机审批页用 `local-parent`（收不到订阅消息）
- 一台设备可绑多个 openid
- 微信密钥：`cloud/local-server/.env`（已 gitignore），部署到 `192.168.1.2:/opt/tvlock/cloud/local-server/.env`

测试机当前 `deviceId`：`edbcef7b8488db6c`（名称 M6 Note）。已绑 `local-parent` 和旧的 `mp-dev`。正式号登录后要重新扫码绑定，订阅才会打到真实 openid。

### 小程序

页面：`pages/index` 设备列表；`pages/bind` 扫码/手输配对码；`pages/approve` 时长；`pages/logs` 记录。

[`miniprogram/utils/api.js`](miniprogram/utils/api.js) **只许 `wx.request` 打本机**，不要再加 `wx.cloud.callFunction` 作为默认路径。[`miniprogram/app.js`](miniprogram/app.js) 会把残留的 `cloud.callFunction` 劫持到同一 URL。

[`miniprogram/env.js`](miniprogram/env.js) 里还有 `useLocalApi` / `cloudEnv` 字段，当前主路径已不依赖它们。正式云开发时再改回 `callFunction`。

### Android

包名 `com.cjlhll.tvlock`。入口 `SetupActivity`（未完成设置）→ `LockActivity`。`LockService` 每 2 秒 `state`，唤醒广播再 `wake`。

关键类：`lock/LockService` `lock/LockController` `lock/WakeReceiver` `net/CloudClient` `ui/LockActivity` `ui/SetupActivity`。

`http://` 不用 OkHttp（Device Owner / 系统策略会报 CLEARTEXT），走 `CloudClient.rawHttpPost`。`https://`（以后云开发 HTTP）仍走 OkHttp。

默认服务器 `https://armbian.caojian.shop:8787/api`。家里靠 OpenWrt「自定义映射域名」把该域名指到 `192.168.1.2`。不要再填 `127.0.0.1` 或内网 IP，也不要 `adb reverse`。已装过的测试机若还是 `op.caojian.shop` / 本机地址，长按锁屏标题改，或重装（会自动迁到新域名）。

---

## 3. 仓库结构

权威源码在 **WSL**：`/home/cjlhll/test/tv-controller`。

| 路径 | 作用 |
|---|---|
| `android/` | 被控 APK（Kotlin，phone + Leanback） |
| `miniprogram/` | 微信小程序 |
| `cloudfunctions/api/` | 云函数 `api`（逻辑 + HTTP/callFunction 入口） |
| `cloud/local-server/` | 本机联调 API，**不是**云函数 |
| `docs/setup.md` | 装机、ADB、云开发步骤 |
| `scripts/find-adb.sh` `scripts/install-phone.sh` `scripts/dev-local.sh` | 找 Windows adb、装包、起本机 API |

`project.config.json` 的 `cloudfunctionRoot` 必须是 `cloudfunctions/`，开发者工具才认云函数目录。不要把函数放回 `cloud/functions/`。

微信开发者工具 **不要** 打开 `\\wsl.localhost\...`。必须打开 Windows 副本：

`C:\Users\caoji\tv-controller`

WSL 改了 `miniprogram/` / `cloudfunctions/` / `project.config.json` 后同步：

```bash
rsync -a --delete \
 --exclude android --exclude cloud/local-server/data.json --exclude cloud/local-server/.env \
 /home/cjlhll/test/tv-controller/ /mnt/c/Users/caoji/tv-controller/
```

只改小程序时至少同步 `miniprogram/`。

---

## 4. 开发环境（必须按这个走）

Cursor / 编译 APK / 本机 API：在 **WSL Debian**。

手机 ADB、微信开发者工具：在 **Windows**。

- ADB：`/mnt/c/adb/platform-tools/adb.exe`。不要用 WSL 里的 `adb`（看不到 Windows USB）。
- 当前设备：`721QACREKPMRU`，model `M6 Note`。
- 不要再做 `adb reverse`。手机和小程序都打 `https://armbian.caojian.shop:8787/api`。
- 编 APK：`org.gradle.java.home=/home/cjlhll/.local/jdk-17`（系统 OpenJDK 21 没有 `jlink`）。SDK：`android/local.properties` → `/home/cjlhll/Android/Sdk`。
- 微信 CLI：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`，IDE HTTP `127.0.0.1:10555`。CLI 不认 `\\wsl$\` 工程路径，要对 `C:\Users\caoji\tv-controller`。
- 自动化：`cli auto --project C:\Users\caoji\tv-controller --auto-port 9420`。从 WSL 连 `ws://172.18.192.1:9420`（Windows 在 `::` 上听 9420）。`miniprogram-automator` 的 `checkVersion` 在此 IDE 版本上会炸，需跳过。

当前正式 AppID：`wx0ae9a52d7f29cc39`（`project.config.json` 已对齐）。开发者工具必须用这个号打开工程，真机预览才能收订阅消息。

---

## 5. 日常联调顺序

1. 确认 `https://armbian.caojian.shop:8787/health` 返回 `{"ok":true,"wechat":true}`。本机改 API 后跑 `./scripts/deploy-api.sh`。
2. `adb.exe devices` 有手机。不要 `adb reverse`。
3. 需要装新包：`cd android && ./gradlew :app:assembleDebug`，再 `./scripts/install-phone.sh`。
4. 改小程序：先改 WSL，再 rsync 到 `C:\Users\caoji\tv-controller`，用开发者工具打开 **Windows 目录**，编译一次。详情勾选「不校验合法域名」，并把 `https://armbian.caojian.shop` 写入 RequestDomain。
5. 模拟器首页应能看到「M6 Note」。批准时长后手机应回桌面；到期或 `action:lock` 后回锁屏。

没有小程序时，用 https://armbian.caojian.shop:8787/ 或 curl 批准。

```bash
curl -sS -X POST https://armbian.caojian.shop:8787/api \
  -H 'Content-Type: application/json' \
  -d '{"action":"approve","deviceId":"edbcef7b8488db6c","durationMin":15,"openid":"mp-dev"}'
```

配对码用过即废。需要再绑：锁屏点「刷新配对码」，或写 `data.json` 的 `pairToken` / `pairTokenExpireAt` 后再 `bind`。

逻辑单测：`node cloudfunctions/api/logic.test.js`。

---

## 6. 已经踩过的坑（不要重蹈）

1. **测试号不能开云开发。** 左侧没有「云函数」节点是正常的。报 `errCode: -501000 Environment not found` 说明又走到了 `wx.cloud.callFunction`。
2. **不要用 WSL UNC 当开发者工具工程根。** 文件变更经常不进编译包，界面还是旧 JS。
3. **`urlCheck: false` 不够。** 测试号 `RequestDomain` 为空时，模拟器仍报 `request:fail url not in domain list`。需要详情勾选「不校验合法域名」，或把 `http://127.0.0.1` / `http://localhost` / 带端口的写入该工程的 DevTools `runtimeAttr.network.RequestDomain`（`%LOCALAPPDATA%\微信开发者工具\User Data\...\WeappLocalData\localstorage_*.json`，`projectpath` 对得上的那份）。
4. **APK 明文 HTTP：** Device Owner 下 OkHttp 会 `CLEARTEXT communication not permitted`，必须走套接字回退。
5. **不要把 Magisk / `su` / root 写进正式逻辑。** 索尼没有 root，测试机的 root 也不要用。截图对齐 atvTools：走系统合成器（无障碍 `takeScreenshot`），失败立刻回传原因，不要空转等到超时。
6. **`LauncherAlias` 完成设置后关闭。** 桌面不再出现 TV Lock 图标。Device Owner 下 `setUninstallBlocked` 禁止卸载。`TvHomeAlias` 仅电视锁定时打开。
7. **卸载 Device Owner：** `adb.exe shell dpm remove-active-admin com.cjlhll.tvlock/.lock.LockAdminReceiver`。同包名重装会保留 Owner。

---

## 7. 改代码时的约定

- 状态机只改 `cloudfunctions/api/logic.js`，本机服务和云函数都引用它。改完跑 `logic.test.js`。
- 设备鉴权不要放到小程序；小程序不能拿 `deviceSecret`。
- 一期小程序默认本机 HTTPS（`https://armbian.caojian.shop:8787/api`）。未开通云开发前不要把主路径改回 `callFunction`。
- 同步到 Windows 副本后再让用户编译；不要只改 WSL 就声称「小程序已更新」。
- 不要提交 `cloud/local-server/data.json`、`android/local.properties`、密钥、PIN 明文到公共远程（PIN `2468` 仅本机测试）。
- 索尼适配：横屏 / `values-television` / 遥控器焦点 / `DREAMING_STOPPED` / Leanback，不要另起一个 APK。
- 订阅消息：正式 AppID + `.env` 里的 `WECHAT_APPID` / `WECHAT_SECRET` + 模板 `SUBSCRIBE_TEMPLATE_ID`。家长先 `requestSubscribeMessage`，孩子再 `requestUnlock` / `wake`（申请时推送；批准成功不再推送）。不要把 AppSecret 写进仓库或小程序。详见 `docs/setup.md` 4.1。

---

## 8. 二期（未在索尼实机验证）

同一 APK：`LEANBACK_LAUNCHER`、电视字号、`DREAMING_STOPPED`。电视用 `adb connect <IP>`。Device Owner 若已登录 Google，要先去账号。遥控器电源键一下是待机不是关机：进待机听 `SCREEN_OFF` / `DREAMING_STARTED`，醒来听 `SCREEN_ON` / `DREAMING_STOPPED`。电视锁屏不要 `KEEP_SCREEN_ON`，待机时不要再 `launchLock`。没有应用可发的待机广播。唤醒路径必须在索尼上重测，手机通过 ≠ 电视通过。

正式发布路径：正式小程序 AppID → 开通云开发 → 上传 `cloudfunctions/api` → 集合 `devices` `bindings` `logs` → 一次性订阅消息 → 云函数 HTTP 地址填进 APK → 小程序改回 `callFunction`。
