const api = require('../../utils/api')
const env = require('../../env')

Page({
  data: {
    devices: [],
    empty: true,
    canSubscribe: false,
  },
  onShow() {
    this.setData({
      canSubscribe: !!(env.subscribeTemplateId && !env.subscribeTemplateId.startsWith('YOUR_')),
    })
    this.refresh()
  },
  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },
  refresh() {
    return api
      .call('myDevices')
      .then((res) => {
        const devices = (res.devices || []).map((d) => {
          const statusKind = api.statusKind(d, res.now)
          return {
            ...d,
            statusKind,
            statusText: api.statusText(d, res.now),
            formText: api.formText(d.form),
            shortId: api.shortId(d.deviceId),
            actionHint: statusKind === 'pending' ? '等待批准' : statusKind === 'unlocked' ? '点按可续时或回锁' : '点按批准解锁',
          }
        })
        this.setData({ devices, empty: devices.length === 0 })
      })
      .catch((err) => {
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },
  goBind() {
    wx.navigateTo({ url: '/pages/bind/bind' })
  },
  goApprove(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/approve/approve?deviceId=${id}` })
  },
  goLogs(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/logs/logs?deviceId=${id}` })
  },
  subscribe() {
    if (!env.subscribeTemplateId || env.subscribeTemplateId.startsWith('YOUR_')) {
      wx.showToast({ title: '请先在 env.js 填写模板 ID', icon: 'none' })
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [env.subscribeTemplateId],
      complete() {
        wx.showToast({ title: '已处理订阅', icon: 'none' })
      },
    })
  },
})
