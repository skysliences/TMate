// Shared by startup and the offline configuration checker. Errors name fields,
// never values. No shell evaluation or frontend environment injection.
export function validateConfig(env) {
  const placeholder = value => /CHANGE_ME|REPLACE_WITH|YOUR_|填写|替换/i.test(value || '');
  if (!env.API_KEY || env.API_KEY.length < 32 || placeholder(env.API_KEY)) throw new Error('API_KEY 请填写至少 32 位随机密钥');
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL 请填写完整的 PostgreSQL 连接串'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.username || !database.password || database.pathname.length < 2 || placeholder(env.DATABASE_URL)) throw new Error('DATABASE_URL 必须使用已配置的只读账号、密码和数据库名');
  if (env.WEB_ORIGIN) {
    let origin;
    try { origin = new URL(env.WEB_ORIGIN); } catch { throw new Error('WEB_ORIGIN 格式无效'); }
    if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== env.WEB_ORIGIN || origin.username || origin.password) throw new Error('WEB_ORIGIN 必须是准确的 HTTP(S) origin，不包含尾斜线或路径');
  }
  if (env.AMAP_KEY && !/^[a-fA-F0-9]{32}$/.test(env.AMAP_KEY)) throw new Error('AMAP_KEY 请填写自己的高德 Web 服务 Key，或留空');
  if (env.MQTT_URL) {
    let mqtt;
    try { mqtt = new URL(env.MQTT_URL); } catch { throw new Error('MQTT_URL 格式无效'); }
    if (!['mqtt:', 'mqtts:'].includes(mqtt.protocol) || !mqtt.hostname || mqtt.username || mqtt.password) throw new Error('MQTT_URL 使用 mqtt(s)://主机:端口；认证信息填 MQTT_USERNAME / MQTT_PASSWORD');
  }
  for (const key of ['PORT', 'TMATE_HTTP_PORT', 'TMATE_HTTPS_PORT']) {
    if (env[key] && (!/^\d+$/.test(env[key]) || Number(env[key]) < 1 || Number(env[key]) > 65535)) throw new Error(`${key} 必须是有效端口`);
  }
  for (const item of (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)) {
    if (['capacitor://localhost', 'https://localhost'].includes(item)) continue;
    let url;
    try { url = new URL(item); } catch { throw new Error('ALLOWED_ORIGINS 格式无效'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== item || item.includes('*')) throw new Error('ALLOWED_ORIGINS 必须精确匹配，无通配符或尾斜线');
  }
  return true;
}
