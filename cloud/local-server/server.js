'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const logic = require('../../cloudfunctions/api/logic')
const wechatNotify = require('./wechat-notify')

const PORT = Number(process.env.PORT || 8787)
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json')

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (e) {
    return { devices: {}, bindings: [], logs: [] }
  }
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
}

function json(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Length': Buffer.byteLength(raw),
  })
  res.end(raw)
}

function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function ok(data) {
  return { ok: true, now: logic.nowMs(), ...data }
}

function fail(code, message) {
  return { ok: false, error: code, message }
}

function screenshotDir() {
  const dir = path.join(path.dirname(DATA_FILE), 'screenshots')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function screenshotPath(deviceId) {
  return path.join(screenshotDir(), `${deviceId}.jpg`)
}

function saveScreenshot(deviceId, image) {
  const raw = String(image || '').replace(/^data:image\/\w+;base64,/, '')
  if (!raw) return { ok: false, error: 'EMPTY', message: '截图为空' }
  let buf
  try {
    buf = Buffer.from(raw, 'base64')
  } catch (e) {
    return { ok: false, error: 'BAD_IMAGE', message: '截图格式无效' }
  }
  if (buf.length < 32 || buf.length > 4 * 1024 * 1024) {
    return { ok: false, error: 'BAD_IMAGE', message: '截图大小不合法' }
  }
  fs.writeFileSync(screenshotPath(deviceId), buf)
  return { ok: true }
}

function readScreenshot(deviceId) {
  try {
    const buf = fs.readFileSync(screenshotPath(deviceId))
    return { image: buf.toString('base64'), mime: 'image/jpeg' }
  } catch (e) {
    return { image: '', mime: 'image/jpeg' }
  }
}

function getDevice(db, deviceId) {
  return db.devices[deviceId] || null
}

function persistDevice(db, device) {
  db.devices[device.deviceId] = device
}

function addLog(db, entry) {
  db.logs.unshift({
    deviceId: entry.deviceId,
    action: entry.action,
    openid: entry.openid || '',
    durationMin: entry.durationMin || 0,
    detail: entry.detail || '',
    createdAt: entry.createdAt || logic.nowMs(),
  })
  db.logs = db.logs.slice(0, 200)
}

async function notifyIfNeeded(db, device, shouldNotify, reason, kind, minutes) {
  if (!shouldNotify) return { skipped: true, reason }
  try {
    return await wechatNotify.notifyParents(
      device,
      db.bindings || [],
      wechatNotify.fieldsFor(kind || 'wake', device, minutes)
    )
  } catch (err) {
    return { skipped: false, error: err.message }
  }
}

function summarizeNotify(notify) {
  if (!notify || notify.skipped) return notify
  const results = notify.results || []
  if (results.some((r) => r.sent)) return Object.assign({}, notify, { reason: 'sent' })
  const first = results[0] || {}
  const msg = String(first.message || notify.error || '')
  const code = first.errcode
  if (code === 43101 || /user refuse|43101/i.test(msg)) {
    return Object.assign({}, notify, { reason: 'need_subscribe' })
  }
  if (code === 40037 || /invalid template/i.test(msg)) {
    return Object.assign({}, notify, { reason: 'bad_template' })
  }
  return Object.assign({}, notify, { reason: msg || 'send_failed' })
}

function handleDevice(db, action, payload) {
  const now = logic.nowMs()
  if (action === 'register') {
    let device = null
    if (payload.deviceId && payload.deviceSecret) {
      device = getDevice(db, payload.deviceId)
      if (!logic.assertDeviceAuth(device, payload.deviceSecret)) device = null
    }
    const created = !device
    device = logic.applyRegister(device, payload, now)
    persistDevice(db, device)
    if (created) addLog(db, { deviceId: device.deviceId, action: 'register', createdAt: now })
    return ok({
      device: logic.publicDevice(device),
      deviceId: device.deviceId,
      deviceSecret: device.deviceSecret,
      pairToken: device.pairToken,
      pairTokenExpireAt: device.pairTokenExpireAt,
    })
  }

  const device = getDevice(db, payload.deviceId)
  if (!logic.assertDeviceAuth(device, payload.deviceSecret)) {
    return fail('AUTH', '设备鉴权失败')
  }
  logic.expireIfNeeded(device, now)

  if (action === 'refreshPair') {
    logic.applyRefreshPair(device, now)
    persistDevice(db, device)
    return ok({
      pairToken: device.pairToken,
      pairTokenExpireAt: device.pairTokenExpireAt,
      device: logic.publicDevice(device),
    })
  }
  if (action === 'state' || action === 'heartbeat') {
    device.onlineAt = now
    logic.applyHardware(device, payload)
    persistDevice(db, device)
    return ok({ device: logic.publicDevice(device, now, { includeCommand: true }) })
  }
  if (action === 'ackCommand') {
    logic.clearCommand(device)
    persistDevice(db, device)
    return ok({ device: logic.publicDevice(device, now, { includeCommand: true }) })
  }
  if (action === 'uploadScreenshot') {
    if (payload.error && !payload.image) {
      logic.markScreenshot(device, now, payload.error)
      logic.clearCommand(device)
      persistDevice(db, device)
      return ok({
        device: logic.publicDevice(device),
        screenshotAt: device.screenshotAt,
        screenshotError: device.screenshotError,
      })
    }
    const saved = saveScreenshot(device.deviceId, payload.image)
    if (!saved.ok) return fail(saved.error, saved.message)
    logic.markScreenshot(device, now)
    logic.clearCommand(device)
    persistDevice(db, device)
    addLog(db, { deviceId: device.deviceId, action: 'screenshot', createdAt: now })
    return ok({ device: logic.publicDevice(device), screenshotAt: device.screenshotAt })
  }
  if (action === 'wake' || action === 'requestUnlock') {
    logic.applyHardware(device, payload)
    const result =
      action === 'requestUnlock' ? logic.applyRequestUnlock(device, now) : logic.applyWake(device, now)
    persistDevice(db, result.device)
    addLog(db, {
      deviceId: device.deviceId,
      action: action === 'requestUnlock' ? 'request' : 'wake',
      detail: result.reason,
      createdAt: now,
    })
    return notifyIfNeeded(
      db,
      result.device,
      result.notify,
      result.reason,
      action === 'requestUnlock' ? 'request' : 'wake'
    ).then((notify) =>
      ok({
        device: logic.publicDevice(result.device, now, { includeCommand: true }),
        notify: summarizeNotify(notify),
      })
    )
  }
  if (action === 'pinUnlock') {
    const { device: unlocked, minutes } = logic.applyApprove(
      device,
      payload.durationMin || logic.DEFAULT_PIN_DURATION_MIN,
      now
    )
    persistDevice(db, unlocked)
    addLog(db, { deviceId: device.deviceId, action: 'pin', durationMin: minutes, createdAt: now })
    return ok({ device: logic.publicDevice(unlocked) })
  }
  if (action === 'lock') {
    logic.applyLock(device, now)
    persistDevice(db, device)
    addLog(db, { deviceId: device.deviceId, action: 'lock', createdAt: now })
    return ok({ device: logic.publicDevice(device) })
  }
  return fail('UNKNOWN_ACTION', `未知设备动作: ${action}`)
}

function handleUser(db, action, payload) {
  const now = logic.nowMs()
  const openid = payload.openid || 'local-parent'

  if (action === 'bind') {
    const token = String(payload.pairToken || '').trim().toUpperCase()
    const device = Object.values(db.devices).find((d) => d.pairToken === token)
    if (!device) return fail('NOT_FOUND', '找不到设备，请确认二维码未过期')
    const already = db.bindings.some((b) => b.openid === openid && b.deviceId === device.deviceId)
    if (already) return ok({ device: logic.publicDevice(device), already: true })
    const result = logic.applyBind(device, now)
    if (result.error) return fail(result.error, result.message)
    persistDevice(db, result.device)
    db.bindings.push({ openid, deviceId: device.deviceId, createdAt: now })
    addLog(db, { deviceId: device.deviceId, action: 'bind', openid, createdAt: now })
    return ok({ device: logic.publicDevice(result.device), already: false })
  }

  if (action === 'myDevices') {
    const ids = db.bindings.filter((b) => b.openid === openid).map((b) => b.deviceId)
    const devices = ids
      .map((id) => {
        const d = getDevice(db, id)
        if (!d) return null
        logic.expireIfNeeded(d, now)
        persistDevice(db, d)
        return logic.publicDevice(d)
      })
      .filter(Boolean)
    return ok({ devices })
  }

  const device = getDevice(db, payload.deviceId)
  if (!device) return fail('NOT_FOUND', '设备不存在')

  if (action === 'logs') {
    return ok({
      logs: db.logs.filter((l) => l.deviceId === device.deviceId).slice(0, 50),
    })
  }
  if (action === 'setDeviceName') {
    device.name = logic.clip(payload.name || device.name, 20)
    persistDevice(db, device)
    return ok({ device: logic.publicDevice(device) })
  }
  if (action === 'approve') {
    const { device: unlocked, minutes } = logic.applyApprove(device, payload.durationMin, now)
    persistDevice(db, unlocked)
    addLog(db, {
      deviceId: device.deviceId,
      action: 'approve',
      openid,
      durationMin: minutes,
      createdAt: now,
    })
    return ok({ device: logic.publicDevice(unlocked), minutes })
  }
  if (action === 'reject') {
    logic.applyReject(device, now)
    persistDevice(db, device)
    addLog(db, { deviceId: device.deviceId, action: 'reject', openid, createdAt: now })
    return ok({ device: logic.publicDevice(device) })
  }
  if (action === 'remoteLock') {
    logic.applyLock(device, now)
    persistDevice(db, device)
    addLog(db, { deviceId: device.deviceId, action: 'lock', openid, createdAt: now })
    return ok({ device: logic.publicDevice(device) })
  }
  if (action === 'requestScreenshot') {
    const result = logic.applyCommand(device, 'screenshot', now)
    if (result.error) return fail(result.error, result.message)
    persistDevice(db, result.device)
    addLog(db, { deviceId: device.deviceId, action: 'screenshot', openid, createdAt: now })
    return ok({ device: logic.publicDevice(result.device), command: 'screenshot' })
  }
  if (action === 'getScreenshot') {
    const shot = readScreenshot(device.deviceId)
    return ok({
      device: logic.publicDevice(device),
      screenshotAt: device.screenshotAt || 0,
      screenshotError: device.screenshotError || '',
      image: device.screenshotError ? '' : shot.image,
      mime: shot.mime,
    })
  }
  return fail('UNKNOWN_ACTION', `未知用户动作: ${action}`)
}

function dispatch(db, payload) {
  const action = payload.action
  if (!action) return fail('NO_ACTION', '缺少 action')
  if (action === 'login') {
    return wechatNotify
      .code2Session(payload.code)
      .then((sess) => ok({ openid: sess.openid }))
      .catch((err) => fail('LOGIN', err.message))
  }
  const deviceActions = new Set([
    'register',
    'refreshPair',
    'wake',
    'state',
    'heartbeat',
    'pinUnlock',
    'lock',
    'requestUnlock',
    'ackCommand',
    'uploadScreenshot',
  ])
  const userActions = new Set([
    'bind',
    'myDevices',
    'approve',
    'reject',
    'logs',
    'setDeviceName',
    'remoteLock',
    'requestScreenshot',
    'getScreenshot',
  ])
  if (deviceActions.has(action)) return handleDevice(db, action, payload)
  if (userActions.has(action)) return handleUser(db, action, payload)
  return fail('UNKNOWN_ACTION', `未知动作: ${action}`)
}

function adminPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>TV Lock 本机审批</title>
  <style>
    body { font-family: sans-serif; background:#0B1220; color:#F4F7FB; margin:0; padding:24px; }
    h1 { font-size:20px; }
    .card { background:#152033; border-radius:16px; padding:20px; margin:14px 0; }
    .muted { color:#8B9BB4; font-size:13px; }
    .specs { display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; margin:12px 0 8px; }
    .spec kbd { display:block; color:#8B9BB4; font:12px sans-serif; margin-bottom:2px; }
    .spec span { color:#E8EEF7; font-size:15px; }
    button { background:#F5A623; border:0; border-radius:8px; padding:8px 12px; margin:4px; color:#111; font-weight:600; }
    button.ghost { background:#2A3A55; color:#F4F7FB; }
    input { padding:8px; border-radius:8px; border:0; }
  </style>
</head>
<body>
  <h1>TV Lock 本机审批（仅联调）</h1>
  <p class="muted">正式控制请用微信小程序。此页方便在没有云开发时批准测试机。</p>
  <div>
    配对码 <input id="token" placeholder="设备上的 6 位码"/>
    <button onclick="bind()">绑定</button>
    <button class="ghost" onclick="load()">刷新</button>
  </div>
  <div id="list"></div>
  <script>
    async function api(body) {
      const r = await fetch('/api', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      return r.json()
    }
    async function bind() {
      const pairToken = document.getElementById('token').value
      const r = await api({ action:'bind', pairToken, openid:'local-parent' })
      alert(r.ok ? '已绑定 ' + r.device.deviceId : r.message)
      load()
    }
    async function act(deviceId, action, durationMin) {
      const r = await api({ action, deviceId, durationMin, openid:'local-parent' })
      if (!r.ok) alert(r.message)
      load()
    }
    function remain(u) {
      const ms = (u||0) - Date.now()
      if (ms <= 0) return ''
      const n = Math.floor(ms / 60000)
      return '剩余 ' + (n > 0 ? n : 1) + ' 分钟'
    }
    async function load() {
      const r = await api({ action:'myDevices', openid:'local-parent' })
      const el = document.getElementById('list')
      if (!r.ok || !r.devices.length) { el.innerHTML = '<p class="muted">暂无绑定设备</p>'; return }
      el.innerHTML = r.devices.map(d => \`
        <div class="card">
          <div><b>\${d.name}</b> · \${d.status} \${remain(d.unlockUntil)}</div>
          <div class="muted">\${d.deviceId}\${d.hw && d.hw.model ? ' · ' + d.hw.model : ''}</div>
          \${d.hw ? '<div class="specs">'
            + '<div class="spec"><kbd>系统</kbd><span>' + (d.hw.os || '-') + '</span></div>'
            + '<div class="spec"><kbd>屏幕</kbd><span>' + (d.hw.screen || '-') + '</span></div>'
            + '<div class="spec"><kbd>运存</kbd><span>' + (d.hw.ram || '-') + '</span></div>'
            + '<div class="spec"><kbd>存储</kbd><span>' + (d.hw.storage || '-') + '</span></div>'
            + '</div>' : '<p class="muted">等待设备上报规格</p>'}
          <button onclick="act('\${d.deviceId}','approve',15)">15分钟</button>
          <button onclick="act('\${d.deviceId}','approve',30)">30分钟</button>
          <button onclick="act('\${d.deviceId}','approve',60)">1小时</button>
          <button class="ghost" onclick="act('\${d.deviceId}','reject')">拒绝</button>
        </div>\`).join('')
    }
    load()
    setInterval(load, 2000)
  </script>
</body>
</html>`
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
    html(res, 200, adminPage())
    return
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true, wechat: wechatNotify.isConfigured() })
    return
  }

  if (req.method === 'POST' && (url.pathname === '/api' || url.pathname === '/')) {
    const db = loadDb()
    try {
      const payload = await readBody(req)
      const result = await dispatch(db, payload)
      saveDb(db)
      json(res, 200, result)
    } catch (err) {
      json(res, 400, fail('BAD_REQUEST', err.message))
    }
    return
  }

  json(res, 404, fail('NOT_FOUND', 'not found'))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TV Lock API  http://0.0.0.0:${PORT}`)
  console.log(`Admin UI     http://0.0.0.0:${PORT}/`)
})
