// Simple Markdown → HTML blog generator for multilingual posts.
// No external deps. Put content in content/blog/<slug>/{zh.md,en.md,es.md} with YAML front matter:
// ---\n title: ...\n description: ...\n date: YYYY-MM-DD\n cover: assets/blog/<slug>-<lang>.png (optional per file)\n ---
// The script outputs blog/<slug>.html, blog/<slug>.en.html, blog/<slug>.es.html

import fs from 'node:fs/promises';
import path from 'node:path';

// Resolve project root: scripts/ -> ..
const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const contentDir = path.join(root, 'content', 'blog');
const outDir = path.join(root, 'blog');
const siteOrigin = 'https://stefanwan-durham.github.io/wanfan.github.io/';

function slugifyId(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\u2019'"“”‘’]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5\s\-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function parseFrontMatter(src) {
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

function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function mdToHtml(md) {
  // Very small markdown support: headings, paragraphs, lists, code fences, inline code, bold/italic, links, blockquotes
  const lines = md.replace(/\r\n?/g,'\n').split('\n');
  const out = [];
  let inCode = false; let codeLang = '';
  let inList = false; let listType = 'ul';
  for (let i=0;i<lines.length;i++){
    let line = lines[i];
    // Code fence
    const fence = line.match(/^```(.*)$/);
    if (fence){
      if (!inCode){ inCode=true; codeLang = (fence[1]||'').trim(); out.push(`<pre><code class="language-${escapeHtml(codeLang)}">`); }
      else { inCode=false; out.push('</code></pre>'); }
      continue;
    }
    if (inCode){ out.push(escapeHtml(line)); continue; }
    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h){
      const level = h[1].length; const text = h[2].trim();
      const id = slugifyId(text) || `h${i}`;
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    // Blockquote
    const bq = line.match(/^>\s?(.*)$/);
    if (bq){ out.push(`<blockquote><p>${inline(bq[1])}</p></blockquote>`); continue; }
    // Lists
    const ol = line.match(/^\s*\d+[\.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ol || ul){
      const curType = ol ? 'ol' : 'ul';
      if (!inList){ inList = true; listType = curType; out.push(`<${listType}>`); }
      else if (listType !== curType){ out.push(`</${listType}>`); listType = curType; out.push(`<${listType}>`); }
      const item = (ol ? ol[1] : ul[1]).trim();
      out.push(`<li>${inline(item)}</li>`);
      // Lookahead: if next line is not a list, close the list
      const next = lines[i+1] || '';
      if (!/^\s*(\d+[\.)]|[-*+])\s+/.test(next)) { out.push(`</${listType}>`); inList=false; }
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line)){ out.push('<hr>'); continue; }
    // Blank
    if (!line.trim()) { out.push(''); continue; }
    // Paragraph
    out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('\n');

  function inline(s) {
    // Escapes first, then formatting
    let t = escapeHtml(s);
    // Links [text](url)
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, a, b) => `<a href="${b}" target="_blank" rel="noopener">${a}</a>`);
    // Bold **text** or __text__
    t = t.replace(/(\*\*|__)(.+?)\1/g, '<b>$2</b>');
    // Italic *text* or _text_
    t = t.replace(/(\*|_)([^*_].*?)\1/g, '<i>$2</i>');
    // Inline code `code`
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    return t;
  }
}

function buildHtml({lang, slug, title, description, date, bodyHtml, cover}){
  const langLabel = lang==='en' ? 'English' : lang==='es' ? 'Español' : '中文';
  const titleForTwitter = lang==='en' ? `${title} (with KBLaM)` : title;
  const url = `${siteOrigin}blog/${slug}${lang==='zh'?'':'.'+lang}.html`;
  const ogImage = cover || `${siteOrigin}assets/placeholder.jpg`;
  const heroImg = cover?.startsWith('http') ? cover : (cover ? `../${cover.replace(/^\/?/, '')}` : '');
  const dateLabel = lang==='en' ? `Published on ${date}` : lang==='es' ? `Publicado el ${date}` : `发表于 ${date}`;
  const estRead = lang==='en' ? 'Estimated read' : lang==='es' ? 'Lectura' : '预计阅读';
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="Fan Wan">
  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="zh" href="https://stefanwan-durham.github.io/wanfan.github.io/blog/${slug}.html">
  <link rel="alternate" hreflang="en" href="https://stefanwan-durham.github.io/wanfan.github.io/blog/${slug}.en.html">
  <link rel="alternate" hreflang="es" href="https://stefanwan-durham.github.io/wanfan.github.io/blog/${slug}.es.html">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:secure_url" content="${ogImage}">
  <meta property="og:image:type" content="image/${ogImage.endsWith('.png')?'png':ogImage.endsWith('.jpg')||ogImage.endsWith('.jpeg')?'jpeg':'png'}">
  <link rel="image_src" href="${ogImage}">
  <meta itemprop="image" content="${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(titleForTwitter)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${ogImage}">
  <meta name="theme-color" content="#0f172a">
  <link rel="icon" href="../assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../style.css">
  <!-- Code highlight (Highlight.js) -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <!-- Math (KaTeX) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
  <script>try{var L='${lang}';localStorage.setItem('lang',L);document.documentElement.setAttribute('lang',L);}catch(e){}</script>
  <script defer src="../lang.js"></script>
  <script defer src="../script.js"></script>
  <script defer src="../assets/vendor/qrcode.min.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
  <header>
    <nav class="navbar container">
      <a href="../index.html" class="brand" aria-label="Home">
        <img src="../assets/logo.svg" alt="Fan Wan logo" class="brand-logo" width="28" height="28" />
        <span class="logo"><span class="i18n l-zh">首页</span><span class="i18n l-en">Home</span><span class="i18n l-es">Inicio</span></span>
      </a>
      <ul class="nav-links">
        <li><a href="../index.html"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/><path d="M9 21V9h6v12"/></svg></span> <span class="i18n l-zh">首页</span><span class="i18n l-en">Home</span><span class="i18n l-es">Inicio</span></a></li>
        <li><a href="../about.html"><span class="i18n l-zh">关于我</span><span class="i18n l-en">About</span><span class="i18n l-es">Acerca de</span></a></li>
        <li><a href="../publications.html"><span class="i18n l-zh">学术出版物</span><span class="i18n l-en">Research</span><span class="i18n l-es">Investigación</span></a></li>
        <li><a href="../blog.html"><span class="i18n l-zh">博客</span><span class="i18n l-en">Blog</span><span class="i18n l-es">Blog</span></a></li>
        <li><a href="../contact.html"><span class="i18n l-zh">联系</span><span class="i18n l-en">Contact</span><span class="i18n l-es">Contacto</span></a></li>
      </ul>
      <div class="nav-actions">
        <div class="lang-switcher">
          <button id="lang-button" class="btn outline icon-btn" aria-haspopup="listbox" aria-expanded="false">
            <svg class="icon icon-globe" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></g></svg>
            <span class="label"></span>
          </button>
          <ul id="lang-menu" class="lang-menu" role="listbox" aria-label="Language" hidden>
            <li role="option" data-lang="en">English</li>
            <li role="option" data-lang="zh">中文</li>
            <li role="option" data-lang="es">Español</li>
          </ul>
        </div>
        <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" title="Toggle theme">
          <svg class="icon icon-bulb" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 15.5c-.9-1-1.5-2.3-1.5-3.8a5 5 0 1 1 10 0c0 1.5-.6 2.8-1.5 3.8-.6.7-1.1 1.4-1.3 2.2H9.8c-.2-.8-.7-1.5-1.3-2.2z"/><path d="M12 2v2"/><path d="M4 10h2"/><path d="M18 10h2"/><path d="M5.5 5.5l1.4 1.4"/><path d="M18.5 5.5l-1.4 1.4"/></g></svg>
          <svg class="icon icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <svg class="icon icon-system" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" ry="2"/><path d="M8 20h8M12 16v4"/></g></svg>
        </button>
        <div class="hamburger" id="hamburger"><span></span><span></span><span></span></div>
      </div>
    </nav>
  </header>
  <main id="main" class="blog-post">
    <section class="page-hero section">
      <div class="container">
        <div class="i18n-block" data-lang="${lang}">
          <h1 class="post-title">${escapeHtml(title)}</h1>
          <p class="muted post-meta">${dateLabel} · ${estRead} 5 min</p>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container prose">
        ${heroImg ? `<div class="post-hero-art" data-lang="${lang}"><img src="${heroImg}" alt="Cover"/></div>` : ''}
        <nav class="toc card" aria-label="Contents" style="padding:16px;margin:12px 0;"><strong>${lang==='en'?'Contents':(lang==='es'?'Índice':'目录')}</strong><ol></ol></nav>
        <article class="i18n-block" data-lang="${lang}">
${bodyHtml}
        </article>
        <div class="share-toolbar card" style="margin-top:24px;padding:12px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <strong class="share-title" data-i18n="share_label">${lang==='en'?'Share':(lang==='es'?'Compartir':'分享')}</strong>
          <div class="spacer" style="flex:0 0 8px"></div>
          <button class="btn outline share-btn" data-share="wechat">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.5 3C4.46 3 2 5.08 2 7.65c0 1.52.84 2.88 2.15 3.8l-.53 1.93 2.06-1.24c.56.14 1.15.21 1.77.21 3.04 0 5.5-2.08 5.5-4.65S10.54 3 7.5 3zm-1.4 3.6a.9.9 0 110 1.8.9.9 0 010-1.8zm3.8 0a.9.9 0 110 1.8.9.9 0 010-1.8zM16.5 10c-2.86 0-5.17 1.86-5.17 4.15 0 1.27.7 2.4 1.78 3.17l-.44 1.6 1.72-1.03c.47.12.97.18 1.48.18 2.86 0 5.17-1.86 5.17-4.15S19.36 10 16.5 10zm-1.2 2.7a.9.9 0 110 1.8.9.9 0 010-1.8zm3.6 0a.9.9 0 110 1.8.9.9 0 010-1.8z" fill="currentColor" stroke="none"></path></svg>
            <span data-i18n="share_wechat">${lang==='en'?'WeChat':(lang==='es'?'WeChat':'微信')}</span>
          </button>
          <a class="btn outline share-btn" data-share="whatsapp" target="_blank" rel="noopener"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-14.32 4.906L4 21l4.2-1.11A8 8 0 1 1 20 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 9.5c.5 2 2.5 3.5 4 4l1.2-.8c.3-.2.7-.1.9.2l.7 1.1c.2.3.1.7-.2.9-1 .7-2.1 1.1-3.3 1.1-2.9 0-5.3-2.4-5.3-5.3 0-1.2.4-2.3 1.1-3.3.2-.3.6-.4.9-.2l1.1.7c.3.2.4.6.2.9l-.8 1.2z"/></svg>
            <span data-i18n="share_whatsapp">WhatsApp</span></a>
          <button class="btn outline share-btn" data-share="copy"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"/><rect x="5" y="5" width="10" height="10" rx="2"/></svg>
            <span data-i18n="share_copy">${lang==='en'?'Copy link':(lang==='es'?'Copiar enlace':'复制链接')}</span></button>
          <a class="btn outline share-btn" data-share="download" download><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M5 21h14"/></svg>
            <span data-i18n="share_download">${lang==='en'?'Download cover':(lang==='es'?'Descargar portada':'下载封面')}</span></a>
          <button class="btn outline share-btn" data-share="native"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 16V3"/><path d="M8 7l4-4 4 4"/></svg>
            <span data-i18n="share_share">${lang==='en'?'Share…':(lang==='es'?'Compartir…':'分享…')}</span></button>
        </div>
        <div id="share-modal" class="modal" hidden>
          <div class="modal-content card" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <h3 id="share-title" data-i18n="share_wechat">${lang==='en'?'WeChat':(lang==='es'?'WeChat':'微信')}</h3>
              <button class="btn outline" data-close><span data-i18n="share_close">${lang==='en'?'Close':(lang==='es'?'Cerrar':'关闭')}</span></button>
            </div>
            <p class="muted" style="margin:8px 0" data-i18n="share_wechat_qr_tip">${lang==='en'?'Scan in WeChat to share this post':(lang==='es'?'Escanea en WeChat para compartir':'用微信扫描分享此文')}</p>
            <div id="qr" style="display:grid;place-items:center;padding:12px"></div>
          </div>
        </div>
        <hr style="margin: 24px 0">
        <nav class="post-nav" aria-label="Post navigation">
          <a class="btn outline" href="../blog.html">${lang==='en'?'← Back to Blog':(lang==='es'?'← Volver al blog':'← 返回博客')}</a>
          <span class="muted" style="margin:0 .5rem">·</span>
          <a class="btn outline" href="#" aria-disabled="true" onclick="return false;">${lang==='en'?'Previous':'上一个'}</a>
          <a class="btn outline" href="#" aria-disabled="true" onclick="return false;">${lang==='en'?'Next':'下一个'}</a>
        </nav>
      </div>
    </section>
  </main>
  <footer>
    <div class="container"><p>© <span id="year"></span> Fan Wan</p></div>
  </footer>
  <script>
    (function(){
      if (window.hljs) { try { window.hljs.highlightAll(); } catch(e){} }
      function render(){ try { if (window.renderMathInElement) window.renderMathInElement(document.body, { delimiters:[{left:'$$', right:'$$', display:true},{left:'$', right:'$', display:false}] }); } catch(e){} }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
    })();
  </script>
</body>
</html>`;
}

async function buildPost(dir){
  const slug = path.basename(dir);
  const langs = ['zh','en','es'];
  for (const lang of langs){
    const file = path.join(dir, `${lang}.md`);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const [meta, body] = parseFrontMatter(raw);
      if (/^(true|1)$/i.test(String(meta.draft||'').trim())) { continue; }
      const title = meta.title || slug;
      const description = meta.description || '';
      const date = meta.date || new Date().toISOString().slice(0,10);
      // Resolve a valid cover for hero/OG: prefer provided site path if exists; else PNG, then SVG, else placeholder
      const preferRel = (meta.cover && !/^https?:\/\//i.test(meta.cover)) ? meta.cover.replace(/^\/?/,'') : '';
      const pngRel = path.join('assets','blog',`${slug}-${lang}.png`);
      const svgRel = path.join('assets','blog',`${slug}-${lang}.svg`);
      let chosenRel = '';
      if (preferRel) {
        try { await fs.access(path.join(root, preferRel)); chosenRel = preferRel; } catch {}
      }
      if (!chosenRel) {
        try { await fs.access(path.join(root, pngRel)); chosenRel = pngRel; } catch {}
      }
      if (!chosenRel) {
        try { await fs.access(path.join(root, svgRel)); chosenRel = svgRel; } catch {}
      }
      if (!chosenRel) { chosenRel = 'assets/placeholder.jpg'; }
      const cover = meta.cover && /^https?:\/\//i.test(meta.cover) ? meta.cover : `${siteOrigin}${chosenRel}`;
      const bodyHtml = mdToHtml(body);
      const html = buildHtml({lang, slug, title, description, date, bodyHtml, cover});
      const outPath = path.join(outDir, `${slug}${lang==='zh'?'':'.'+lang}.html`);
      await fs.writeFile(outPath, html, 'utf8');
      console.log('Wrote', path.relative(root, outPath));
    } catch (e) {
      // Skip missing language files silently
    }
  }
}

async function main(){
  await fs.mkdir(outDir, { recursive: true });
  const arg = process.argv[2];
  const posts = [];
  if (arg) {
    const p = path.join(contentDir, arg);
    posts.push(p);
  } else {
    const names = await fs.readdir(contentDir).catch(()=>[]);
    for (const n of names){
      const p = path.join(contentDir, n);
      const st = await fs.stat(p).catch(()=>null);
      if (st?.isDirectory()) posts.push(p);
    }
  }
  for (const p of posts){
    await buildPost(p);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
