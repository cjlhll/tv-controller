'use strict'

const crypto = require('crypto')

const PAIR_TTL_MS = 10 * 60 * 1000
const WAKE_NOTIFY_DEBOUNCE_MS = 60 * 1000
const REQUEST_NOTIFY_DEBOUNCE_MS = 15 * 1000
const DEFAULT_PIN_DURATION_MIN = 30
const COMMAND_TTL_MS = 90 * 1000
const ALLOWED_COMMANDS = new Set(['screenshot', 'sleep'])

function nowMs() {
  return Date.now()
}

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex')
}

function pairCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += alphabet[crypto.randomInt(alphabet.length)]
  }
  return s
}

function clip(text, max) {
  const v = String(text || '')
  return v.length <= max ? v : v.slice(0, max)
}

function formatTime(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function publicDevice(device, now = nowMs(), opts = {}) {
  if (!device) return null
  const out = {
    deviceId: device.deviceId,
    name: device.name,
    form: device.form,
    status: device.status,
    unlockUntil: device.unlockUntil || 0,
    boundCount: device.boundCount || 0,
    onlineAt: device.onlineAt || 0,
    lastWakeAt: device.lastWakeAt || 0,
    screenshotAt: device.screenshotAt || 0,
    screenshotError: device.screenshotError || '',
  }
  if (device.hw) out.hw = device.hw
  out.pin = device.pin || ''
  out.pinDurationMin = (device.pinDurationMin > 0 ? device.pinDurationMin : DEFAULT_PIN_DURATION_MIN)
  out.todayWatchMin = todayWatchMinutes(device, now)
  if (opts.includeCommand) {
    out.pendingCommand = effectiveCommand(device, now)
  }
  if (device.pairToken && (device.pairTokenExpireAt || 0) > now) {
    out.pairToken = device.pairToken
    out.pairTokenExpireAt = device.pairTokenExpireAt
  }
  return out
}

function expireIfNeeded(device, now) {
  if (!device) return device
  rollTodayWatch(device, now)
  if (device.status === 'unlocked' && (device.unlockUntil || 0) > 0 && now >= device.unlockUntil) {
    closeWatchSession(device, device.unlockUntil)
    device.status = 'locked'
    device.unlockUntil = 0
    device.expiredJustNow = true
  }
  return device
}

function shanghaiDate(ts) {
  const d = new Date(Number(ts) + 8 * 60 * 60 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shanghaiMidnight(ts) {
  return Date.parse(`${shanghaiDate(ts)}T00:00:00+08:00`)
}

function rollTodayWatch(device, now) {
  if (!device) return device
  const day = shanghaiDate(now)
  if (device.todayWatchDate !== day) {
    if ((device.watchSessionStart || 0) > 0) {
      device.watchSessionStart = Math.max(device.watchSessionStart, shanghaiMidnight(now))
    }
    device.todayWatchMs = 0
    device.todayWatchDate = day
  }
  if (
    device.status === 'unlocked' &&
    (device.unlockUntil || 0) > now &&
    !(device.watchSessionStart > 0)
  ) {
    device.watchSessionStart = now
  }
  return device
}

function closeWatchSession(device, endAt) {
  if (!device) return device
  rollTodayWatch(device, endAt)
  const start = device.watchSessionStart || 0
  if (start > 0 && endAt > start) {
    device.todayWatchMs = (device.todayWatchMs || 0) + (endAt - start)
  }
  device.watchSessionStart = 0
  return device
}

function startWatchSession(device, now) {
  rollTodayWatch(device, now)
  device.watchSessionStart = now
  return device
}

function todayWatchMinutes(device, now) {
  if (!device) return 0
  const day = shanghaiDate(now)
  let ms = device.todayWatchDate === day ? device.todayWatchMs || 0 : 0
  let start = device.watchSessionStart || 0
  if (device.todayWatchDate !== day && start > 0) {
    start = Math.max(start, shanghaiMidnight(now))
  }
  if (device.status === 'unlocked' && (device.unlockUntil || 0) > now && start > 0) {
    ms += Math.max(0, now - start)
  }
  const min = Math.round(ms / 60000)
  return min > 0 ? min : 0
}

function followsSystemName(name, prevModel) {
  if (!name || name === '未命名设备') return true
  return !!prevModel && name === prevModel
}

function applyHardware(device, payload) {
  if (!device || !payload) return device
  const src = payload.hw && typeof payload.hw === 'object' ? payload.hw : null
  if (!src) return device
  const os = clip(src.os, 32)
  const model = clip(src.model, 48)
  const screen = clip(src.screen, 24)
  const ram = clip(src.ram, 16)
  const storage = clip(src.storage, 32)
  if (!os && !model && !screen && !ram && !storage) return device
  const prevModel = device.hw && device.hw.model
  device.hw = { os, model, screen, ram, storage }
  if (model && followsSystemName(device.name, prevModel)) {
    device.name = model
  }
  return device
}

function normalizePin(pin) {
  const s = String(pin || '').trim()
  if (!/^\d{4,6}$/.test(s)) {
    return { error: 'BAD_PIN', message: 'PIN 须为 4–6 位数字' }
  }
  return { pin: s }
}

function normalizeDurationMin(durationMin, fallback = DEFAULT_PIN_DURATION_MIN) {
  const n = Number(durationMin)
  const base = Number.isFinite(n) && n > 0 ? n : fallback
  return Math.max(1, Math.min(24 * 60, Math.round(base)))
}

function applySetPinDuration(device, durationMin, now) {
  device.pinDurationMin = normalizeDurationMin(durationMin)
  device.onlineAt = now
  return { device, minutes: device.pinDurationMin }
}

function pinUnlockMinutes(device) {
  return normalizeDurationMin(device && device.pinDurationMin)
}

function applySetPin(device, pin, now, opts = {}) {
  const checked = normalizePin(pin)
  if (checked.error) return checked
  if (opts.onlyIfEmpty && device.pin) {
    return { device, skipped: true }
  }
  device.pin = checked.pin
  device.pinUpdatedAt = now
  return { device }
}

function applyIncomingPin(device, payload, now, onlyIfEmpty) {
  if (!payload || payload.pin == null || String(payload.pin).trim() === '') return device
  const result = applySetPin(device, payload.pin, now, { onlyIfEmpty })
  return result.device || device
}

function applyRegister(existing, payload, now) {
  if (existing) {
    existing.name = payload.name || existing.name
    existing.form = payload.form || existing.form
    existing.onlineAt = now
    applyHardware(existing, payload)
    expireIfNeeded(existing, now)
    applyIncomingPin(existing, payload, now, true)
    return existing
  }
  const created = {
    deviceId: randomToken(8),
    deviceSecret: randomToken(24),
    name: payload.name || '未命名设备',
    form: payload.form === 'tv' ? 'tv' : 'phone',
    status: 'unbound',
    unlockUntil: 0,
    pairToken: pairCode(),
    pairTokenExpireAt: now + PAIR_TTL_MS,
    pinHash: '',
    pin: '',
    pinUpdatedAt: 0,
    pinDurationMin: DEFAULT_PIN_DURATION_MIN,
    lastWakeAt: 0,
    lastNotifyAt: 0,
    onlineAt: now,
    boundCount: 0,
    todayWatchMs: 0,
    todayWatchDate: '',
    watchSessionStart: 0,
    createdAt: now,
  }
  applyHardware(created, payload)
  applyIncomingPin(created, payload, now, false)
  return created
}

function applyRefreshPair(device, now) {
  device.pairToken = pairCode()
  device.pairTokenExpireAt = now + PAIR_TTL_MS
  device.onlineAt = now
  return device
}

function applyWake(device, now) {
  expireIfNeeded(device, now)
  device.lastWakeAt = now
  device.onlineAt = now
  if (device.status === 'unlocked' && (device.unlockUntil || 0) > now) {
    return { device, notify: false, reason: 'still_unlocked' }
  }
  closeWatchSession(device, now)
  if (device.status === 'unbound') {
    return { device, notify: false, reason: 'unbound' }
  }
  device.status = 'pending'
  device.unlockUntil = 0
  const notify = now - (device.lastNotifyAt || 0) >= WAKE_NOTIFY_DEBOUNCE_MS
  if (notify) device.lastNotifyAt = now
  return { device, notify, reason: notify ? 'pending' : 'debounced' }
}

function applyRequestUnlock(device, now) {
  expireIfNeeded(device, now)
  device.lastWakeAt = now
  device.onlineAt = now
  if (device.status === 'unlocked' && (device.unlockUntil || 0) > now) {
    return { device, notify: false, reason: 'still_unlocked' }
  }
  closeWatchSession(device, now)
  if (device.status === 'unbound') {
    return { device, notify: false, reason: 'unbound' }
  }
  device.status = 'pending'
  device.unlockUntil = 0
  device.lastRequestNotifyAt = now
  return { device, notify: true, reason: 'requested' }
}

function applyApprove(device, durationMin, now) {
  expireIfNeeded(device, now)
  const minutes = normalizeDurationMin(durationMin)
  if (device.watchSessionStart) closeWatchSession(device, now)
  device.status = 'unlocked'
  device.unlockUntil = now + minutes * 60 * 1000
  device.onlineAt = now
  startWatchSession(device, now)
  return { device, minutes }
}

function applyReject(device, now) {
  expireIfNeeded(device, now)
  closeWatchSession(device, now)
  device.status = 'locked'
  device.unlockUntil = 0
  device.onlineAt = now
  return device
}

function applyLock(device, now) {
  expireIfNeeded(device, now)
  closeWatchSession(device, now)
  device.status = device.boundCount > 0 || device.status !== 'unbound' ? 'locked' : 'unbound'
  if (device.boundCount > 0) device.status = 'locked'
  device.unlockUntil = 0
  device.onlineAt = now
  return device
}

function applyRemoteLock(device, now) {
  applyLock(device, now)
  return applyCommand(device, 'sleep', now)
}

function applyBind(device, now) {
  if (!device.pairToken || now > (device.pairTokenExpireAt || 0)) {
    return { error: 'PAIR_EXPIRED', message: '配对码已过期，请在设备上刷新二维码' }
  }
  device.boundCount = (device.boundCount || 0) + 1
  device.pairToken = ''
  device.pairTokenExpireAt = 0
  if (device.status === 'unbound') device.status = 'locked'
  device.onlineAt = now
  return { device }
}

function applyUnbind(device, now) {
  device.boundCount = Math.max(0, (device.boundCount || 0) - 1)
  if (device.boundCount === 0) {
    expireIfNeeded(device, now)
    closeWatchSession(device, now)
    device.status = 'unbound'
    device.unlockUntil = 0
    applyRefreshPair(device, now)
  } else {
    device.onlineAt = now
  }
  return { device }
}

function applyCommand(device, command, now) {
  const cmd = String(command || '').trim()
  if (!ALLOWED_COMMANDS.has(cmd)) {
    return { error: 'BAD_COMMAND', message: '未知指令' }
  }
  device.pendingCommand = cmd
  device.pendingCommandAt = now
  device.onlineAt = now
  return { device }
}

function clearCommand(device) {
  device.pendingCommand = ''
  device.pendingCommandAt = 0
  return device
}

function effectiveCommand(device, now) {
  const cmd = device.pendingCommand || ''
  if (!cmd) return ''
  if ((device.pendingCommandAt || 0) > 0 && now - device.pendingCommandAt > COMMAND_TTL_MS) {
    clearCommand(device)
    return ''
  }
  return cmd
}

function markScreenshot(device, now, error) {
  device.screenshotAt = now
  device.screenshotError = error ? String(error) : ''
  device.onlineAt = now
  return device
}

function assertDeviceAuth(device, secret) {
  return !!(device && secret && device.deviceSecret === secret)
}

module.exports = {
  PAIR_TTL_MS,
  WAKE_NOTIFY_DEBOUNCE_MS,
  REQUEST_NOTIFY_DEBOUNCE_MS,
  DEFAULT_PIN_DURATION_MIN,
  nowMs,
  randomToken,
  pairCode,
  clip,
  formatTime,
  shanghaiDate,
  publicDevice,
  expireIfNeeded,
  rollTodayWatch,
  todayWatchMinutes,
  applyHardware,
  normalizePin,
  normalizeDurationMin,
  applySetPin,
  applySetPinDuration,
  pinUnlockMinutes,
  applyRegister,
  applyRefreshPair,
  applyWake,
  applyRequestUnlock,
  applyApprove,
  applyReject,
  applyLock,
  applyRemoteLock,
  applyBind,
  applyUnbind,
  applyCommand,
  clearCommand,
  effectiveCommand,
  markScreenshot,
  assertDeviceAuth,
  COMMAND_TTL_MS,
}
