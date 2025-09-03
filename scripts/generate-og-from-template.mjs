// Render OG PNGs from assets/og-template.svg using title/desc from Markdown front matter.
// Usage: node scripts/generate-og-from-template.mjs [slug]
// If slug omitted, generate for all posts under content/blog.

import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname, '..');
const contentDir = path.join(root, 'content', 'blog');
const tplPath = path.join(root, 'assets', 'og-template.svg');

async function renderPngFromText(title, desc, outPng){
  const svg = await fs.readFile(tplPath, 'utf8');
  const filled = svg
    .replace('id="og-title" x="80" y="270" font-size="56" font-weight="700">标题 Title', `id="og-title" x="80" y="270" font-size="56" font-weight="700">${title}`)
    .replace('id="og-desc" x="80" y="330" font-size="28" opacity="0.95">副标题/摘要 Subtitle', `id="og-desc" x="80" y="330" font-size="28" opacity="0.95">${desc}`);
  await fs.mkdir(path.dirname(outPng), { recursive: true });
  try {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(filled);
    await page.goto(dataUrl, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: outPng, type: 'png' });
    await browser.close();
    console.log('OG PNG generated at', outPng);
  } catch (e) {
    // Fallback: write SVG next to PNG path for visibility
    const outSvg = outPng.replace(/\.png$/i, '.svg');
    await fs.writeFile(outSvg, filled, 'utf8');
    console.log('Puppeteer not available. Wrote SVG at', outSvg);
  }
}

function parseFrontMatter(src){
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, src];
  const body = src.slice(m[0].length);
  const yaml = m[1];
  const meta = {};
  yaml.split(/\r?\n/).forEach(line => {
    const mm = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (mm) {
      const key = mm[1].trim();
      let val = mm[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  });
  return [meta, body];
}

async function processPost(dir){
  const slug = path.basename(dir);
  const langs = ['zh','en','es'];
  for (const lang of langs){
    const file = path.join(dir, `${lang}.md`);
    try{
      const raw = await fs.readFile(file, 'utf8');
      const [meta] = parseFrontMatter(raw);
      if (/^(true|1)$/i.test(String(meta.draft||'').trim())) { continue; }
      const title = meta.title || slug;
      const desc = meta.description || '';
      const outPng = path.join(root, 'assets', 'blog', `${slug}-${lang}.png`);
      await renderPngFromText(title, desc, outPng);
    } catch {}
  }
}

async function main(){
  const arg = process.argv[2];
  const posts = [];
  if (arg) posts.push(path.join(contentDir, arg));
  else {
    const names = await fs.readdir(contentDir).catch(()=>[]);
    for (const n of names){
      const p = path.join(contentDir, n);
      const st = await fs.stat(p).catch(()=>null);
      if (st?.isDirectory()) posts.push(p);
    }
  }
  for (const p of posts){ await processPost(p); }
}

main().catch(e=>{ console.error(e); process.exit(1); });
