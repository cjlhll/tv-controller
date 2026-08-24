const api = require('../../utils/api')
const env = require('../../env')

Page({
  data: {
    deviceId: '',
    device: null,
    statusText: '',
    customMin: '45',
  },
  onLoad(query) {
    this.setData({ deviceId: query.deviceId || '' })
    this.refresh()
  },
  refresh() {
    return api.call('myDevices').then((res) => {
      const device = (res.devices || []).find((d) => d.deviceId === this.data.deviceId)
      this.setData({
        device,
        statusText: api.statusText(device),
      })
    })
  },
  onCustom(e) {
    this.setData({ customMin: e.detail.value })
  },
  approve(e) {
    const minutes = Number(e.currentTarget.dataset.min)
    this.doApprove(minutes)
  },
  approveCustom() {
    this.doApprove(Number(this.data.customMin))
  },
  doApprove(durationMin) {
    if (!durationMin || durationMin < 1) {
      wx.showToast({ title: '时长无效', icon: 'none' })
      return
    }
    const run = () => {
      wx.showLoading({ title: '批准中' })
      api
        .call('approve', { deviceId: this.data.deviceId, durationMin })
        .then(() => {
          wx.hideLoading()
          wx.showToast({ title: `已批准 ${durationMin} 分钟` })
          this.refresh()
        })
        .catch((err) => {
          wx.hideLoading()
          wx.showToast({ title: err.message, icon: 'none' })
        })
    }
    if (env.subscribeTemplateId && !env.subscribeTemplateId.startsWith('YOUR_')) {
      wx.requestSubscribeMessage({
        tmplIds: [env.subscribeTemplateId],
        complete: run,
      })
    } else {
      run()
    }
  },
  reject() {
    wx.showLoading({ title: '处理中' })
    api
      .call('reject', { deviceId: this.data.deviceId })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已拒绝 / 已回锁' })
        this.refresh()
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },
})
