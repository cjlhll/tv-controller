const api = require('../../utils/api')
const env = require('../../env')

Page({
  data: {
    devices: [],
    empty: true,
  },
  onShow() {
    this.refresh()
  },
  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },
  refresh() {
    return api
      .call('myDevices')
      .then((res) => {
        const devices = (res.devices || []).map((d) => ({
          ...d,
          statusText: api.statusText(d),
        }))
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
      complete: () => {
        wx.showToast({ title: '已处理订阅', icon: 'none' })
      },
    })
  },
})
