const api = require('../../utils/api')
const env = require('../../env')

const PRESETS = [
  { key: '15', label: '15 分钟', minutes: 15 },
  { key: '30', label: '30 分钟', minutes: 30 },
  { key: '60', label: '1 小时', minutes: 60 },
  { key: '120', label: '2 小时', minutes: 120 },
]

Page({
  data: {
    deviceId: '',
    device: null,
    statusText: '',
    statusKind: 'locked',
    isUnlocked: false,
    presets: PRESETS,
    selectedKey: '30',
    customMin: '45',
    approveLabel: '批准 30 分钟',
  },
  onLoad(query) {
    this.setData({ deviceId: query.deviceId || '' })
    this.refresh()
  },
  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },
  applyDevice(device, now, justApprovedMin) {
    if (!device) {
      this.setData({ device: null })
      return
    }
    const statusKind = api.statusKind(device, now)
    this.setData({
      device: {
        ...device,
        formText: api.formText(device.form),
        shortId: api.shortId(device.deviceId),
      },
      statusKind,
      statusText: api.statusText(device, now, justApprovedMin),
      isUnlocked: statusKind === 'unlocked',
      approveLabel: this.labelFor(this.data.selectedKey, this.data.customMin, statusKind === 'unlocked'),
    })
  },
  refresh() {
    return api.call('myDevices').then((res) => {
      const device = (res.devices || []).find((d) => d.deviceId === this.data.deviceId)
      this.applyDevice(device, res.now)
    })
  },
  selectPreset(e) {
    const key = e.currentTarget.dataset.key
    this.setData({
      selectedKey: key,
      approveLabel: this.labelFor(key, this.data.customMin, this.data.isUnlocked),
    })
  },
  onCustom(e) {
    const customMin = e.detail.value
    this.setData({
      customMin,
      selectedKey: 'custom',
      approveLabel: this.labelFor('custom', customMin, this.data.isUnlocked),
    })
  },
  approveSelected() {
    const minutes = this.minutesFor(this.data.selectedKey, this.data.customMin)
    this.doApprove(minutes)
  },
  minutesFor(key, customMin) {
    const preset = PRESETS.find((p) => p.key === key)
    if (preset) return preset.minutes
    return Number(customMin)
  },
  labelFor(key, customMin, isUnlocked) {
    const verb = isUnlocked ? '续时' : '批准'
    const preset = PRESETS.find((p) => p.key === key)
    if (preset) return `${verb} ${preset.label}`
    const n = Number(customMin)
    if (!n || n < 1) return `${verb}自定义时长`
    return `${verb} ${n} 分钟`
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
        .then((res) => {
          wx.hideLoading()
          wx.showToast({ title: `已批准 ${durationMin} 分钟` })
          this.applyDevice(res.device, res.now, res.minutes || durationMin)
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
      .then((res) => {
        wx.hideLoading()
        wx.showToast({ title: '已回锁' })
        this.applyDevice(res.device, res.now)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },
})
