import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { validateConfig } from '../server/config.mjs';
try {
  const env = parseEnv(await readFile(process.argv[2] || '.env', 'utf8'));
  validateConfig(env);
  console.log('TMate 配置检查通过（离线格式检查，不代表数据库或高德已连通）。');
  if (!env.WEB_ORIGIN) console.log('提示：未填 WEB_ORIGIN，网页设备配对未开启。');
  if (!env.AMAP_KEY) console.log('提示：未填 AMAP_KEY，道路底图与高德中文地址未开启。');
} catch (error) {
  console.error(error.code ? '无法读取配置文件，请先复制模板并限制权限。' : error.message);
  process.exitCode = 1;
}
