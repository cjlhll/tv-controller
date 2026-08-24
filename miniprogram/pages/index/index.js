const api = require('../../utils/api')
const env = require('../../env')

function onlineText(onlineAt, now) {
  const origin = typeof now === 'number' && now > 0 ? now : Date.now()
  if (!onlineAt) return '尚未上线'
  const mins = Math.round((origin - onlineAt) / 60000)
  if (mins < 1) return '刚才在线'
  if (mins < 60) return mins + ' 分钟前在线'
  const hours = Math.round(mins / 60)
  if (hours < 24) return hours + ' 小时前在线'
  return Math.round(hours / 24) + ' 天前在线'
}

Page({
  data: {
    devices: [],
    empty: true,
    canSubscribe: false,
    fabOpen: false,
  },
  toggleFab() {
    this.setData({ fabOpen: !this.data.fabOpen })
  },
  closeFab() {
    this.setData({ fabOpen: false })
  },
  onShow() {
    this.setData({
      fabOpen: false,
      canSubscribe: !!(env.subscribeTemplateId && !env.subscribeTemplateId.startsWith('YOUR_')),
    })
    this.ensureSubscribe()
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
            onlineText: onlineText(d.onlineAt, res.now),
          }
        })
        this.setData({ devices, empty: devices.length === 0 })
      })
      .catch((err) => {
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },
  goBind() {
    this.closeFab()
    wx.navigateTo({ url: '/pages/bind/bind' })
  },
  goApprove(e) {
    const id = e.currentTarget.dataset.id
    this.ensureSubscribe()
    wx.navigateTo({ url: `/pages/approve/approve?deviceId=${id}` })
  },
  goLogs(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/logs/logs?deviceId=${id}` })
  },
  ensureSubscribe() {
    if (!env.subscribeTemplateId || env.subscribeTemplateId.startsWith('YOUR_')) return
    wx.requestSubscribeMessage({ tmplIds: [env.subscribeTemplateId] })
  },
  subscribe() {
    if (!env.subscribeTemplateId || env.subscribeTemplateId.startsWith('YOUR_')) {
      wx.showToast({ title: '请先在 env.js 填写模板 ID', icon: 'none' })
      return
    }
    this.closeFab()
    wx.requestSubscribeMessage({
      tmplIds: [env.subscribeTemplateId],
      complete() {
        wx.showToast({ title: '已处理订阅', icon: 'none' })
      },
    })
  },
})
