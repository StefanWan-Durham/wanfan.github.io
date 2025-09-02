// Node script to generate OG images from the SVG template by injecting text and exporting PNG via headless Chromium (using Puppeteer if available) or fallback to writing modified SVG.
// Usage (with Node 18+):
//   node scripts/generate-og.mjs "Title" "Subtitle" out/og.png
// If Puppeteer is not installed, will output SVG instead of PNG.

import fs from 'node:fs/promises';
import path from 'node:path';

const [,, titleArg = 'Title', descArg = 'Subtitle', outPathArg = 'out/og.png'] = process.argv;
const root = path.resolve(new URL('..', import.meta.url).pathname);
const tplPath = path.join(root, 'assets', 'og-template.svg');

async function ensureDir(p) {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

const svg = await fs.readFile(tplPath, 'utf8');
const filled = svg
  .replace('id="og-title" x="80" y="270" font-size="56" font-weight="700">标题 Title', `id="og-title" x="80" y="270" font-size="56" font-weight="700">${titleArg}`)
  .replace('id="og-desc" x="80" y="330" font-size="28" opacity="0.95">副标题/摘要 Subtitle', `id="og-desc" x="80" y="330" font-size="28" opacity="0.95">${descArg}`);

await ensureDir(outPathArg);

let wrotePng = false;
try {
  const puppeteer = await import('puppeteer').catch(() => null);
  if (puppeteer && puppeteer.default) {
    const browser = await puppeteer.default.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(filled);
    await page.goto(dataUrl, { waitUntil: 'networkidle0' });
    await ensureDir(outPathArg);
    await page.screenshot({ path: outPathArg, type: 'png' });
    await browser.close();
    wrotePng = true;
    console.log('OG PNG generated at', outPathArg);
  }
} catch (e) {
  // ignore and fall back
}

if (!wrotePng) {
  const outSvg = outPathArg.replace(/\.png$/i, '.svg');
  await fs.writeFile(outSvg, filled, 'utf8');
  console.log('Puppeteer not available. Wrote SVG at', outSvg);
}
