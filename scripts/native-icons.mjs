// Rasterize the shared vector app mark for the native launchers. No remote assets.
import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const master = await readFile(join(root, 'public/icon.svg'), 'utf8');
// Native launchers supply their own mask; iOS needs an opaque square asset.
const svg = (size) => Buffer.from(master
  .replace('width="128" height="128"', `width="${size}" height="${size}"`)
  .replace(/rx="\d+"/g, 'rx="0"'));
const foreground = await readFile(join(root, 'public/tmate-mark.svg'));
for (const [density, size] of Object.entries({
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
})) {
  const dir = join(root, `android/app/src/main/res/mipmap-${density}`);
  for (const file of ['ic_launcher.png', 'ic_launcher_round.png'])
    await sharp(svg(size)).png().toFile(join(dir, file));
  await sharp(foreground)
    .resize(Math.round(size * 2.25))
    .png()
    .toFile(join(dir, 'ic_launcher_foreground.png'));
}
await sharp(svg(1024))
  .png()
  .toFile(
    join(
      root,
      'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    ),
  );
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      ),
    )
  ).flat();
}
const paths = [
  ...(await files(join(root, 'android/app/src/main/res'))),
  ...(await files(join(root, 'ios/App/App/Assets.xcassets/Splash.imageset'))),
];
for (const path of paths.filter((p) => /splash[^/]*\.png$/.test(p))) {
  const { width, height } = await sharp(path).metadata();
  const iconSize = Math.round(Math.min(width, height) * 0.15);
  const icon = await sharp(svg(iconSize)).png().toBuffer();
  await sharp({ create: { width, height, channels: 3, background: '#eef3fa' } })
    .composite([{ input: icon, gravity: 'centre' }])
    .png()
    .toFile(path);
}
console.log('Generated TMate iOS and Android launcher and splash assets.');
