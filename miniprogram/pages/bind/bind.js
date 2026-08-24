const api = require('../../utils/api')

Page({
  data: {
    token: '',
  },
  onToken(e) {
    this.setData({ token: (e.detail.value || '').toUpperCase() })
  },
  scan() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        let token = res.result || ''
        try {
          const obj = JSON.parse(res.result)
          token = obj.pairToken || obj.token || token
        } catch (e) {
          token = String(res.result || '').trim()
        }
        this.setData({ token: String(token).toUpperCase() })
        this.bind()
      },
    })
  },
  bind() {
    const pairToken = this.data.token.trim()
    if (!pairToken) {
      wx.showToast({ title: '请输入配对码', icon: 'none' })
      return
    }
    wx.showLoading({ title: '绑定中' })
    api
      .call('bind', { pairToken })
      .then((res) => {
        wx.hideLoading()
        wx.showToast({ title: res.already ? '已绑定过' : '绑定成功' })
        setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) }), 400)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '绑定失败', icon: 'none' })
      })
  },
})
