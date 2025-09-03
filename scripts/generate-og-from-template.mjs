// Render OG PNGs from assets/og-template.svg using title/desc from Markdown front matter.
// Usage: node scripts/generate-og-from-template.mjs [slug]
// If slug omitted, generate for all posts under content/blog.

import fs from 'node:fs/promises';
import path from 'node:path';

// Resolve project root: scripts/ -> ..
const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const contentDir = path.join(root, 'content', 'blog');
const tplPath = path.join(root, 'assets', 'og-template.svg');

function escapeXml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function wrapSvgText(text, {x=80, y=270, maxWidth=1000, lineHeight=1.2}){
  // Naive word wrap at ~32 chars fallback for CJK: split by spaces, then by characters
  const safe = escapeXml(text);
  const words = /\s/.test(safe) ? safe.split(/\s+/) : safe.split('');
  const approxCharW = 20; // rough width at 56px for title; we'll shrink later in browser
  const charsPerLine = Math.max(8, Math.floor(maxWidth/approxCharW));
  const lines = [];
  let cur = '';
  for (const w of words){
    const candidate = cur ? cur + ' ' + w : w;
    if (candidate.length > charsPerLine && cur) { lines.push(cur); cur = w; }
    else { cur = candidate; }
  }
  if (cur) lines.push(cur);
  const tspans = lines.map((ln, i)=>`<tspan x="${x}" dy="${i===0?0:Math.round(56*lineHeight)}">${ln}</tspan>`).join('');
  return { tspans, lineCount: lines.length };
}

async function renderPngFromText(title, desc, outPng){
  const svg = await fs.readFile(tplPath, 'utf8');
  const titleWrap = wrapSvgText(title, { x: 80, y: 270, maxWidth: 1000, lineHeight: 1.18 });
  const descWrap = wrapSvgText(desc, { x: 80, y: 330 + (titleWrap.lineCount>1? (titleWrap.lineCount-1)*56*1.18 : 0), maxWidth: 1000, lineHeight: 1.25 });
  let filled = svg
    .replace(/<text id="og-title"[^>]*>[^<]*/i, (m)=> m.replace(/>[^<]*/, `>${''}`))
    .replace(/id="og-title" x="80" y="270" font-size="56" font-weight="700">/i, `id="og-title" x="80" y="270" font-size="56" font-weight="700">${titleWrap.tspans}`)
    .replace(/<text id="og-desc"[^>]*>[^<]*/i, (m)=> m.replace(/>[^<]*/, `>${''}`))
    .replace(/id="og-desc" x="80" y="330" font-size="28" opacity="0.95">/i, `id="og-desc" x="80" y="${330}" font-size="28" opacity="0.95">${descWrap.tspans}`);
  await fs.mkdir(path.dirname(outPng), { recursive: true });
  try {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(filled);
    await page.goto(dataUrl, { waitUntil: 'networkidle0' });
    // Shrink title font-size if overflowing horizontally
    await page.evaluate(() => {
      const el = document.getElementById('og-title');
      if (!el) return;
      const maxW = 1040;
      let size = parseFloat(el.getAttribute('font-size')||'56');
      const bbox = () => el.getBBox();
      while (bbox().width > maxW && size > 28) { size -= 2; el.setAttribute('font-size', String(size)); }
    });
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
