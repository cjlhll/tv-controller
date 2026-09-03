const api = require('../../utils/api')
const env = require('../../env')

const ACTION_RPX = 160
const GAP_RPX = 20

function actionWidthPx() {
  return Math.round((wx.getSystemInfoSync().windowWidth / 750) * (ACTION_RPX + GAP_RPX))
}

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
  },
  onShow() {
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
            todayUnlockText: api.todayWatchText(
              d.todayUnlockMin != null ? d.todayUnlockMin : d.todayWatchMin
            ),
            todayWatchText: api.todayWatchText(d.todayWatchMin),
            offset: 0,
            swiping: false,
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
    if (this._ignoreTap) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.devices[index]
    if (item && item.offset) {
      this.setData({ [`devices[${index}].offset`]: 0, [`devices[${index}].swiping`]: false })
      return
    }
    const id = e.currentTarget.dataset.id
    this.ensureSubscribe()
    wx.navigateTo({ url: `/pages/approve/approve?deviceId=${id}` })
  },
  goLogs(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/logs/logs?deviceId=${id}` })
  },
  onSettings(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/settings/settings?deviceId=${id}`,
      success: () => {
        setTimeout(() => this.resetSwipesInstant(), 380)
      },
    })
  },
  onSwipeStart(e) {
    if (!this._actionW) this._actionW = actionWidthPx()
    const touch = e.touches[0]
    const index = Number(e.currentTarget.dataset.index)
    this._swipe = {
      index,
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: (this.data.devices[index] && this.data.devices[index].offset) || 0,
      axis: '',
    }
    this._ignoreTap = false
    this.closeOtherSwipes(index)
  },
  onSwipeMove(e) {
    const s = this._swipe
    if (!s) return
    const touch = e.touches[0]
    const dx = touch.clientX - s.startX
    const dy = touch.clientY - s.startY
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
    }
    if (s.axis !== 'h') return
    let offset = s.startOffset + dx
    if (offset > this._actionW) offset = this._actionW
    if (offset < -this._actionW) offset = -this._actionW
    this._ignoreTap = true
    this.setData({
      [`devices[${s.index}].offset`]: offset,
      [`devices[${s.index}].swiping`]: true,
    })
  },
  onSwipeEnd() {
    const s = this._swipe
    this._swipe = null
    if (!s || s.axis !== 'h') return
    const item = this.data.devices[s.index]
    const offset = item && item.offset ? item.offset : 0
    let snap = 0
    if (offset > this._actionW / 2) snap = this._actionW
    else if (offset < -this._actionW / 2) snap = -this._actionW
    this.setData({
      [`devices[${s.index}].offset`]: snap,
      [`devices[${s.index}].swiping`]: false,
    })
  },
  closeOtherSwipes(exceptIndex) {
    const patch = {}
    this.data.devices.forEach((d, i) => {
      if (i !== exceptIndex && d.offset) {
        patch[`devices[${i}].offset`] = 0
        patch[`devices[${i}].swiping`] = false
      }
    })
    if (Object.keys(patch).length) this.setData(patch)
  },
  resetSwipesInstant() {
    const patch = {}
    this.data.devices.forEach((d, i) => {
      if (!d.offset) return
      patch[`devices[${i}].swiping`] = true
      patch[`devices[${i}].offset`] = 0
    })
    if (Object.keys(patch).length) this.setData(patch)
  },
  onUnbind(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该设备'
    wx.showModal({
      title: '解绑设备',
      content: `解绑「${name}」后将无法再控制它，需要重新扫码绑定。`,
      confirmText: '解绑',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '解绑中' })
        api
          .call('unbind', { deviceId: id })
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已解绑' })
            this.refresh()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: err.message, icon: 'none' })
          })
      },
    })
  },
  ensureSubscribe() {
    if (!env.subscribeTemplateId || env.subscribeTemplateId.startsWith('YOUR_')) return
    wx.requestSubscribeMessage({ tmplIds: [env.subscribeTemplateId] })
  },
})
