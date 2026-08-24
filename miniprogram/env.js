module.exports = {
  // 接口测试号不能使用云开发。小程序和 APK 都走这个域名，不要再用 127.0.0.1 / 192.168.1.2。
  useLocalApi: true,
  localApiUrl: 'http://op.caojian.shop:8787/api',
  localOpenid: 'mp-dev',
  cloudEnv: 'YOUR_CLOUD_ENV_ID',
  subscribeTemplateId: 'YOUR_TEMPLATE_ID',
}
