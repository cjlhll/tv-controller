const env = require('../env.js')
const API_URLS = uniqueUrls([
  env.localApiUrl,
  'https://armbian.caojian.shop/api',
  'https://armbian.caojian.shop:8787/api',
])

let cachedOpenid = ''
let workingUrl = API_URLS[0]

function uniqueUrls(list) {
  const out = []
  list.forEach((u) => {
    if (u && out.indexOf(u) < 0) out.push(u)
  })
  return out
}

function nextUrl(url) {
  const i = API_URLS.indexOf(url)
  return i >= 0 && i < API_URLS.length - 1 ? API_URLS[i + 1] : ''
}

function request(action, data, url) {
  const target = url || workingUrl
  return new Promise((resolve, reject) => {
    wx.request({
      url: target,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: Object.assign({ action: action }, data || {}),
      success(res) {
        const body = res.data || {}
        if (!body.ok) {
          reject(new Error(body.message || '请求失败'))
          return
        }
        workingUrl = target
        resolve(body)
      },
      fail(err) {
        const fallback = nextUrl(target)
        if (fallback) {
          request(action, data, fallback).then(resolve, reject)
          return
        }
        reject(new Error((err && err.errMsg) || '连不上 API。电脑请把 armbian.caojian.shop 指到 192.168.1.2，或关掉 VPN 后重试'))
      },
    })
  })
}

function getOpenid() {
  if (cachedOpenid) return Promise.resolve(cachedOpenid)
  try {
    const stored = wx.getStorageSync('openid')
    if (stored && stored !== 'mp-dev' && !String(stored).startsWith('local-')) {
      cachedOpenid = stored
      return Promise.resolve(cachedOpenid)
    }
  } catch (e) {
    // ignore storage errors and fall through to wx.login
  }
  return new Promise((resolve, reject) => {
    wx.login({
      success(loginRes) {
        if (!loginRes.code) {
          reject(new Error('wx.login 没有返回 code'))
          return
        }
        request('login', { code: loginRes.code })
          .then((body) => {
            if (!body.openid) {
              reject(new Error('登录失败'))
              return
            }
            cachedOpenid = body.openid
            try {
              wx.setStorageSync('openid', body.openid)
            } catch (e) {
              // ignore
            }
            resolve(cachedOpenid)
          })
          .catch(reject)
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || 'wx.login 失败'))
      },
    })
  })
}

function call(action, data) {
  return getOpenid().then((openid) => request(action, Object.assign({ openid }, data || {})))
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
  getOpenid: getOpenid,
  remainMinutes: remainMinutes,
  remainText: remainText,
  statusKind: statusKind,
  statusText: statusText,
  formText: formText,
  shortId: shortId,
}
