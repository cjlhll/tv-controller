const api = require('./utils/api')
const env = require('./env.js')
const LOCAL_API = env.localApiUrl

App({
  onLaunch() {
    // 无论旧代码是否还在调 cloud.callFunction，都改走自建 API，并用真实 openid。
    if (wx.cloud && wx.cloud.callFunction) {
      wx.cloud.callFunction = function (opts) {
        return api.getOpenid().then(function (openid) {
          const payload = Object.assign({ openid: openid }, (opts && opts.data) || {})
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
        })
      }
    }
  },
})
