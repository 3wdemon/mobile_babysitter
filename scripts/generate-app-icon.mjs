// @ts-nocheck
/**
 * Reproducible PLACEHOLDER app-icon generator (DMY-58) — NOT final brand.
 *
 * Renders assets/branding/app-icon.svg (brand-blue + white "MB" monogram +
 * "PLACEHOLDER" marker) into every size the native projects require:
 *   - iOS:     ios/MobileBabysitter/Images.xcassets/AppIcon.appiconset/*.png
 *              (filenames are also written into that set's Contents.json)
 *   - Android: android/app/src/main/res/mipmap-<density> ic_launcher.png and
 *              ic_launcher_round.png (the round variant is circle-masked).
 *
 * Run:  node scripts/generate-app-icon.mjs
 * Requires `sharp` (already present as a react-native-bootsplash dependency).
 * Re-run after editing assets/branding/app-icon.svg to refresh every density.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/branding/app-icon.svg');
const svg = readFileSync(SRC);

// iOS AppIcon entries: [size pt, scale] -> pixel size. Order/filenames must
// match the Contents.json `images` array written below.
const IOS_DIR = join(
  ROOT,
  'ios/MobileBabysitter/Images.xcassets/AppIcon.appiconset',
);
const iosImages = [
  { size: '20x20', scale: '2x', idiom: 'iphone', px: 40 },
  { size: '20x20', scale: '3x', idiom: 'iphone', px: 60 },
  { size: '29x29', scale: '2x', idiom: 'iphone', px: 58 },
  { size: '29x29', scale: '3x', idiom: 'iphone', px: 87 },
  { size: '40x40', scale: '2x', idiom: 'iphone', px: 80 },
  { size: '40x40', scale: '3x', idiom: 'iphone', px: 120 },
  { size: '60x60', scale: '2x', idiom: 'iphone', px: 120 },
  { size: '60x60', scale: '3x', idiom: 'iphone', px: 180 },
  { size: '1024x1024', scale: '1x', idiom: 'ios-marketing', px: 1024 },
];

// Android mipmap densities -> launcher icon edge in px.
const ANDROID_DENSITIES = [
  { dir: 'mipmap-mdpi', px: 48 },
  { dir: 'mipmap-hdpi', px: 72 },
  { dir: 'mipmap-xhdpi', px: 96 },
  { dir: 'mipmap-xxhdpi', px: 144 },
  { dir: 'mipmap-xxxhdpi', px: 192 },
];

async function renderSquare(px) {
  return sharp(svg, { density: 512 })
    .resize(px, px, { fit: 'contain' })
    .png()
    .toBuffer();
}

/** Apply a circular alpha mask for Android's adaptive round launcher icon. */
async function renderRound(px) {
  const square = await renderSquare(px);
  const r = px / 2;
  const mask = Buffer.from(
    `<svg width="${px}" height="${px}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`,
  );
  return sharp(square)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function main() {
  // iOS: write each PNG + rebuild Contents.json with explicit filenames.
  mkdirSync(IOS_DIR, { recursive: true });
  const contents = { images: [], info: { author: 'xcode', version: 1 } };
  for (const img of iosImages) {
    const filename = `AppIcon-${img.size}@${img.scale}.png`;
    writeFileSync(join(IOS_DIR, filename), await renderSquare(img.px));
    contents.images.push({
      filename,
      idiom: img.idiom,
      scale: img.scale,
      size: img.size,
    });
  }
  writeFileSync(
    join(IOS_DIR, 'Contents.json'),
    JSON.stringify(contents, null, 2) + '\n',
  );

  // Android: square + round launcher icon per density.
  for (const d of ANDROID_DENSITIES) {
    const dir = join(ROOT, 'android/app/src/main/res', d.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ic_launcher.png'), await renderSquare(d.px));
    writeFileSync(join(dir, 'ic_launcher_round.png'), await renderRound(d.px));
  }

  console.log('PLACEHOLDER app icons generated (iOS AppIcon + Android mipmap).');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
