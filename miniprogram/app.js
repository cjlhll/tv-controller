const LOCAL_API = 'http://127.0.0.1:8787/api'

App({
  onLaunch() {
    // 测试号没有云环境。无论旧代码是否还在调 cloud.callFunction，都改走本机 API。
    if (wx.cloud && wx.cloud.callFunction) {
      wx.cloud.callFunction = function (opts) {
        const payload = Object.assign({ openid: 'mp-dev' }, (opts && opts.data) || {})
        return new Promise(function (resolve, reject) {
          wx.request({
            url: LOCAL_API,
            method: 'POST',
            header: { 'content-type': 'application/json' },
            data: payload,
            success(res) {
              resolve({ result: res.data, errMsg: 'cloud.callFunction:ok' })
            },
            fail: reject,
          })
        })
      }
    }
  },
})
