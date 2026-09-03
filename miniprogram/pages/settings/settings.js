const api = require('../../utils/api')

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
    presets: PRESETS,
    selectedKey: '30',
    customMin: '30',
    saveLabel: '保存为 30 分钟',
  },
  onLoad(query) {
    this.setData({ deviceId: query.deviceId || '' })
    this.refresh()
  },
  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },
  refresh() {
    return api.call('myDevices').then((res) => {
      const device = (res.devices || []).find((d) => d.deviceId === this.data.deviceId)
      if (!device) {
        this.setData({ device: null })
        return
      }
      const min = device.pinDurationMin > 0 ? device.pinDurationMin : 30
      const preset = PRESETS.find((p) => p.minutes === min)
      const key = preset ? preset.key : 'custom'
      this.setData({
        device: {
          ...device,
          formText: api.formText(device.form),
          shortId: api.shortId(device.deviceId),
        },
        selectedKey: key,
        customMin: String(min),
        saveLabel: this.labelFor(key, String(min)),
      })
    })
  },
  selectPreset(e) {
    const key = e.currentTarget.dataset.key
    wx.hideKeyboard()
    this.setData({
      selectedKey: key,
      saveLabel: this.labelFor(key, this.data.customMin),
    })
  },
  onCustomFocus() {
    this.applyCustom(this.data.customMin)
  },
  onCustom(e) {
    this.applyCustom(e.detail.value)
  },
  applyCustom(customMin) {
    this.setData({
      customMin,
      selectedKey: 'custom',
      saveLabel: this.labelFor('custom', customMin),
    })
  },
  minutesFor(key, customMin) {
    const preset = PRESETS.find((p) => p.key === key)
    if (preset) return preset.minutes
    return Number(customMin)
  },
  labelFor(key, customMin) {
    const minutes = this.minutesFor(key, customMin)
    if (!minutes || minutes < 1) return '保存默认时长'
    return `保存为 ${api.todayWatchText(minutes)}`
  },
  save() {
    const durationMin = this.minutesFor(this.data.selectedKey, this.data.customMin)
    if (!durationMin || durationMin < 1) {
      wx.showToast({ title: '时长无效', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中' })
    api
      .call('setPinDuration', { deviceId: this.data.deviceId, durationMin })
      .then((res) => {
        wx.hideLoading()
        const min = (res.device && res.device.pinDurationMin) || durationMin
        wx.showToast({ title: `已设为 ${api.todayWatchText(min)}` })
        this.refresh()
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },
})
