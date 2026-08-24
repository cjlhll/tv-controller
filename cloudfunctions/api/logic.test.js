'use strict'

const assert = require('assert')
const logic = require('./logic')

const now = 1_700_000_000_000
const device = logic.applyRegister(null, { name: '测试机', form: 'phone' }, now)
assert.ok(device.deviceId)
assert.equal(device.status, 'unbound')
assert.ok(device.pairToken)

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

const requested = logic.applyRequestUnlock(device, now + 20000)
assert.equal(requested.device.status, 'pending')
assert.equal(requested.notify, true)
assert.equal(requested.reason, 'requested')

const requestSoon = logic.applyRequestUnlock(device, now + 25000)
assert.equal(requestSoon.notify, false)
assert.equal(requestSoon.reason, 'debounced')

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

console.log('logic.test.js ok')
