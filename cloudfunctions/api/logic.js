'use strict'

const crypto = require('crypto')

const PAIR_TTL_MS = 10 * 60 * 1000
const WAKE_NOTIFY_DEBOUNCE_MS = 60 * 1000
const DEFAULT_PIN_DURATION_MIN = 30

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

function publicDevice(device) {
  if (!device) return null
  return {
    deviceId: device.deviceId,
    name: device.name,
    form: device.form,
    status: device.status,
    unlockUntil: device.unlockUntil || 0,
    boundCount: device.boundCount || 0,
    onlineAt: device.onlineAt || 0,
    lastWakeAt: device.lastWakeAt || 0,
  }
}

function expireIfNeeded(device, now) {
  if (!device) return device
  if (device.status === 'unlocked' && (device.unlockUntil || 0) > 0 && now >= device.unlockUntil) {
    device.status = 'locked'
    device.unlockUntil = 0
    device.expiredJustNow = true
  }
  return device
}

function applyRegister(existing, payload, now) {
  if (existing) {
    existing.name = payload.name || existing.name
    existing.form = payload.form || existing.form
    existing.onlineAt = now
    expireIfNeeded(existing, now)
    return existing
  }
  return {
    deviceId: randomToken(8),
    deviceSecret: randomToken(24),
    name: payload.name || '未命名设备',
    form: payload.form === 'tv' ? 'tv' : 'phone',
    status: 'unbound',
    unlockUntil: 0,
    pairToken: pairCode(),
    pairTokenExpireAt: now + PAIR_TTL_MS,
    pinHash: '',
    lastWakeAt: 0,
    lastNotifyAt: 0,
    onlineAt: now,
    boundCount: 0,
    createdAt: now,
  }
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
  if (device.status === 'unbound') {
    return { device, notify: false, reason: 'unbound' }
  }
  device.status = 'pending'
  device.unlockUntil = 0
  const notify = now - (device.lastNotifyAt || 0) >= WAKE_NOTIFY_DEBOUNCE_MS
  if (notify) device.lastNotifyAt = now
  return { device, notify, reason: notify ? 'pending' : 'debounced' }
}

function applyApprove(device, durationMin, now) {
  expireIfNeeded(device, now)
  const minutes = Math.max(1, Math.min(24 * 60, Number(durationMin) || 30))
  device.status = 'unlocked'
  device.unlockUntil = now + minutes * 60 * 1000
  device.onlineAt = now
  return { device, minutes }
}

function applyReject(device, now) {
  device.status = 'locked'
  device.unlockUntil = 0
  device.onlineAt = now
  return device
}

function applyLock(device, now) {
  device.status = device.boundCount > 0 || device.status !== 'unbound' ? 'locked' : 'unbound'
  if (device.boundCount > 0) device.status = 'locked'
  device.unlockUntil = 0
  device.onlineAt = now
  return device
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

function assertDeviceAuth(device, secret) {
  return !!(device && secret && device.deviceSecret === secret)
}

module.exports = {
  PAIR_TTL_MS,
  WAKE_NOTIFY_DEBOUNCE_MS,
  DEFAULT_PIN_DURATION_MIN,
  nowMs,
  randomToken,
  pairCode,
  clip,
  formatTime,
  publicDevice,
  expireIfNeeded,
  applyRegister,
  applyRefreshPair,
  applyWake,
  applyApprove,
  applyReject,
  applyLock,
  applyBind,
  assertDeviceAuth,
}
