const api = require('../../utils/api')
const env = require('../../env')

function localImageSrc(filePath) {
  if (!filePath) return filePath
  if (filePath.indexOf('http://usr') === 0) {
    return filePath.replace('http://usr', 'wxfile://usr')
  }
  return filePath
}

function saveShot(base64) {
  return new Promise((resolve, reject) => {
    const path = `${wx.env.USER_DATA_PATH}/device-shot-${Date.now()}.jpg`
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: base64,
      encoding: 'base64',
      success() {
        wx.getImageInfo({
          src: path,
          success(info) {
            resolve(localImageSrc(info.path || path))
          },
          fail() {
            resolve(localImageSrc(path))
          },
        })
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '保存截图失败'))
      },
    })
  })
}

function removeShot(filePath) {
  const clean = String(filePath || '').split('?')[0]
  if (!clean) return
  try {
    wx.getFileSystemManager().unlink({ filePath: clean, fail() {} })
  } catch (e) {}
}

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
    todayUnlockText: '0 分钟',
    todayWatchText: '0 分钟',
    shotPath: '',
    shotHint: '',
    shotLoading: false,
    pinDialog: false,
    newPin: '',
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
    const isUnlocked = statusKind === 'unlocked'
    this.setData({
      device: {
        ...device,
        formText: api.formText(device.form),
        shortId: api.shortId(device.deviceId),
      },
      statusKind,
      statusText: api.statusText(device, now, justApprovedMin),
      isUnlocked,
      todayUnlockText: api.todayWatchText(
        device.todayUnlockMin != null ? device.todayUnlockMin : device.todayWatchMin
      ),
      todayWatchText: api.todayWatchText(device.todayWatchMin),
      approveLabel: this.labelFor(this.data.selectedKey, this.data.customMin, isUnlocked),
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
    wx.hideKeyboard()
    this.setData({
      selectedKey: key,
      approveLabel: this.labelFor(key, this.data.customMin, this.data.isUnlocked),
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
  verbFor(isUnlocked) {
    return isUnlocked ? '改为' : '批准'
  },
  labelFor(key, customMin, isUnlocked) {
    const minutes = this.minutesFor(key, customMin)
    const verb = this.verbFor(isUnlocked)
    const preset = PRESETS.find((p) => p.key === key)
    if (preset) return `${verb} ${preset.label}`
    if (!minutes || minutes < 1) return `${verb}自定义时长`
    return `${verb} ${minutes} 分钟`
  },
  doApprove(durationMin) {
    if (!durationMin || durationMin < 1) {
      wx.showToast({ title: '时长无效', icon: 'none' })
      return
    }
    wx.showLoading({ title: this.data.isUnlocked ? '设置中' : '批准中' })
    api
      .call('approve', { deviceId: this.data.deviceId, durationMin })
      .then((res) => {
        wx.hideLoading()
        wx.showToast({
          title: `已${this.verbFor(this.data.isUnlocked)} ${durationMin} 分钟`,
        })
        this.applyDevice(res.device, res.now, res.minutes || durationMin)
        if (env.subscribeTemplateId && !env.subscribeTemplateId.startsWith('YOUR_')) {
          wx.requestSubscribeMessage({ tmplIds: [env.subscribeTemplateId] })
        }
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message, icon: 'none' })
      })
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
  lockDevice() {
    wx.showLoading({ title: '下发中' })
    api
      .call('remoteLock', { deviceId: this.data.deviceId })
      .then((body) => {
        wx.hideLoading()
        wx.showToast({ title: '已让设备休眠' })
        this.applyDevice(body.device, body.now)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },
  openPinDialog() {
    this.setData({
      pinDialog: true,
      newPin: (this.data.device && this.data.device.pin) || '',
    })
  },
  closePinDialog() {
    wx.hideKeyboard({ fail() {} })
    this.setData({ pinDialog: false, newPin: '' })
  },
  keepPinDialog() {},
  onNewPin(e) {
    this.setData({ newPin: e.detail.value })
  },
  savePin() {
    const pin = String(this.data.newPin || '').trim()
    if (!/^\d{4,6}$/.test(pin)) {
      wx.showToast({ title: 'PIN 须为 4–6 位数字', icon: 'none' })
      return
    }
    wx.hideKeyboard({ fail() {} })
    wx.showLoading({ title: '保存中' })
    api
      .call('setPin', { deviceId: this.data.deviceId, pin })
      .then((res) => {
        wx.hideLoading()
        wx.showToast({ title: 'PIN 已更新' })
        this.setData({ pinDialog: false, newPin: '' })
        this.applyDevice(res.device, res.now)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },
  takeScreenshot() {
    if (this.data.shotLoading) return
    const prev = (this.data.device && this.data.device.screenshotAt) || 0
    this.setData({ shotLoading: true, shotHint: '等待设备回传…' })
    api
      .call('requestScreenshot', { deviceId: this.data.deviceId })
      .then((res) => {
        if (res.image) return this.showShot(res.image, res.screenshotAt)
        this.waitForShot(prev, 0)
      })
      .catch((err) => {
        this.setData({ shotLoading: false, shotHint: err.message || '申请失败' })
      })
  },
  showShot(image, screenshotAt) {
    const prevPath = this.data.shotPath
    return saveShot(image).then((path) => {
      if (prevPath) removeShot(prevPath)
      this.setData({ shotPath: '', shotLoading: false, shotHint: '长按图片可保存' }, () => {
        this.setData({
          shotPath: path,
          device: Object.assign({}, this.data.device, { screenshotAt: screenshotAt || Date.now() }),
        })
      })
    })
  },
  onShotError() {
    this.setData({ shotHint: '截图已收到，预览失败，请再点一次获取截图' })
  },
  waitForShot(prevAt, attempt) {
    if (attempt > 20) {
      this.setData({ shotLoading: false, shotHint: '超时，请确认设备在线后重试' })
      return
    }
    setTimeout(() => {
      api
        .call('getScreenshot', { deviceId: this.data.deviceId })
        .then((res) => {
          if ((res.screenshotAt || 0) > prevAt && res.screenshotError) {
            this.setData({
              shotLoading: false,
              shotHint: res.screenshotError,
              device: Object.assign({}, this.data.device, { screenshotAt: res.screenshotAt }),
            })
            return
          }
          if ((res.screenshotAt || 0) > prevAt && res.image) {
            return this.showShot(res.image, res.screenshotAt)
          }
          this.waitForShot(prevAt, attempt + 1)
        })
        .catch((err) => {
          this.setData({ shotLoading: false, shotHint: err.message || '获取失败' })
        })
    }, 400)
  },
})
