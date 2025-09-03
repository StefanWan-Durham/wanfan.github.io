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

function wrapSvgText(text, {x=80, y=270, maxWidth=1000, lineHeight=1.2, fontSize=56, maxLines=0}){
  // Naive word wrap; for CJK (no spaces) fall back to per-char split
  const safe = escapeXml(text);
  const isCJK = !/\s/.test(safe);
  const tokens = isCJK ? safe.split('') : safe.split(/\s+/);
  // Use a conservative width estimate; CJK chars are wider per glyph
  const baseFactor = isCJK ? 0.9 : 0.6; // ~0.9em for CJK, ~0.6em for Latin
  const approxCharW = Math.max(10, Math.round(fontSize*baseFactor));
  // Slightly reduce usable width for margin safety
  const usable = Math.max(100, Math.floor(maxWidth*0.96));
  const charsPerLine = Math.max(8, Math.floor(usable/approxCharW));
  const out = [];
  let cur = '';
  for (const t of tokens){
    const candidate = cur ? (isCJK ? cur + t : cur + ' ' + t) : t;
    if (candidate.length > charsPerLine && cur) {
      out.push(cur);
      cur = t;
      if (maxLines && out.length >= maxLines) break;
    } else {
      cur = candidate;
    }
  }
  if (cur && (!maxLines || out.length < maxLines)) out.push(cur);
  if (maxLines && out.length > maxLines) out.length = maxLines;
  // If clamped, add ellipsis to the last line
  if (maxLines && out.length === maxLines) {
    const last = out[maxLines-1] || '';
    out[maxLines-1] = last.replace(/[\s\u2026]*$/, '') + '…';
  }
  const dy = Math.round(fontSize*lineHeight);
  const tspans = out.map((ln, i)=>`<tspan x="${x}" dy="${i===0?0:dy}">${ln}</tspan>`).join('');
  return { tspans, lineCount: out.length };
}

async function renderPngFromText(title, subline, outPng){
  const svg = await fs.readFile(tplPath, 'utf8');
  // Title: 56px, max 2 lines; we will also shrink in browser if still too wide
  const titleWrap = wrapSvgText(title, { x: 80, y: 270, maxWidth: 1000, lineHeight: 1.18, fontSize: 56, maxLines: 2 });
  // Description: 28px, clamp to 4 lines with ellipsis, and place below title block
  // Add extra top padding if title wrapped; slightly smaller width to avoid edge clipping
  const extraTop = titleWrap.lineCount>1 ? Math.round((titleWrap.lineCount-1)*56*1.18) : 0;
  const descY = 340 + extraTop; // a tad lower than 330 for breathing room
  const descWrap = wrapSvgText(subline, { x: 80, y: descY, maxWidth: 960, lineHeight: 1.22, fontSize: 28, maxLines: 4 });
  let filled = svg
    .replace(/<text id="og-title"[^>]*>[^<]*/i, (m)=> m.replace(/>[^<]*/, `>${''}`))
    .replace(/id="og-title" x="80" y="270" font-size="56" font-weight="700">/i, `id="og-title" x="80" y="270" font-size="56" font-weight="700">${titleWrap.tspans}`)
  .replace(/<text id="og-desc"[^>]*>[^<]*/i, (m)=> m.replace(/>[^<]*/, `>${''}`))
  .replace(/id="og-desc" x="80" y="330" font-size="28" opacity="0.95">/i, `id="og-desc" x="80" y="${descY}" font-size="28" opacity="0.95">${descWrap.tspans}`);
  await fs.mkdir(path.dirname(outPng), { recursive: true });
  // Always write updated SVG next to PNG so SVG references stay fresh
  const outSvg = outPng.replace(/\.png$/i, '.svg');
  await fs.writeFile(outSvg, filled, 'utf8');
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
  const subline = computeKeywords(slug, lang, meta);
      const outPng = path.join(root, 'assets', 'blog', `${slug}-${lang}.png`);
  await renderPngFromText(title, subline, outPng);
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

// Choose a short, non-overflowing keyword subline per language/post.
function computeKeywords(slug, lang, meta){
  const fromMeta = (meta.keywords||'').trim();
  if (fromMeta) return fromMeta;
  // Defaults tailored for KBLaM summary
  if (/kblam-project-summary/i.test(slug)){
    if (lang==='zh') return 'LLM • 知识令牌 • 矩形注意力 • KBLaM';
    if (lang==='es') return 'LLM • Tokens de conocimiento • Atención rectangular • KBLaM';
    return 'LLM • Knowledge Tokens • Rectangular Attention • KBLaM';
  }
  // Generic fallback
  if (lang==='zh') return 'Blog • AI • LLM';
  if (lang==='es') return 'Blog • IA • LLM';
  return 'Blog • AI • LLM';
}
