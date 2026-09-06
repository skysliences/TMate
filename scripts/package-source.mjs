// Explicit source allowlist. Never package a whole checkout or local NAS state.
import { readdir, readFile, mkdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const topFiles = new Set(['README.md', 'package.json', 'package-lock.json', 'Dockerfile', 'compose.yaml', '.env.example', '.env.admin.example', '.gitignore', '.dockerignore', '.oxlintrc.json', '.oxfmtrc.json', '.oxfmtignore', 'capacitor.config.ts', 'mobile.config.json', 'tsconfig.json', 'vite.config.ts', 'vite.mobile.config.ts', 'postcss.config.mjs', 'components.json', 'next-env.d.ts']);
const topDirs = new Set(['.github', 'app', 'components', 'hooks', 'lib', 'public', 'mobile', 'server', 'scripts', 'docs', 'deploy', 'android', 'ios']);
const blockedParts = new Set(['node_modules', 'build', 'dist', 'outputs', 'work', 'backups', 'tls', 'map-cache', '.git', '.gradle', '.idea', '.build', '__pycache__', 'Pods', 'DerivedData', 'xcuserdata', 'capacitor-cordova-android-plugins', 'capacitor-cordova-ios-plugins']);
const privateLegacy = new Set(['deploy/fnos-deployment.md', 'deploy/bootstrap-fnos.py', 'deploy/configure-amap.py', 'deploy/compose.fnos.yaml', 'deploy/compose.fnos.https.yaml', 'deploy/nginx.https.conf']);
export function includeSource(path) {
  const parts = path.split('/');
  if (parts.some(part => blockedParts.has(part)) || privateLegacy.has(path)) return false;
  if (parts.length === 1) return topFiles.has(path);
  if (!topDirs.has(parts[0])) return false;
  const name = parts.at(-1);
  if (name.startsWith('.env') && path !== 'deploy/teslamate/.env.example') return false;
  if (/\.(?:pem|key|pfx|p12|jks|keystore|apk|aab|log|tsbuildinfo|pyc)$/i.test(name)) return false;
  if (['.DS_Store', 'local.properties', 'google-services.json', 'capacitor.config.json', 'capacitor.plugins.json'].includes(name)) return false;
  if (path.startsWith('android/app/src/main/assets/public/') || path.startsWith('ios/App/App/public/')) return false;
  if (path === 'ios/App/App/config.xml') return false;
  return true;
}
async function list(directory = '') {
  const found = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if ((!directory && topDirs.has(entry.name)) || (directory && !blockedParts.has(entry.name) && !path.startsWith('android/app/src/main/assets/public') && !path.startsWith('ios/App/App/public'))) found.push(...await list(path));
    } else if (includeSource(path)) found.push(path);
  }
  return found.sort((a, b) => a.localeCompare(b));
}
async function main() {
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const output = resolve(root, `outputs/TMate-${version}-source.zip`);
  // zip updates existing archives by default; refuse so old excluded files can
  // never survive from a previous run. Pick another release name or move it aside.
  try { await lstat(output); throw new Error('源码归档已存在，请先移到备份位置再重新打包'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = await list();
  for (const path of files) {
    const bytes = await readFile(resolve(root, path));
    if (/(?:^|\n)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n/.test(bytes.toString())) throw new Error(`拒绝打包疑似私钥：${path}`);
    if (/[\r\n]/.test(path)) throw new Error('文件名包含换行，拒绝打包');
  }
  await mkdir(resolve(root, 'outputs'), { recursive: true });
  await new Promise((done, fail) => {
    const child = spawn('zip', ['-q', '-X', output, '-@'], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', fail);
    child.on('close', code => code === 0 ? done() : fail(new Error('源码压缩失败')));
    child.stdin.end(files.join('\n') + '\n');
  });
  const bytes = await readFile(output);
  console.log(JSON.stringify({ file: basename(output), files: files.length, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
