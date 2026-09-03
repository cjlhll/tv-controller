'use strict'

const assert = require('assert')
const logic = require('./logic')

const now = 1_700_000_000_000
const device = logic.applyRegister(null, {
  name: '测试机',
  form: 'phone',
  hw: { os: 'Android 12', model: 'M6 Note', screen: '1080×1920', ram: '4.0 GB', storage: '12 / 32 GB' },
}, now)
assert.ok(device.deviceId)
assert.equal(device.status, 'unbound')
assert.ok(device.pairToken)
assert.equal(device.hw.os, 'Android 12')
assert.equal(logic.publicDevice(device, now).hw.screen, '1080×1920')
logic.applyHardware(device, {})
assert.equal(device.hw.ram, '4.0 GB')
logic.applyHardware(device, { hw: { os: 'Android 14', ram: '8.0 GB', screen: '1080×2400', storage: '40 / 128 GB' } })
assert.equal(device.hw.os, 'Android 14')
assert.equal(device.hw.ram, '8.0 GB')
assert.equal(device.hw.model, '')
assert.equal(device.name, '测试机')

const tv = logic.applyRegister(null, {
  name: 'BRAVIA 4K VH2',
  form: 'tv',
  hw: { model: 'BRAVIA 4K VH2' },
}, now)
assert.equal(tv.name, 'BRAVIA 4K VH2')
logic.applyHardware(tv, { hw: { model: 'SONY XR-65X91J', os: 'Android 12' } })
assert.equal(tv.name, 'SONY XR-65X91J')
assert.equal(tv.hw.model, 'SONY XR-65X91J')
tv.name = '客厅电视'
logic.applyHardware(tv, { hw: { model: 'SONY XR-65X91K', os: 'Android 12' } })
assert.equal(tv.name, '客厅电视')

const bind = logic.applyBind(device, now)
assert.ok(!bind.error)
assert.equal(device.status, 'locked')
assert.equal(device.boundCount, 1)

const wake = logic.applyWake(device, now + 1000)
assert.equal(wake.device.status, 'pending')
assert.equal(wake.notify, true)

const wakeSoon = logic.applyWake(device, now + 2000)
assert.equal(wakeSoon.notify, false)
assert.equal(wakeSoon.reason, 'debounced')

const requested = logic.applyRequestUnlock(device, now + 2500)
assert.equal(requested.device.status, 'pending')
assert.equal(requested.notify, true)
assert.equal(requested.reason, 'requested')

const requestAgain = logic.applyRequestUnlock(device, now + 4000)
assert.equal(requestAgain.notify, true)
assert.equal(requestAgain.reason, 'requested')

const approved = logic.applyApprove(device, 15, now + 3000)
assert.equal(approved.device.status, 'unlocked')
assert.equal(approved.minutes, 15)
assert.equal(approved.device.unlockUntil, now + 3000 + 15 * 60 * 1000)

const stillOn = logic.applyWake(device, now + 4000)
assert.equal(stillOn.notify, false)
assert.equal(stillOn.reason, 'still_unlocked')

logic.expireIfNeeded(device, now + 3000 + 16 * 60 * 1000)
assert.equal(device.status, 'locked')

logic.applyReject(device, now + 4000)
assert.equal(device.status, 'locked')
assert.equal(device.unlockUntil, 0)

logic.applyRefreshPair(device, now + 5000)
const pub = logic.publicDevice(device, now + 5000)
assert.ok(pub.pairToken)
assert.ok(pub.pairTokenExpireAt > now + 5000)

const cmd = logic.applyCommand(device, 'screenshot', now + 6000)
assert.ok(!cmd.error)
assert.equal(logic.effectiveCommand(device, now + 6000), 'screenshot')
assert.equal(logic.publicDevice(device, now + 6000, { includeCommand: true }).pendingCommand, 'screenshot')
assert.equal(logic.publicDevice(device, now + 6000).pendingCommand, undefined)
logic.clearCommand(device)
assert.equal(logic.effectiveCommand(device, now + 6000), '')
logic.markScreenshot(device, now + 8000, '设备已待机，亮屏后再截')
assert.equal(device.screenshotError, '设备已待机，亮屏后再截')
assert.equal(logic.publicDevice(device, now + 8000).screenshotError, '设备已待机，亮屏后再截')
logic.markScreenshot(device, now + 9000)
assert.equal(device.screenshotError, '')
const sleep = logic.applyRemoteLock(device, now + 9500)
assert.ok(!sleep.error)
assert.equal(device.status, 'locked')
assert.equal(device.unlockUntil, 0)
assert.equal(logic.effectiveCommand(device, now + 9500), 'sleep')
logic.clearCommand(device)
const bad = logic.applyCommand(device, 'wipe', now + 7000)
assert.equal(bad.error, 'BAD_COMMAND')

assert.equal(logic.publicDevice(device, now).pin, '')
const badPin = logic.applySetPin(device, '12', now + 10000)
assert.equal(badPin.error, 'BAD_PIN')
const setPin = logic.applySetPin(device, '2468', now + 10000)
assert.ok(!setPin.error)
assert.equal(device.pin, '2468')
assert.equal(logic.publicDevice(device, now + 10000).pin, '2468')
const skipped = logic.applySetPin(device, '1357', now + 11000, { onlyIfEmpty: true })
assert.equal(skipped.skipped, true)
assert.equal(device.pin, '2468')
const fresh = logic.applyRegister(null, { name: 'PIN机', pin: '8888' }, now + 12000)
assert.equal(fresh.pin, '8888')
logic.applyRegister(fresh, { name: 'PIN机', pin: '9999' }, now + 13000)
assert.equal(fresh.pin, '8888')

const other = logic.applyRegister(null, { name: '解绑机' }, now + 20000)
logic.applyBind(other, now + 20000)
other.boundCount = 2
other.status = 'unlocked'
other.unlockUntil = now + 40000
logic.applyUnbind(other, now + 21000)
assert.equal(other.boundCount, 1)
assert.equal(other.status, 'unlocked')
assert.equal(other.unlockUntil, now + 40000)
logic.applyUnbind(other, now + 22000)
assert.equal(other.boundCount, 0)
assert.equal(other.status, 'unbound')
assert.equal(other.unlockUntil, 0)
assert.ok(other.pairToken)

const watch = logic.applyRegister(null, { name: '看时' }, now + 40000)
logic.applyBind(watch, now + 40000)
const t0 = now + 41000
logic.applyApprove(watch, 30, t0)
assert.equal(logic.todayWatchMinutes(watch, t0), 0)
assert.equal(logic.publicDevice(watch, t0 + 10 * 60 * 1000).todayWatchMin, 10)
logic.applyLock(watch, t0 + 10 * 60 * 1000)
assert.equal(watch.watchSessionStart, 0)
assert.equal(logic.todayWatchMinutes(watch, t0 + 20 * 60 * 1000), 10)

const watch2 = logic.applyRegister(null, { name: '改时' }, now + 50000)
logic.applyBind(watch2, now + 50000)
logic.applyApprove(watch2, 30, t0)
logic.applyApprove(watch2, 10, t0 + 5 * 60 * 1000)
assert.equal(logic.todayWatchMinutes(watch2, t0 + 5 * 60 * 1000), 5)
logic.applyLock(watch2, t0 + 15 * 60 * 1000)
assert.equal(logic.todayWatchMinutes(watch2, t0 + 20 * 60 * 1000), 15)

const watch3 = logic.applyRegister(null, { name: '到期' }, now + 60000)
logic.applyBind(watch3, now + 60000)
logic.applyApprove(watch3, 15, t0)
logic.expireIfNeeded(watch3, t0 + 15 * 60 * 1000)
assert.equal(watch3.status, 'locked')
assert.equal(logic.todayWatchMinutes(watch3, t0 + 16 * 60 * 1000), 15)

const midnight = Date.parse('2026-09-03T00:00:00+08:00')
const before = midnight - 5 * 60 * 1000
const after = midnight + 8 * 60 * 1000
const watch4 = logic.applyRegister(null, { name: '跨天' }, before)
logic.applyBind(watch4, before)
logic.applyApprove(watch4, 60, before)
logic.rollTodayWatch(watch4, after)
assert.equal(watch4.todayWatchDate, '2026-09-03')
assert.equal(watch4.todayWatchMs, 0)
assert.equal(watch4.watchSessionStart, midnight)
assert.equal(logic.todayWatchMinutes(watch4, after), 8)

assert.equal(logic.publicDevice(device, now).pinDurationMin, 30)
const pinDur = logic.applySetPinDuration(device, 45, now + 70000)
assert.equal(pinDur.minutes, 45)
assert.equal(device.pinDurationMin, 45)
assert.equal(logic.pinUnlockMinutes(device), 45)
assert.equal(logic.publicDevice(device, now + 70000).pinDurationMin, 45)
logic.applySetPinDuration(device, 0, now + 71000)
assert.equal(device.pinDurationMin, 30)

console.log('logic.test.js ok')
