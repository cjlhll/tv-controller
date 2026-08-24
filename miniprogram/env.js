module.exports = {
  // 接口测试号不能使用云开发。联调先走本机 API，正式 AppID 开通云开发后再改 false。
  useLocalApi: true,
  localApiUrl: 'http://127.0.0.1:8787/api',
  localOpenid: 'mp-dev',
  cloudEnv: 'YOUR_CLOUD_ENV_ID',
  subscribeTemplateId: 'YOUR_TEMPLATE_ID',
}
