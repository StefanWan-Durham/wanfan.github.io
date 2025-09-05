// Rasterize existing SVG blog covers into 1200x630 PNGs using sharp as a Puppeteer-free fallback.
// Usage: node scripts/rasterize-og.mjs

import fs from 'node:fs/promises';
import path from 'node:path';

// scripts/ -> project root
const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const assetsDir = path.join(root, 'assets', 'blog');

async function ensureDir(p){ await fs.mkdir(p, { recursive: true }); }

async function rasterizeOne(svgPath, pngPath){
  try {
    const sharp = (await import('sharp')).default;
    const input = await fs.readFile(svgPath);
    await ensureDir(path.dirname(pngPath));
    const image = sharp(input, { density: 300 });
    await image.resize(1200, 630, { fit: 'cover' }).png({ quality: 90 }).toFile(pngPath);
    console.log('Rasterized', path.relative(root, svgPath), '->', path.relative(root, pngPath));
  } catch (e) {
    console.warn('Skip rasterize (sharp not available?):', e?.message || e);
  }
}

async function main(){
  let names = [];
  try { names = await fs.readdir(assetsDir); } catch {}
  for (const name of names){
    if (!/\.svg$/i.test(name)) continue;
    const svgPath = path.join(assetsDir, name);
    const pngPath = svgPath.replace(/\.svg$/i, '.png');
    try {
      await fs.access(pngPath); // already exists
      continue;
    } catch {}
    await rasterizeOne(svgPath, pngPath);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
