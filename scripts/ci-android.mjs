// CI never generates a throwaway release key. Missing signing means a clearly
// named DEBUG APK; partial configuration fails instead of silently downgrading.
import { mkdtemp, writeFile, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
const keys = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_STORE_PASSWORD', 'ANDROID_KEY_PASSWORD', 'ANDROID_KEY_ALIAS'];
const supplied = keys.filter(key => process.env[key]);
if (supplied.length && supplied.length !== keys.length) throw new Error('All four Android signing secrets must be configured together');
const signed = supplied.length === keys.length;
const temporary = await mkdtemp(join(tmpdir(), 'tmate-ci-signing-'));
const env = { ...process.env };
const run = (command, args, cwd) => new Promise((done, fail) => {
  const child = spawn(command, args, { env, cwd, stdio: 'inherit' });
  child.on('error', fail);
  child.on('close', code => code === 0 ? done() : fail(new Error(`Android command failed (${code})`)));
});
try {
  if (signed) {
    env.VOLTLOG_KEYSTORE = join(temporary, 'release.keystore');
    await writeFile(env.VOLTLOG_KEYSTORE, Buffer.from(env.ANDROID_KEYSTORE_BASE64, 'base64'), { mode: 0o600 });
    env.VOLTLOG_STORE_PASSWORD = env.ANDROID_STORE_PASSWORD;
    env.VOLTLOG_KEY_PASSWORD = env.ANDROID_KEY_PASSWORD;
    env.VOLTLOG_KEY_ALIAS = env.ANDROID_KEY_ALIAS;
  }
  // Do not pass the base64 secret to Gradle or include it in any artifact.
  delete env.ANDROID_KEYSTORE_BASE64;
  await run('./gradlew', ['--no-daemon', '--console=plain', '--max-workers=4', signed ? 'assembleRelease' : 'assembleDebug', signed ? 'lintRelease' : 'lintDebug'], resolve('android'));
  const variant = signed ? 'release' : 'debug';
  const apk = resolve(`android/app/build/outputs/apk/${variant}/app-${variant}.apk`);
  await run(join(env.ANDROID_HOME, 'build-tools/36.0.0/apksigner'), ['verify', '--verbose', apk], process.cwd());
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  await mkdir('outputs', { recursive: true });
  await copyFile(apk, `outputs/TMate-${version}-${signed ? 'android' : 'DEBUG'}.apk`);
  console.log(signed ? 'Signed release APK ready' : 'DEBUG APK only: configure signing secrets for a production release');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
