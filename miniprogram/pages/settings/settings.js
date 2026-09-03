const api = require('../../utils/api')

const LOCK_OWNER_CMDS = {
  shell: 'dpm set-device-owner com.cjlhll.tvlock/.lock.LockAdminReceiver',
  adb: 'adb shell dpm set-device-owner com.cjlhll.tvlock/.lock.LockAdminReceiver',
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
    presets: PRESETS,
    selectedKey: '30',
    customMin: '30',
    saveLabel: '保存为 30 分钟',
    allowUninstall: false,
    uninstallBusy: false,
    uninstallHint: '',
    lockOwnerCmdShell: LOCK_OWNER_CMDS.shell,
    lockOwnerCmdAdb: LOCK_OWNER_CMDS.adb,
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
      const allowUninstall = !!device.allowUninstall
      this.setData({
        device: {
          ...device,
          formText: api.formText(device.form),
          shortId: api.shortId(device.deviceId),
        },
        selectedKey: key,
        customMin: String(min),
        saveLabel: this.labelFor(key, String(min)),
        allowUninstall,
        uninstallHint: this.uninstallHint(device, allowUninstall),
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
  uninstallHint(device, allowUninstall) {
    if (!device || device.deviceOwner !== true && device.deviceOwner !== false) {
      return allowUninstall
        ? '已记下允许卸载。等设备上线后确认能否生效。'
        : '已记下禁止卸载。等设备上线后确认系统能不能执行。'
    }
    if (device.deviceOwner !== true) {
      return allowUninstall
        ? '已记下允许卸载。此设备还不是 Device Owner，系统无法禁止卸载。'
        : '已记下禁止卸载。此设备还不是 Device Owner，需要先设 Owner 才能真正禁止。'
    }
    return allowUninstall
      ? '打开后电视需 TV Lock 在线轮询一次才会解除 Owner，系统卸载才会成功。若图标已隐藏，请重启电视或 atvtools 执行 am start -n com.cjlhll.tvlock/.ui.LockActivity。'
      : '仅禁止卸载本应用，不影响其它应用。'
  },
  onAllowUninstall(e) {
    const allow = !!(e.detail && e.detail.value)
    if (allow === this.data.allowUninstall) return
    if (allow) {
      wx.showModal({
        title: '允许卸载？',
        content: '打开后设备会解除 Device Owner，系统卸载才会出现「要卸载此应用吗？」。应用不能自己再设回 Owner；关掉开关若要再禁止，需要电脑 adb 重新设置。',
        success: (res) => {
          if (res.confirm) this.saveAllowUninstall(true)
          else this.setData({ allowUninstall: false })
        },
      })
      return
    }
    this.saveAllowUninstall(false)
  },
  copyLockOwnerCmd(e) {
    const kind = (e.currentTarget.dataset.kind || 'shell')
    const text = LOCK_OWNER_CMDS[kind] || LOCK_OWNER_CMDS.shell
    const toast = kind === 'adb' ? '已复制电脑 adb 命令' : '已复制电视 shell 命令'
    wx.setClipboardData({
      data: text,
      success() {
        wx.hideToast()
        wx.showToast({ title: toast })
      },
      fail() {
        wx.showToast({ title: '复制失败', icon: 'none' })
      },
    })
  },
  saveAllowUninstall(allowUninstall) {
    if (this.data.uninstallBusy) return
    this.setData({ uninstallBusy: true, allowUninstall })
    api
      .call('setAllowUninstall', { deviceId: this.data.deviceId, allowUninstall })
      .then((res) => {
        const device = (res && res.device) || this.data.device
        const next = !!(res && res.allowUninstall)
        this.setData({
          uninstallBusy: false,
          allowUninstall: next,
          device: device
            ? {
                ...this.data.device,
                ...device,
                formText: api.formText(device.form),
                shortId: api.shortId(device.deviceId),
              }
            : this.data.device,
          uninstallHint: this.uninstallHint(device || this.data.device, next),
        })
        wx.showToast({ title: next ? '已允许卸载' : '已禁止卸载' })
      })
      .catch((err) => {
        this.setData({
          uninstallBusy: false,
          allowUninstall: !allowUninstall,
        })
        wx.showToast({ title: err.message, icon: 'none' })
      })
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
