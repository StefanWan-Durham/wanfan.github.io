// Relative time in Chinese for now; could be localized via lang.js later
function relTime(iso){
  try{
    if(!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const s = Math.max(0, (Date.now()-d.getTime())/1000);
    if(s<60) return '刚刚';
    if(s<3600) return Math.floor(s/60)+' 分钟前';
    if(s<86400) return Math.floor(s/3600)+' 小时前';
    const days = Math.floor(s/86400);
    if(days===1){ const hh = d.toTimeString().slice(0,5); return '昨天 '+hh; }
    return days+' 天前';
  }catch{ return ''; }
}

// Simple i18n for UI strings in this module
function i18nStr(key, lang){
  const map = {
    allSources: { zh: '全部来源', en: 'All sources', es: 'Todas las fuentes' },
    allTags: { zh: '全部标签', en: 'All tags', es: 'Todas las etiquetas' },
    searchPH: { zh: '全局搜索…', en: 'Global search…', es: 'Búsqueda global…' },
    today: { zh: '今天', en: 'Today', es: 'Hoy' },
    archive: { zh: '归档', en: 'Archive', es: 'Archivo' },
    updated: { zh: '更新', en: 'Updated', es: 'Actualizado' },
    items: { zh: '条', en: 'items', es: 'entradas' },
  };
  return (map[key]?.[lang]) || (map[key]?.zh) || '';
}

function guessBadges(it){
  const t = `${it.title||''} ${it.raw_excerpt||''}`.toLowerCase();
  const b=[];
  if(/policy|regulat|eu ai act|govern|safety/.test(t)) b.push('🏛️ Policy');
  if(/funding|raise|seed|series [abc]|acquire|acquisition/.test(t)) b.push('💰 Funding');
  if(/state[- ]of[- ]the[- ]art|sota|breakthrough|trending|viral/.test(t)) b.push('🔥 Trending');
  if(/\barxiv\b|preprint|paper|dataset|benchmark|peer[- ]review|research|study/.test(t)) b.push('🧪 Research');
  return b;
}

function badgeClass(label){
  if(label.includes('Trending')) return 'badge-trending';
  if(label.includes('Policy')) return 'badge-policy';
  if(label.includes('Funding')) return 'badge-funding';
  if(label.includes('Research')) return 'badge-research';
  return '';
}

function extractHost(u){ try{ return new URL(u).host.replace(/^www\./,''); }catch{ return ''; } }

// --- i18n helpers & excerpt cleanup ---
function pickLangText(bundle, lang, fallback){
  if (!bundle) return fallback || '';
  // Prefer requested language; for zh/es, fallback to en; for en, do NOT fallback to zh
  if (lang === 'en') return bundle.en || fallback || '';
  if (lang === 'zh') return bundle.zh || bundle.en || fallback || '';
  if (lang === 'es') return bundle.es || bundle.en || fallback || '';
  return bundle[lang] || bundle.en || fallback || '';
}
function getTitle(item, lang){
  return pickLangText(item.title_i18n, lang, item.title || '');
}
function getExcerpt(item, lang){
  return pickLangText(item.excerpt_i18n, lang, item.raw_excerpt || '');
}
function cleanExcerpt(raw){
  if (!raw) return '';
  let t = String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Remove common HN boilerplate
  t = t
    .replace(/Article URL:\s*\S+/gi, '')
    .replace(/Comments URL:\s*\S+/gi, '')
    .replace(/Points:\s*\d+/gi, '')
    .replace(/#\s*Comments:\s*\d+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}

// Source display mapping
const SOURCE_MAP = {
  'news.ycombinator.com': 'Hacker News',
  'technologyreview.com': 'MIT Tech Review',
  'www.technologyreview.com': 'MIT Tech Review',
  'jiqizhixin.com': '机器之心',
  'www.jiqizhixin.com': '机器之心',
  'qbitai.com': '量子位',
  'www.qbitai.com': '量子位',
  'infoq.cn': 'InfoQ (中文)',
  'www.infoq.cn': 'InfoQ (中文)',
  'leiphone.com': '雷峰网',
  'www.leiphone.com': '雷峰网',
  'arstechnica.com': 'Ars Technica',
  'ai.googleblog.com': 'Google AI Blog',
  'openai.com': 'OpenAI',
  'huggingface.co': 'Hugging Face'
};
function sourceDisplay(item){
  try{
    const host = extractHost(item.url || (item.source?.site||'') || (item.source?.feed||''));
    if (!host) return (item.source?.site) || 'Unknown';
    return SOURCE_MAP[host] || host;
  }catch{ return (item.source?.site) || 'Unknown'; }
}

async function renderAIRadar(containerId = 'ai-radar') {
  const listEl = document.getElementById(containerId);
  const subEl = document.getElementById('rad-sub');
  const qEl = document.getElementById('rad-q');
  const srcEl = document.getElementById('rad-source');
  const tagEl = document.getElementById('rad-tag');
  const dateEl = document.getElementById('rad-date');
  const prevEl = document.getElementById('rad-prev');
  const nextEl = document.getElementById('rad-next');
  const topEl = document.getElementById('rad-top');

  let dates=[]; let payload=null; let items=[];
  const allCache = new Map(); // date -> items
  let globalIndex = null; // optional global search index
  let topKeys = new Set();

  function currentLang(){
    return (localStorage.getItem('lang')||document.documentElement.lang||'zh').toLowerCase();
  }

  async function loadDates(){
    try{ dates = await fetch('/data/ai/airadar/dates.json',{cache:'no-store'}).then(r=>r.json()); if(!Array.isArray(dates)) dates=[]; }
    catch{ dates=[]; }
  }
  function setDateBounds(){ if(dates.length>0){ dateEl.min=dates[dates.length-1]; dateEl.max=dates[0]; } }
  function updateNav(){ const idx=dates.indexOf(dateEl.value||''); prevEl.disabled=(idx===-1)||(idx>=dates.length-1); nextEl.disabled=(idx===-1)||(idx<=0); }

  async function loadData(){
    const picked = dateEl.value;
    let url = '/data/ai/airadar/latest.json';
    if (picked) url = `/data/ai/airadar/${picked}.json`;
    payload = await fetch(url, {cache:'no-store'}).then(r=>r.json()).catch(()=>({items:[]}));
    items = Array.isArray(payload.items)? payload.items: [];
    // Localize select placeholders each load
    try{
      const lang = currentLang();
      if (qEl) qEl.placeholder = i18nStr('searchPH', lang);
    }catch{}
    // populate dynamic sources
    try{
      const lang = currentLang();
      const hosts = Array.from(new Set(items.map(it=> extractHost(it.url||it.source?.site||it.source?.feed||'')).filter(Boolean))).sort();
      const current = srcEl.value;
      srcEl.innerHTML = `<option value="">${i18nStr('allSources', lang)}</option>` + hosts.map(h=>`<option value="${h}">${h}</option>`).join('');
      if (hosts.includes(current)) srcEl.value=current; else srcEl.value='';
    }catch{}
    // populate dynamic tags
    try{
      const lang = currentLang();
      const tagSet = new Set();
      items.forEach(it=> (it.tags||[]).forEach(t=> tagSet.add(String(t))));
      const tags = Array.from(tagSet).sort();
      const cur = tagEl.value;
      tagEl.innerHTML = `<option value="">${i18nStr('allTags', lang)}</option>` + tags.map(t=>`<option>${t}</option>`).join('');
      if (tags.includes(cur)) tagEl.value = cur; else tagEl.value = '';
    }catch{}
  // no pagination; render all in view
  }

  function applySubtitle(){
    const lang=currentLang();
    const gen = new Date(payload.generated_at||Date.now());
  const ts = gen.toLocaleString(); const count = items.length;
    if(!subEl) return;
    const isArchive = Boolean(dateEl.value);
    if (isArchive){
      if (lang==='en') subEl.textContent = `${i18nStr('archive',lang)} · ${dateEl.value} · ${count} ${i18nStr('items',lang)} · ${i18nStr('updated',lang)} ${ts}`;
      else if (lang==='es') subEl.textContent = `${i18nStr('archive',lang)} · ${dateEl.value} · ${count} ${i18nStr('items',lang)} · ${i18nStr('updated',lang)} ${ts}`;
      else subEl.textContent = `${i18nStr('archive',lang)} · ${dateEl.value} · 共 ${count} 条 · 生成：${ts}`;
    } else {
      if (lang==='en') subEl.textContent = `${i18nStr('today',lang)} · ${count} ${i18nStr('items',lang)} · ${i18nStr('updated',lang)} ${ts}`;
      else if (lang==='es') subEl.textContent = `${i18nStr('today',lang)} · ${count} ${i18nStr('items',lang)} · ${i18nStr('updated',lang)} ${ts}`;
      else subEl.textContent = `${i18nStr('today',lang)} · 共 ${count} 条 · 更新：${ts}`;
    }
  }

  async function ensureGlobalIndex(){
    if (globalIndex !== null) return;
    try{
      const data = await fetch('/data/ai/airadar/index.json', {cache:'no-store'}).then(r=>r.json());
      if (data && Array.isArray(data.items)) globalIndex = data.items;
      else globalIndex = [];
    }catch{ globalIndex = []; }
  }
  async function getAllItems(){
    // Prefer prebuilt global index if available; else merge daily files
    await ensureGlobalIndex();
    if (Array.isArray(globalIndex) && globalIndex.length){
      // adapt to card renderer fields by mapping back to expected keys
      return globalIndex.map(it => ({
        id: it.id,
        url: it.url,
        published_at: it.ts,
        title_i18n: it.title_i18n || {},
        excerpt_i18n: it.excerpt_i18n || {},
        raw_excerpt: '',
        source: { site: it.source_host, feed: '' },
        tags: [],
      }));
    }
    const want = dates.slice();
    const toFetch = want.filter(d => !allCache.has(d));
    await Promise.all(toFetch.map(async d => {
      try{
        const data = await fetch(`/data/ai/airadar/${d}.json`, {cache:'no-store'}).then(r=>r.json());
        allCache.set(d, Array.isArray(data.items)? data.items: []);
      }catch{ allCache.set(d, []); }
    }));
    const merged = [];
    for (const d of want){ merged.push(...(allCache.get(d) || [])); }
    merged.sort((a,b)=> String(b.published_at||'').localeCompare(String(a.published_at||'')));
    return merged;
  }

  async function filterItems(){
    const q=(qEl?.value||'').trim().toLowerCase();
    const src=(srcEl?.value||'').trim().toLowerCase();
  const tag=(tagEl?.value||'').trim().toLowerCase();
    // Choose source: global when searching, else current date payload
    let pool = items;
    if (q) { pool = await getAllItems(); }
    return pool.filter(it=>{
      if (src){ const host = extractHost(it.url||''); if(host && !host.includes(src)) return false; }
  if (tag){ const tags=(it.tags||[]).map(x=>String(x).toLowerCase()); if(!tags.includes(tag)) return false; }
      if (!q) return true;
      const ti = it.title_i18n || {};
      const ei = it.excerpt_i18n || {};
      const blob = [
        it.title||'', it.raw_excerpt||'',
        ti.zh||'', ti.en||'', ti.es||'',
        ei.zh||'', ei.en||'', ei.es||'',
        (it.source?.site||''), (it.source?.feed||'')
      ].join(' ').toLowerCase();
      return q.split(/\s+/).filter(Boolean).some(w=>blob.includes(w));
    });
  }

  function cardHTML(it, isTop=false){
    const lang = currentLang();
    const titleRaw = getTitle(it, lang);
    const title = titleRaw && titleRaw.trim() ? titleRaw.trim() : '(无标题)';
    const hostDisp = sourceDisplay(it) || '未知来源';
    const time = relTime(it.published_at);
    const catBadges = (it.tags||[]).map(lbl=>{
      const b = String(lbl);
      const cls = badgeClass(b) || '';
      return `<span class="badge ${cls}">${b}</span>`;
    }).join(' ');
    const badges = catBadges || guessBadges(it).map(b=>`<span class="badge ${badgeClass(b)}">${b}</span>`).join(' ');
  const excerptClean = cleanExcerpt(getExcerpt(it, lang));
    const needsI18nBadge = !(it.title_i18n && (it.title_i18n[lang]||it.title_i18n.zh||it.title_i18n.en));
    const topClass = isTop ? ' card--top' : '';
    const aria = `${title} - ${hostDisp}`;
    return `
      <article class="card rad-card${topClass}" tabindex="0" aria-label="${aria}">
        <div style="display:flex;align-items:flex-start;gap:8px;justify-content:space-between">
          <h3 class="rad-title" style="margin:0">
            ${badges?`<span style=\"margin-right:6px\">${badges}</span>`:''}
            <a href="${it.url}" target="_blank" rel="noopener">${title}</a>
            ${needsI18nBadge ? '<span class="badge" style="margin-left:6px">🌐 原文</span>' : ''}
          </h3>
        </div>
        <div class="rad-meta">
          <span>${time||new Date(it.published_at).toLocaleString()}</span>
          <span>｜${hostDisp}</span>
        </div>
  ${excerptClean?`<p class="rad-excerpt">${excerptClean}</p>`:''}
      </article>
    `;
  }

  async function renderList(){
    if(!listEl) return;
    const arr = await filterItems();
    // Simple pagination
    const PAGE = 40;
    let page = 1;
    function draw(){
      // Exclude Top items from main list
      const hasQuery = (qEl?.value||'').trim().length>0;
      const deduped = hasQuery ? arr.slice() : arr.filter(it=>{
        const key = it.id || it.url || it.title;
        return !topKeys.has(key);
      });
      const slice = deduped.slice(0, PAGE*page);
  const needsMore = slice.length < deduped.length;
  listEl.innerHTML = slice.map(it => cardHTML(it)).join('') + (needsMore ? `<div style="grid-column:1 / -1;display:flex;justify-content:center;margin:8px 0"><button id="rad-more" class="btn outline" aria-label="加载更多">加载更多</button></div>` : '');
      setupCardInteractivity();
      const more = document.getElementById('rad-more');
      more?.addEventListener('click', ()=>{ page++; draw(); });
    }
    draw();
  }

  function setupCardInteractivity(){
    // whole-card click (avoid when clicking inner links)
    listEl.querySelectorAll('article.card.rad-card').forEach(card=>{
      const link = card.querySelector('a[href]');
      const url = link?.getAttribute('href');
      if (!url) return;
  card.addEventListener('click', (e)=>{ if (e.target.closest('a,button')) return; window.open(url, '_blank', 'noopener'); });
  card.addEventListener('keydown', (e)=>{ if (e.target.closest('a,button')) return; if (e.key==='Enter' || e.key===' '){ e.preventDefault(); window.open(url, '_blank', 'noopener'); }});
    });
  }

  function getTopItems(arr){
    const N = 8;
    const res = [];
    const seen = new Set();
    // prefer marked
    for (const it of arr){
      if (guessBadges(it).length>0){
        const key = it.id || it.url || it.title;
        if (!seen.has(key)) { res.push(it); seen.add(key); if (res.length===N) break; }
      }
    }
    // fill from the rest
    if (res.length < N){
      for (const it of arr){
        const key = it.id || it.url || it.title;
        if (!seen.has(key)) { res.push(it); seen.add(key); if (res.length===N) break; }
      }
    }
    return res.slice(0,N);
  }
  function renderTop(){
  if(!topEl) return;
  // Hide Top when searching
  const hasQuery = (document.getElementById('rad-q')?.value||'').trim().length>0;
  if (hasQuery){ topEl.innerHTML=''; return; }
    // Use current date payload for Top 8 (not global)
    const arr = items.slice();
    const top = getTopItems(arr);
    topKeys = new Set(top.map(it => it.id || it.url || it.title));
    // Build a separated Top 5 container
    const wrap = document.createElement('div');
    wrap.className = 'top5-wrap';
    const title = document.createElement('div');
    title.className = 'top5-title';
  title.textContent = 'Top 8';
    wrap.appendChild(title);
    const grid = document.createElement('div');
  grid.className = 'grid grid--four';
    grid.innerHTML = top.map(it => cardHTML(it, true)).join('');
    wrap.appendChild(grid);
    topEl.innerHTML='';
    try { topEl.classList.remove('rad-list'); } catch {}
    topEl.appendChild(wrap);
  }

  // Load flow
  await loadDates();
  setDateBounds();
  // If no date selected, default to the latest (today in Beijing TZ)
  if (dateEl && !dateEl.value && Array.isArray(dates) && dates.length > 0) {
    try { dateEl.value = dates[0]; } catch {}
  }
  await loadData();
  applySubtitle();
  renderTop();
  await renderList();
  updateNav();

  // Bind events (single set)
  qEl?.addEventListener('input', ()=>{ renderTop(); renderList(); });
  srcEl?.addEventListener('change', ()=>{ renderTop(); renderList(); });
  tagEl?.addEventListener('change', ()=>{ renderTop(); renderList(); });
  dateEl?.addEventListener('change', async ()=>{ await loadData(); applySubtitle(); renderTop(); await renderList(); updateNav(); });
  prevEl?.addEventListener('click', async ()=>{
    // Move to older date (index +1). If none selected, start from latest (index 0)
    let idx = dates.indexOf(dateEl.value||'');
    if (idx === -1) idx = 0;
    if (idx < dates.length - 1) {
      dateEl.value = dates[idx + 1];
    await loadData(); applySubtitle(); renderTop(); await renderList(); updateNav();
    }
  });
  nextEl?.addEventListener('click', async ()=>{
    // Move to newer date (index -1)
    let idx = dates.indexOf(dateEl.value||'');
    if (idx === -1) idx = 0; // if empty, treat as latest
    if (idx > 0) {
      dateEl.value = dates[idx - 1];
    await loadData(); applySubtitle(); renderTop(); await renderList(); updateNav();
    }
  });

  // Re-render on language change
  window.addEventListener('language-changed', ()=>{ applySubtitle(); renderTop(); renderList(); });
}
window.addEventListener('DOMContentLoaded', () => renderAIRadar('ai-radar'));
