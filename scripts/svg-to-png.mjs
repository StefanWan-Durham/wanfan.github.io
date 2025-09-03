// Convert an SVG file to a 1200x630 PNG using Puppeteer
// Usage: node scripts/svg-to-png.mjs input.svg output.png [width height]

import fs from 'node:fs/promises';
import path from 'node:path';

const [,, inArg, outArg, widthArg='1200', heightArg='630'] = process.argv;
if (!inArg || !outArg) {
  console.error('Usage: node scripts/svg-to-png.mjs input.svg output.png [width height]');
  process.exit(1);
}

const inPath = path.resolve(inArg);
const outPath = path.resolve(outArg);
const width = parseInt(widthArg, 10) || 1200;
const height = parseInt(heightArg, 10) || 630;

try {
  const svg = await fs.readFile(inPath, 'utf8');
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await page.goto(dataUrl, { waitUntil: 'networkidle0' });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  console.log('Wrote PNG:', outPath);
} catch (e) {
  console.error('Failed to render PNG:', e?.message || e);
  process.exit(2);
}
