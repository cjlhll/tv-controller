'use strict'

const https = require('https')
const logic = require('../../cloudfunctions/api/logic')

const DEFAULT_TEMPLATE_ID = 'fx5fNlSC6_wEfd9ub-bqwbOH9EC8MVIHPK29WSaU-oE'

let tokenCache = { token: '', expireAt: 0 }

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = body ? JSON.stringify(body) : ''
    const req = https.request(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
          } catch (err) {
            reject(err)
          }
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function isFakeOpenid(id) {
  return !id || id === 'local-parent' || id === 'mp-dev' || String(id).startsWith('local-')
}

function isConfigured() {
  const appid = process.env.WECHAT_APPID || ''
  const secret = process.env.WECHAT_SECRET || ''
  const templateId = process.env.SUBSCRIBE_TEMPLATE_ID || DEFAULT_TEMPLATE_ID
  return !!(appid && secret && templateId && !templateId.startsWith('YOUR_'))
}

async function code2Session(jsCode) {
  const appid = process.env.WECHAT_APPID || ''
  const secret = process.env.WECHAT_SECRET || ''
  if (!appid || !secret) {
    throw new Error('服务端未配置 WECHAT_APPID / WECHAT_SECRET')
  }
  const code = String(jsCode || '').trim()
  if (!code) throw new Error('缺少 code')
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${encodeURIComponent(appid)}` +
    `&secret=${encodeURIComponent(secret)}` +
    `&js_code=${encodeURIComponent(code)}` +
    '&grant_type=authorization_code'
  const data = await httpJson('GET', url)
  if (!data.openid) {
    throw new Error(data.errmsg || '微信登录失败')
  }
  return { openid: data.openid }
}

async function getAccessToken(appid, secret) {
  if (tokenCache.token && Date.now() < tokenCache.expireAt) return tokenCache.token
  const url =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential' +
    `&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`
  const data = await httpJson('GET', url)
  if (!data.access_token) {
    throw new Error(data.errmsg || '获取 access_token 失败')
  }
  tokenCache = {
    token: data.access_token,
    expireAt: Date.now() + Math.max(60, (data.expires_in || 7200) - 120) * 1000,
  }
  return tokenCache.token
}

function fieldsFor(kind, device, minutes) {
  const name = logic.clip(device.name || '设备', 20)
  if (kind === 'approve') {
    return {
      thing1: name,
      thing2: logic.clip(`已批准 ${minutes || 0} 分钟`, 20),
      thing3: '到期将自动回锁',
    }
  }
  if (kind === 'request') {
    return {
      thing1: name,
      thing2: '等待家长批准',
      thing3: '请打开小程序选择时长',
    }
  }
  return {
    thing1: name,
    thing2: '设备已打开',
    thing3: '请打开小程序批准解锁',
  }
}

async function notifyParents(device, bindings, fields) {
  const appid = process.env.WECHAT_APPID || ''
  const secret = process.env.WECHAT_SECRET || ''
  const templateId = process.env.SUBSCRIBE_TEMPLATE_ID || DEFAULT_TEMPLATE_ID
  if (!appid || !secret || !templateId || templateId.startsWith('YOUR_')) {
    return { skipped: true, reason: 'wechat_not_configured' }
  }

  const openids = [
    ...new Set(
      (bindings || [])
        .filter((b) => b.deviceId === device.deviceId)
        .map((b) => b.openid)
        .filter((id) => !isFakeOpenid(id))
    ),
  ]
  if (!openids.length) {
    return { skipped: true, reason: 'no_real_openid' }
  }

  const token = await getAccessToken(appid, secret)
  const page = `pages/approve/approve?deviceId=${encodeURIComponent(device.deviceId)}`
  const dataFields = fields || fieldsFor('request', device)
  const results = []
  for (const touser of openids) {
    try {
      const data = await httpJson(
        'POST',
        `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`,
        {
          touser,
          template_id: templateId,
          page,
          miniprogram_state: process.env.MINIPROGRAM_STATE || 'developer',
          lang: 'zh_CN',
          data: {
            thing1: { value: logic.clip(dataFields.thing1, 20) },
            thing2: { value: logic.clip(dataFields.thing2, 20) },
            thing3: { value: logic.clip(dataFields.thing3, 20) },
          },
        }
      )
      results.push({
        openid: touser,
        sent: data.errcode === 0,
        message: data.errmsg || '',
      })
    } catch (err) {
      results.push({ openid: touser, sent: false, message: err.message })
    }
  }
  return { skipped: false, results }
}

module.exports = { notifyParents, fieldsFor, isConfigured, code2Session, getAccessToken }
