'use strict'

const cloud = require('wx-server-sdk')
const logic = require('./logic')
const defaultConfig = require('./config.json')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function loadConfig() {
  const cfg = { ...defaultConfig }
  if (process.env.SUBSCRIBE_TEMPLATE_ID) {
    cfg.subscribeTemplateId = process.env.SUBSCRIBE_TEMPLATE_ID
  }
  if (process.env.MINIPROGRAM_STATE) {
    cfg.miniprogramState = process.env.MINIPROGRAM_STATE
  }
  return cfg
}

function formatSubscribeTime(ts) {
  const d = new Date(ts || Date.now())
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  )
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`
}

function normalizeEvent(event) {
  if (!event) return {}
  if (event.httpMethod || event.requestContext || event.path) {
    let body = event.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}')
      } catch (e) {
        body = {}
      }
    }
    const query = event.queryStringParameters || event.query || {}
    return { ...(body || {}), ...query }
  }
  return event
}

function ok(data) {
  return { ok: true, now: logic.nowMs(), ...data }
}

function fail(code, message, extra) {
  return { ok: false, error: code, message, ...(extra || {}) }
}

async function getDeviceById(deviceId) {
  if (!deviceId) return null
  const snap = await db.collection('devices').where({ deviceId }).limit(1).get()
  return snap.data[0] || null
}

async function saveDevice(device) {
  const copy = { ...device }
  delete copy._id
  delete copy.expiredJustNow
  if (device._id) {
    await db.collection('devices').doc(device._id).update({ data: copy })
    return
  }
  const add = await db.collection('devices').add({ data: copy })
  device._id = add._id
}

async function addLog(entry) {
  await db.collection('logs').add({
    data: {
      deviceId: entry.deviceId,
      action: entry.action,
      openid: entry.openid || '',
      durationMin: entry.durationMin || 0,
      detail: entry.detail || '',
      createdAt: entry.createdAt || logic.nowMs(),
    },
  })
}

async function listBindings(deviceId) {
  const snap = await db.collection('bindings').where({ deviceId }).get()
  return snap.data || []
}

async function findBinding(openid, deviceId) {
  const snap = await db
    .collection('bindings')
    .where({ openid, deviceId })
    .limit(1)
    .get()
  return snap.data[0] || null
}

async function notifyParents(device, config) {
  const tmplId = config.subscribeTemplateId
  if (!tmplId || String(tmplId).startsWith('YOUR_')) {
    return { skipped: true, reason: 'template_not_configured' }
  }
  const binds = await listBindings(device.deviceId)
  const page = `${config.subscribePage}?deviceId=${encodeURIComponent(device.deviceId)}`
  const results = []
  for (const b of binds) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: b.openid,
        templateId: tmplId,
        page,
        miniprogramState: config.miniprogramState || 'developer',
        data: {
          thing1: { value: logic.clip(device.name || '设备', 20) },
          thing2: { value: logic.clip(config.thing2 || '等待家长批准', 20) },
          thing3: { value: logic.clip(config.thing3 || '请打开小程序选择时长', 20) },
          time4: { value: config.time4 || formatSubscribeTime() },
        },
      })
      results.push({ openid: b.openid, sent: true })
    } catch (err) {
      console.error('subscribe send fail', err)
      results.push({ openid: b.openid, sent: false, message: err.message })
    }
  }
  return { skipped: false, results }
}

async function handleDevice(action, payload) {
  const now = logic.nowMs()

  if (action === 'register') {
    let device = null
    if (payload.deviceId && payload.deviceSecret) {
      device = await getDeviceById(payload.deviceId)
      if (!logic.assertDeviceAuth(device, payload.deviceSecret)) {
        device = null
      }
    }
    const created = !device
    device = logic.applyRegister(device, payload, now)
    if (created) {
      await saveDevice(device)
      await addLog({ deviceId: device.deviceId, action: 'register', createdAt: now })
    } else {
      await saveDevice(device)
    }
    return ok({
      device: logic.publicDevice(device),
      deviceId: device.deviceId,
      deviceSecret: device.deviceSecret,
      pairToken: device.pairToken,
      pairTokenExpireAt: device.pairTokenExpireAt,
    })
  }

  const device = await getDeviceById(payload.deviceId)
  if (!logic.assertDeviceAuth(device, payload.deviceSecret)) {
    return fail('AUTH', '设备鉴权失败')
  }
  logic.expireIfNeeded(device, now)

  if (action === 'refreshPair') {
    logic.applyRefreshPair(device, now)
    await saveDevice(device)
    return ok({
      pairToken: device.pairToken,
      pairTokenExpireAt: device.pairTokenExpireAt,
      device: logic.publicDevice(device),
    })
  }

  if (action === 'state' || action === 'heartbeat') {
    device.onlineAt = now
    logic.applyHardware(device, payload)
    await saveDevice(device)
    return ok({ device: logic.publicDevice(device, now, { includeCommand: true }) })
  }

  if (action === 'ackCommand') {
    logic.clearCommand(device)
    await saveDevice(device)
    return ok({ device: logic.publicDevice(device, now, { includeCommand: true }) })
  }

  if (action === 'wake' || action === 'requestUnlock') {
    logic.applyHardware(device, payload)
    const result =
      action === 'requestUnlock' ? logic.applyRequestUnlock(device, now) : logic.applyWake(device, now)
    await saveDevice(result.device)
    await addLog({
      deviceId: device.deviceId,
      action: action === 'requestUnlock' ? 'request' : 'wake',
      detail: result.reason,
      createdAt: now,
    })
    let notify = { skipped: true, reason: result.reason }
    if (result.notify) {
      const cfg = loadConfig()
      if (action === 'requestUnlock') {
        cfg.thing2 = '孩子申请解锁，请批准'
      }
      notify = await notifyParents(result.device, cfg)
    }
    return ok({
      device: logic.publicDevice(result.device),
      notify,
    })
  }

  if (action === 'pinUnlock') {
    const { device: unlocked, minutes } = logic.applyApprove(
      device,
      payload.durationMin || logic.DEFAULT_PIN_DURATION_MIN,
      now
    )
    await saveDevice(unlocked)
    await addLog({
      deviceId: device.deviceId,
      action: 'pin',
      durationMin: minutes,
      createdAt: now,
    })
    return ok({ device: logic.publicDevice(unlocked) })
  }

  if (action === 'lock') {
    logic.applyLock(device, now)
    await saveDevice(device)
    await addLog({ deviceId: device.deviceId, action: 'lock', createdAt: now })
    return ok({ device: logic.publicDevice(device) })
  }

  return fail('UNKNOWN_ACTION', `未知设备动作: ${action}`)
}

async function handleUser(action, payload, openid) {
  const now = logic.nowMs()
  if (!openid) {
    return fail('NO_OPENID', '请在小程序内登录后再操作')
  }

  if (action === 'bind') {
    const token = String(payload.pairToken || '').trim().toUpperCase()
    if (!token) return fail('BAD_TOKEN', '缺少配对码')
    const snap = await db.collection('devices').where({ pairToken: token }).limit(1).get()
    const device = snap.data[0]
    if (!device) return fail('NOT_FOUND', '找不到设备，请确认二维码未过期')
    const bound = await findBinding(openid, device.deviceId)
    if (bound) {
      return ok({ device: logic.publicDevice(device), already: true })
    }
    const result = logic.applyBind(device, now)
    if (result.error) return fail(result.error, result.message)
    await saveDevice(result.device)
    await db.collection('bindings').add({
      data: { openid, deviceId: device.deviceId, createdAt: now },
    })
    await addLog({ deviceId: device.deviceId, action: 'bind', openid, createdAt: now })
    return ok({ device: logic.publicDevice(result.device), already: false })
  }

  if (action === 'myDevices') {
    const binds = await db.collection('bindings').where({ openid }).get()
    const devices = []
    for (const b of binds.data) {
      const device = await getDeviceById(b.deviceId)
      if (device) {
        logic.expireIfNeeded(device, now)
        await saveDevice(device)
        devices.push(logic.publicDevice(device))
      }
    }
    return ok({ devices })
  }

  if (
    action === 'approve' ||
    action === 'reject' ||
    action === 'logs' ||
    action === 'setDeviceName' ||
    action === 'remoteLock' ||
    action === 'requestScreenshot' ||
    action === 'getScreenshot'
  ) {
    const device = await getDeviceById(payload.deviceId)
    if (!device) return fail('NOT_FOUND', '设备不存在')
    const bound = await findBinding(openid, device.deviceId)
    if (!bound) return fail('FORBIDDEN', '未绑定该设备')
    logic.expireIfNeeded(device, now)

    if (action === 'logs') {
      const snap = await db
        .collection('logs')
        .where({ deviceId: device.deviceId })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      return ok({ logs: snap.data || [] })
    }

    if (action === 'setDeviceName') {
      device.name = logic.clip(payload.name || device.name, 20)
      await saveDevice(device)
      return ok({ device: logic.publicDevice(device) })
    }

    if (action === 'approve') {
      const { device: unlocked, minutes } = logic.applyApprove(device, payload.durationMin, now)
      await saveDevice(unlocked)
      await addLog({
        deviceId: device.deviceId,
        action: 'approve',
        openid,
        durationMin: minutes,
        createdAt: now,
      })
      return ok({ device: logic.publicDevice(unlocked), minutes })
    }

    if (action === 'remoteLock') {
      logic.applyLock(device, now)
      await saveDevice(device)
      await addLog({ deviceId: device.deviceId, action: 'lock', openid, createdAt: now })
      return ok({ device: logic.publicDevice(device) })
    }

    if (action === 'requestScreenshot') {
      const result = logic.applyCommand(device, 'screenshot', now)
      if (result.error) return fail(result.error, result.message)
      await saveDevice(result.device)
      await addLog({ deviceId: device.deviceId, action: 'screenshot', openid, createdAt: now })
      return ok({ device: logic.publicDevice(result.device), command: 'screenshot' })
    }

    if (action === 'getScreenshot') {
      return ok({
        device: logic.publicDevice(device),
        screenshotAt: device.screenshotAt || 0,
        screenshotError: device.screenshotError || '',
        image: '',
        mime: 'image/jpeg',
        message: '截图文件仅自建 API 支持',
      })
    }

    logic.applyReject(device, now)
    await saveDevice(device)
    await addLog({ deviceId: device.deviceId, action: 'reject', openid, createdAt: now })
    return ok({ device: logic.publicDevice(device) })
  }

  return fail('UNKNOWN_ACTION', `未知用户动作: ${action}`)
}

const DEVICE_ACTIONS = new Set([
  'register',
  'refreshPair',
  'wake',
  'state',
  'heartbeat',
  'pinUnlock',
  'lock',
  'requestUnlock',
  'ackCommand',
])
const USER_ACTIONS = new Set([
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

exports.main = async (event) => {
  const payload = normalizeEvent(event)
  const action = payload.action
  try {
    if (!action) return fail('NO_ACTION', '缺少 action')
    if (DEVICE_ACTIONS.has(action)) {
      return await handleDevice(action, payload)
    }
    if (USER_ACTIONS.has(action)) {
      const wxCtx = cloud.getWXContext()
      const openid = wxCtx.OPENID || payload.openid || ''
      return await handleUser(action, payload, openid)
    }
    return fail('UNKNOWN_ACTION', `未知动作: ${action}`)
  } catch (err) {
    console.error(err)
    return fail('INTERNAL', err.message || '服务器错误')
  }
}
