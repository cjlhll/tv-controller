const env = require('../env.js')
const LOCAL_API = env.localApiUrl
const LOCAL_OPENID = env.localOpenid || 'mp-dev'

function call(action, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: LOCAL_API,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: Object.assign({ action: action, openid: LOCAL_OPENID }, data || {}),
      success(res) {
        const body = res.data || {}
        if (!body.ok) {
          reject(new Error(body.message || '请求失败'))
          return
        }
        resolve(body)
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '连不上 API，请确认 http://op.caojian.shop:8787 可访问'))
      },
    })
  })
}

function remainMinutes(unlockUntil, now) {
  const origin = typeof now === 'number' && now > 0 ? now : Date.now()
  const ms = (unlockUntil || 0) - origin
  if (ms <= 0) return 0
  const rounded = Math.round(ms / 60000)
  return rounded > 0 ? rounded : 1
}

function remainText(unlockUntil, now) {
  const n = remainMinutes(unlockUntil, now)
  if (n <= 0) return ''
  return '剩余 ' + n + ' 分钟'
}

function statusKind(device, now) {
  if (!device) return 'unknown'
  const origin = typeof now === 'number' && now > 0 ? now : Date.now()
  if (device.status === 'unlocked' && device.unlockUntil > origin) return 'unlocked'
  if (device.status === 'pending') return 'pending'
  if (device.status === 'unbound') return 'unbound'
  return 'locked'
}

function statusText(device, now, justApprovedMin) {
  if (!device) return '未知'
  const kind = statusKind(device, now)
  if (kind === 'unlocked') {
    if (justApprovedMin > 0) return '剩余 ' + justApprovedMin + ' 分钟'
    return remainText(device.unlockUntil, now) || '使用中'
  }
  if (kind === 'pending') return '等待批准'
  if (kind === 'unbound') return '未绑定'
  return '已锁定'
}

function formText(form) {
  return form === 'tv' ? '电视' : '手机'
}

function shortId(deviceId) {
  const id = String(deviceId || '')
  return id.length <= 8 ? id : id.slice(-8)
}

module.exports = {
  call: call,
  remainMinutes: remainMinutes,
  remainText: remainText,
  statusKind: statusKind,
  statusText: statusText,
  formText: formText,
  shortId: shortId,
}
