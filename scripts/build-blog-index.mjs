// Build the blog index listing in blog.html from content/blog front matter.
// It updates the .blog-posts container with cards per post and language, skipping drafts.

import fs from 'node:fs/promises';
import path from 'node:path';

// Resolve project root: scripts/ -> ..
const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const contentDir = path.join(root, 'content', 'blog');
const blogIndexPath = path.join(root, 'blog.html');

function parseFrontMatter(src){
  // Normalize newlines so Windows CRLF also works
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

async function readPostMeta(slug){
  const langs = ['zh','en','es'];
  const metaByLang = {};
  for (const lang of langs){
    try{
      const raw = await fs.readFile(path.join(contentDir, slug, `${lang}.md`), 'utf8');
      const [meta] = parseFrontMatter(raw);
  const val = (x)=>String(x||'').trim();
  const isTrue = (s)=>/^(true|1|yes|on)$/i.test(s);
  const isFalse = (s)=>/^(false|0|no|off)$/i.test(s);
  if (isTrue(val(meta.draft)) || isTrue(val(meta.hidden)) || isFalse(val(meta.published))) { continue; }
      metaByLang[lang] = {
        title: meta.title || slug,
        description: meta.description || '',
        date: meta.date || '',
        cover: meta.cover || `assets/blog/${slug}-${lang}.png`,
      };
    } catch {}
  }
  return metaByLang;
}

async function pickCover(slug, lang, metaCover){
  // Prefer meta cover if provided; if it's a site path, verify existence.
  if (metaCover) {
    if (/^https?:\/\//i.test(metaCover)) return metaCover;
    try { await fs.access(path.join(root, metaCover.replace(/^\/?/, ''))); return metaCover; } catch {}
  }
  const png = path.join('assets','blog',`${slug}-${lang}.png`);
  const svg = path.join('assets','blog',`${slug}-${lang}.svg`);
  try { await fs.access(path.join(root, png)); return png; } catch {}
  try { await fs.access(path.join(root, svg)); return svg; } catch {}
  return 'assets/placeholder.jpg';
}

async function cardHtml(slug, metas){
  const hrefZh = `blog/${slug}.html`;
  const hrefEn = `blog/${slug}.en.html`;
  const hrefEs = `blog/${slug}.es.html`;
  const srcZh = await pickCover(slug, 'zh', metas.zh?.cover);
  const srcEn = await pickCover(slug, 'en', metas.en?.cover);
  const srcEs = await pickCover(slug, 'es', metas.es?.cover);
  return `        <article class="card post-card">
          <a class="post-link" href="${hrefZh}" aria-label="${(metas.zh?.title||metas.en?.title||slug).replace(/"/g,'&quot;')}"
             data-href-zh="${hrefZh}"
             data-href-en="${hrefEn}"
             data-href-es="${hrefEs}">
            <img class="post-thumb"
                 src="${srcZh}"
                 data-src-zh="${srcZh}"
                 data-src-en="${srcEn}"
                 data-src-es="${srcEs}"
                 alt="${(metas.zh?.title||metas.en?.title||slug).replace(/"/g,'&quot;')}"
                 width="140" height="90"
                 style="border-radius:10px;border:1px solid var(--border);display:block;object-fit:cover;aspect-ratio:16/10"/>
          </a>
          <div>
            <h3 class="post-card-title" style="margin:0 0 8px 0">
              <a class="post-card-title-link" href="${hrefZh}">
                <span class="i18n l-zh">${metas.zh?.title || metas.en?.title || ''}</span>
                <span class="i18n l-en">${metas.en?.title || metas.zh?.title || ''}</span>
                <span class="i18n l-es">${metas.es?.title || metas.en?.title || ''}</span>
              </a>
            </h3>
            <p class="muted" style="margin:0 0 6px 0">
              <span class="i18n l-zh">${metas.zh?.date ? `发表于 ${metas.zh.date}` : ''}</span>
              <span class="i18n l-en">${metas.en?.date ? `Published on ${metas.en.date}` : ''}</span>
              <span class="i18n l-es">${metas.es?.date ? `Publicado el ${metas.es.date}` : ''}</span>
            </p>
            <p class="muted" style="margin:0">
              <span class="i18n l-zh">${metas.zh?.description || ''}</span>
              <span class="i18n l-en">${metas.en?.description || ''}</span>
              <span class="i18n l-es">${metas.es?.description || ''}</span>
            </p>
          </div>
        </article>`;
}

async function main(){
  const names = await fs.readdir(contentDir).catch(()=>[]);
  const posts = [];
  for (const n of names){
    const p = path.join(contentDir, n);
    const st = await fs.stat(p).catch(()=>null);
    if (st?.isDirectory()) posts.push(n);
  }
  // newest first by date if present
  const metaList = [];
  for (const slug of posts){
    const mbl = await readPostMeta(slug);
    if (Object.keys(mbl).length) metaList.push({ slug, metas: mbl });
  }
  // Fallback: include legacy first post if not in content/blog
  if (!posts.includes('future-of-rag-2025-kblam')) {
    metaList.push({
      slug: 'future-of-rag-2025-kblam',
      metas: {
        zh: {
          title: 'RAG 会被淘汰吗？从“大上下文”到 GraphRAG、检索感知训练与 KBLaM 的 2025 路线图',
          description: '更大的上下文与更强的模型并没有让 RAG 过时；过时的是“天真向量检索”。本文结合 KBLaM 实战，总结 2025 年的 5 条升级路线与选型矩阵。',
          date: '2025-09-02',
          cover: 'assets/blog/rag-hero-zh.v5.svg'
        },
        en: {
          title: 'Is RAG obsolete? 2025 roadmap: GraphRAG, Retrieval‑Aware Training and KBLaM',
          description: 'Five upgrade paths for 2025 and a selection matrix with KBLaM practice.',
          date: '2025-09-02',
          cover: 'assets/blog/rag-hero-en.v5.svg'
        },
        es: {
          title: '¿Quedará obsoleto RAG? Hoja de ruta 2025 (con KBLaM)',
          description: 'Cinco rutas de mejora para 2025 y una matriz de selección con la práctica de KBLaM.',
          date: '2025-09-02',
          cover: 'assets/blog/rag-hero-es.v5.svg'
        }
      }
    });
  }
  metaList.sort((a,b)=>{
    const da = a.metas.zh?.date || a.metas.en?.date || '0000-00-00';
    const db = b.metas.zh?.date || b.metas.en?.date || '0000-00-00';
    return db.localeCompare(da);
  });

  const html = await fs.readFile(blogIndexPath, 'utf8');
  const beginMark = '<!-- BLOG_POSTS_BEGIN';
  const endMark = '<!-- BLOG_POSTS_END';
  const bIdx = html.indexOf(beginMark);
  const eIdx = html.indexOf(endMark);
  if (bIdx === -1 || eIdx === -1) {
    console.warn('Markers not found in blog.html; skip index update');
    return;
  }
  const bEnd = html.indexOf('-->', bIdx);
  const eEnd = html.indexOf('-->', eIdx);
  if (bEnd === -1 || eEnd === -1) {
    console.warn('Marker closures not found; skip index update');
    return;
  }
  // Keep both markers; replace only the content between them
  const before = html.slice(0, bEnd + 3);
  const after = html.slice(eIdx); // include END marker and the rest
  const cards = (await Promise.all(metaList.map(({slug, metas}) => cardHtml(slug, metas)))).join('\n');
  const out = before + '\n' + cards + '\n' + after;
  await fs.writeFile(blogIndexPath, out, 'utf8');
  console.log('blog.html updated with', metaList.length, 'posts');
}

main().catch(e=>{ console.error(e); process.exit(1); });
