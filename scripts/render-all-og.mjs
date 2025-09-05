// Convert all assets/blog/*.svg into 1200x630 PNGs using Puppeteer
// Usage: node scripts/render-all-og.mjs

import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const dir = path.join(root, 'assets', 'blog');

async function svgFiles() {
  const names = await fs.readdir(dir).catch(() => []);
  return names.filter(n => n.toLowerCase().endsWith('.svg'));
}

async function renderOne(svgName) {
  const inPath = path.join(dir, svgName);
  const outPath = path.join(dir, svgName.replace(/\.svg$/i, '.png'));
  let svg;
  try { svg = await fs.readFile(inPath, 'utf8'); }
  catch { return; }
  let browser;
  try {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await page.goto(dataUrl, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: outPath, type: 'png' });
    console.log('Wrote PNG:', path.relative(root, outPath));
  } catch (e) {
    console.error('PNG render failed for', svgName, '-', e?.message || e);
  } finally {
    try { await browser?.close(); } catch {}
  }
}

async function main(){
  const files = await svgFiles();
  for (const f of files) { await renderOne(f); }
}

main().catch(e=>{ console.error(e); process.exit(1); });
