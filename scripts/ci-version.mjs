import { readFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
for (const path of ['package-lock.json', 'server/package.json', 'server/package-lock.json']) {
  if (JSON.parse(await readFile(path, 'utf8')).version !== version) throw new Error(`${path}: version differs`);
}
const gradle = await readFile('android/app/build.gradle', 'utf8');
if (!gradle.includes(`versionName "${version}"`)) throw new Error('Android and package versions differ');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Release tag must match package.json version');
console.log(`TMate ${version}: version metadata verified`);
