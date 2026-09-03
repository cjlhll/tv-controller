#!/usr/bin/env node
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resRoot = path.resolve(__dirname, '../android/app/src/main/res');

const LOCK_PATH =
  'M54,28c-8.3,0 -15,6.7 -15,15v8h-6c-2.2,0 -4,1.8 -4,4v25c0,2.2 1.8,4 4,4h42c2.2,0 4,-1.8 4,-4V55c0,-2.2 -1.8,-4 -4,-4h-6v-8c0,-8.3 -6.7,-15 -15,-15zM54,36c3.9,0 7,3.1 7,7v8H47v-8c0,-3.9 3.1,-7 7,-7z';

const BG = '#2563EB';
const LOCK = '#FBBF24';

// 锁形几何中心偏下，上移 8dp 做视觉居中。
const LOCK_GROUP = `<g transform="translate(54 46) scale(1.15) translate(-53 -54)">
  <path fill="${LOCK}" d="${LOCK_PATH}"/>
</g>`;

function launcherSvg(size) {
  const rx = Math.round(size * 0.185);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">
  <rect width="108" height="108" rx="20" fill="${BG}"/>
  ${LOCK_GROUP}
</svg>`;
}

function bannerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" rx="12" fill="${BG}"/>
  <g transform="translate(160 82) scale(2.2) translate(-53 -54)">
    <path fill="${LOCK}" d="${LOCK_PATH}"/>
  </g>
</svg>`;
}

function notificationSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 108 108">
  <path fill="#FFFFFF" d="${LOCK_PATH}"/>
</svg>`;
}

async function writePng(svg, outPath, size) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const pipeline = size ? sharp(Buffer.from(svg)).resize(size, size) : sharp(Buffer.from(svg));
  await pipeline.png().toFile(outPath);
}

const densities = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

for (const [folder, size] of Object.entries(densities)) {
  const out = path.join(resRoot, folder, 'ic_launcher.png');
  await writePng(launcherSvg(size), out, size);
  await writePng(launcherSvg(size), path.join(resRoot, folder, 'ic_launcher_round.png'), size);
}

await writePng(bannerSvg(), path.join(resRoot, 'drawable-xhdpi', 'tv_banner.png'));
await writePng(notificationSvg(), path.join(resRoot, 'drawable-xhdpi', 'ic_lock_notification.png'), 96);

console.log('Icons generated under', resRoot);
