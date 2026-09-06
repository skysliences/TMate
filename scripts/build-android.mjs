// Project-local toolchain and private signing material; never embed service keys.
import {
  access,
  chmod,
  mkdir,
  readFile,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const tools = join(root, 'work/android-toolchain');
const signing = join(root, 'work/android-signing');
const secretsFile = join(signing, 'signing.json');
const store = join(signing, 'voltlog-release.keystore');
const jdk = process.env.TMATE_JAVA_HOME || process.env.VOLTLOG_JAVA_HOME || process.env.JAVA_HOME || join(tools, 'jdk/Contents/Home');
const env = {
  ...process.env,
  JAVA_HOME: jdk,
  ANDROID_HOME: process.env.ANDROID_HOME || join(tools, 'sdk'),
  ANDROID_USER_HOME: join(tools, 'android-user'),
  GRADLE_USER_HOME: join(tools, 'gradle-cache'),
};
process.umask(0o077);
const exists = async (file) =>
  access(file).then(
    () => true,
    () => false,
  );
function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Android build command failed (${code})`)),
    );
  });
}
await access(join(jdk, 'bin/java'));
await access(join(env.ANDROID_HOME, 'platforms/android-36/android.jar'));
await mkdir(signing, { recursive: true, mode: 0o700 });
await chmod(signing, 0o700);
if (!(await exists(secretsFile))) {
  if (await exists(store))
    throw new Error(
      'Existing signing key has no password file; refusing to replace it',
    );
  await writeFile(
    secretsFile,
    JSON.stringify({ password: randomBytes(32).toString('hex') }),
    { flag: 'wx', mode: 0o600 },
  );
}
const { password } = JSON.parse(await readFile(secretsFile, 'utf8'));
if (typeof password !== 'string' || password.length < 32)
  throw new Error('Invalid signing configuration');
env.VOLTLOG_KEYSTORE = store;
env.VOLTLOG_STORE_PASSWORD = password;
env.VOLTLOG_KEY_PASSWORD = password;
if (!(await exists(store))) {
  await run(join(jdk, 'bin/keytool'), [
    '-genkeypair',
    '-keystore',
    store,
    '-storetype',
    'PKCS12',
    '-alias',
    'voltlog',
    '-keyalg',
    'RSA',
    '-keysize',
    '3072',
    '-validity',
    '10000',
    '-dname',
    'CN=TMate Local',
    '-storepass:env',
    'VOLTLOG_STORE_PASSWORD',
    '-keypass:env',
    'VOLTLOG_KEY_PASSWORD',
    '-noprompt',
  ]);
}
await chmod(store, 0o600);
await chmod(secretsFile, 0o600);
await run(
  './gradlew',
  [
    '--no-daemon',
    '--console=plain',
    '--max-workers=4',
    'assembleRelease',
    'lintRelease',
  ],
  join(root, 'android'),
);
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const filename = `TMate-${version}-android.apk`;
const output = join(root, 'outputs', filename);
await mkdir(join(root, 'outputs'), { recursive: true });
await copyFile(
  join(root, 'android/app/build/outputs/apk/release/app-release.apk'),
  output,
);
await run(join(env.ANDROID_HOME, 'build-tools/36.0.0/apksigner'), [
  'verify',
  '--verbose',
  '--print-certs',
  output,
]);
const bytes = await readFile(output);
await writeFile(
  `${output}.sha256`,
  `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`,
);
console.log(
  `APK ready: ${output} (${(bytes.length / 1048576).toFixed(1)} MiB)`,
);
console.log(
  'Keep work/android-signing private and backed up for future app updates.',
);
