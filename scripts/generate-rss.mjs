// Generate RSS feeds from content/blog front matter without external deps.
// Outputs:
//  - rss.xml      (Chinese)
//  - rss-en.xml   (English)
//  - rss-es.xml   (Spanish)

import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const contentDir = path.join(root, 'content', 'blog');
const outZh = path.join(root, 'rss.xml');
const outEn = path.join(root, 'rss-en.xml');
const outEs = path.join(root, 'rss-es.xml');
const siteOrigin = 'https://fanwan-ai.github.io/';

function parseFrontMatter(src){
  const norm = src.replace(/\r\n?/g, '\n');
  const m = norm.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, norm];
  const body = norm.slice(m[0].length);
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

function esc(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

async function gatherPosts(){
  const names = await fs.readdir(contentDir).catch(()=>[]);
  const posts = [];
  for (const n of names){
    const dir = path.join(contentDir, n);
    const st = await fs.stat(dir).catch(()=>null);
    if (!st?.isDirectory()) continue;
    for (const lang of ['zh','en','es']){
      try{
        const raw = await fs.readFile(path.join(dir, `${lang}.md`), 'utf8');
        const [meta] = parseFrontMatter(raw);
        const v = (x)=>String(x||'').trim();
        const isTrue = (s)=>/^(true|1|yes|on)$/i.test(s);
        const isFalse = (s)=>/^(false|0|no|off)$/i.test(s);
        if (isTrue(v(meta.draft)) || isTrue(v(meta.hidden)) || isFalse(v(meta.published))) continue;
        const title = meta.title || n;
        const description = meta.description || '';
        const date = meta.date || '1970-01-01';
        const url = `${siteOrigin}blog/${n}${lang==='zh'?'':'.'+lang}.html`;
        posts.push({ slug:n, lang, title, description, date, url });
      } catch {}
    }
  }
  posts.sort((a,b)=> (a.date<b.date?1:(a.date>b.date?-1:0)) );
  return posts;
}

function buildRss({title, link, description, language, items}){
  const now = new Date().toUTCString();
  const entries = items.map(it=>{
    const pub = new Date(it.date || Date.now()).toUTCString();
    const guid = it.url;
    return `    <item>\n      <title>${esc(it.title)}</title>\n      <link>${esc(it.url)}</link>\n      <guid>${esc(guid)}</guid>\n      <pubDate>${pub}</pubDate>\n      <description>${esc(it.description)}</description>\n    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${esc(title)}</title>\n    <link>${esc(link)}</link>\n    <description>${esc(description)}</description>\n    <language>${esc(language)}</language>\n    <lastBuildDate>${now}</lastBuildDate>\n${entries}\n  </channel>\n</rss>\n`;
}

async function main(){
  const posts = await gatherPosts();
  const zhItems = posts.filter(p=>p.lang==='zh').slice(0, 50);
  const enItems = posts.filter(p=>p.lang==='en').slice(0, 50);
  const esItems = posts.filter(p=>p.lang==='es').slice(0, 50);
  const zhRss = buildRss({
    title: 'Fan Wan · 博客',
    link: siteOrigin,
    description: 'Research · LLM · CV · Multimedia',
    language: 'zh',
    items: zhItems,
  });
  const enRss = buildRss({
    title: 'Fan Wan · Blog',
    link: siteOrigin,
    description: 'Research · LLM · CV · Multimedia',
    language: 'en',
    items: enItems,
  });
  const esRss = buildRss({
    title: 'Fan Wan · Blog',
    link: siteOrigin,
    description: 'Research · LLM · CV · Multimedia',
    language: 'es',
    items: esItems,
  });
  await fs.writeFile(outZh, zhRss, 'utf8');
  await fs.writeFile(outEn, enRss, 'utf8');
  await fs.writeFile(outEs, esRss, 'utf8');
  console.log('RSS generated:', path.basename(outZh), path.basename(outEn), path.basename(outEs));
}

main().catch(e=>{ console.error(e); process.exit(1); });
