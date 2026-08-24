const api = require('../../utils/api')

const ACTION = {
  register: '注册设备',
  bind: '绑定',
  wake: '打开 / 唤醒',
  approve: '批准解锁',
  reject: '拒绝',
  pin: '本机 PIN 解锁',
  lock: '回锁',
}

Page({
  data: {
    deviceId: '',
    logs: [],
  },
  onLoad(query) {
    this.setData({ deviceId: query.deviceId || '' })
    api
      .call('logs', { deviceId: query.deviceId })
      .then((res) => {
        const logs = (res.logs || []).map((l) => ({
          ...l,
          actionText: ACTION[l.action] || l.action,
          timeText: format(l.createdAt),
          extra: l.durationMin ? `${l.durationMin} 分钟` : l.detail || '',
        }))
        this.setData({ logs })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})

function format(ts) {
  const d = new Date(ts)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
