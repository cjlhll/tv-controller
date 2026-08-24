const LOCAL_API = 'http://127.0.0.1:8787/api'
const LOCAL_OPENID = 'mp-dev'

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
        reject(new Error((err && err.errMsg) || '连不上本机 API，请先运行 node cloud/local-server/server.js'))
      },
    })
  })
}

function remainText(unlockUntil) {
  const ms = (unlockUntil || 0) - Date.now()
  if (ms <= 0) return ''
  return '剩余 ' + Math.ceil(ms / 60000) + ' 分钟'
}

function statusText(device) {
  if (!device) return '未知'
  if (device.status === 'unlocked' && device.unlockUntil > Date.now()) {
    return '使用中 · ' + remainText(device.unlockUntil)
  }
  if (device.status === 'pending') return '等待批准'
  if (device.status === 'unbound') return '未绑定'
  return '已锁定'
}

module.exports = {
  call: call,
  remainText: remainText,
  statusText: statusText,
}
