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
  return bundle[lang] || bundle.zh || bundle.en || fallback || '';
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
  const winEl = document.getElementById('rad-window');
  const dateEl = document.getElementById('rad-date');
  const prevEl = document.getElementById('rad-prev');
  const nextEl = document.getElementById('rad-next');
  const topEl = document.getElementById('rad-top');

  let dates=[]; let payload=null; let items=[];

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
    // Hide/disable time window in archive view
    const isArchive = Boolean(dateEl.value);
    if (winEl){
  // default to 72h on latest view
  if (!isArchive) { try { winEl.value = '72'; } catch {}
  }
  winEl.disabled = isArchive;
      winEl.title = isArchive ? '归档视图中禁用时间窗口' : '';
      // Optional hide visually
      winEl.style.opacity = isArchive ? '0.5' : '';
    }
    // populate dynamic sources
    try{
      const hosts = Array.from(new Set(items.map(it=> extractHost(it.url||it.source?.site||it.source?.feed||'')).filter(Boolean))).sort();
      const current = srcEl.value;
      srcEl.innerHTML = '<option value="">全部来源</option>' + hosts.map(h=>`<option value="${h}">${h}</option>`).join('');
      if (hosts.includes(current)) srcEl.value=current; else srcEl.value='';
    }catch{}
  // no pagination; render all in view
  }

  function applySubtitle(){
    const lang=currentLang();
    const gen = new Date(payload.generated_at||Date.now());
  const ts = gen.toLocaleString(); const count = items.length; const win = (!dateEl.value && winEl) ? parseInt(winEl.value||payload.window_hours||48,10) : (payload.window_hours||48);
    if(!subEl) return;
    const isArchive = Boolean(dateEl.value);
    if (isArchive){
      if (lang==='en') subEl.textContent = `Archive · ${dateEl.value} · ${count} items · Built ${ts}`;
      else if (lang==='es') subEl.textContent = `Archivo · ${dateEl.value} · ${count} entradas · Generado ${ts}`;
      else subEl.textContent = `归档 · ${dateEl.value} · 共 ${count} 条 · 生成：${ts}`;
    } else {
      if (lang==='en') subEl.textContent = `Last ${win}h · ${count} items · Updated ${ts}`;
      else if (lang==='es') subEl.textContent = `Últimas ${win}h · ${count} entradas · Actualizado ${ts}`;
      else subEl.textContent = `最近 ${win} 小时 · ${count} 条 · 更新：${ts}`;
    }
  }

  function filterItems(){
    const q=(qEl?.value||'').trim().toLowerCase();
    const src=(srcEl?.value||'').trim().toLowerCase();
    const win=parseInt(winEl?.value||'48',10);
    const now = Date.now();
    return items.filter(it=>{
      // window filter (from generated_at backwards)
      if (!dateEl.value){
        const t = Date.parse(it.published_at);
        if (Number.isFinite(t)){
          const diff = now - t;
          if (diff < 0 || diff > win*3600*1000) return false;
        }
      }
      if (src){ const host = extractHost(it.url||''); if(host && !host.includes(src)) return false; }
      if (!q) return true;
      const blob = `${it.title||''} ${it.raw_excerpt||''} ${(it.source?.site||'')} ${(it.source?.feed||'')}`.toLowerCase();
      return q.split(/\s+/).filter(Boolean).some(w=>blob.includes(w));
    });
  }

  function cardHTML(it, isTop=false){
    const lang = currentLang();
    const titleRaw = getTitle(it, lang);
    const title = titleRaw && titleRaw.trim() ? titleRaw.trim() : '(无标题)';
    const hostDisp = sourceDisplay(it) || '未知来源';
    const time = relTime(it.published_at);
  const badges = guessBadges(it).map(b=>`<span class="badge ${badgeClass(b)}">${b}</span>`).join(' ');
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

  function renderList(){
    if(!listEl) return;
    const arr = filterItems();
    listEl.innerHTML = arr.map(it => cardHTML(it)).join('');
  setupCardInteractivity();
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
    const arr = filterItems();
    const top = getTopItems(arr);
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
  await loadData();
  applySubtitle();
  renderList();
  updateNav();
  renderTop();

  // Bind events
  qEl?.addEventListener('input', ()=>{ renderList(); });
  srcEl?.addEventListener('change', ()=>{ renderList(); });
  winEl?.addEventListener('change', ()=>{ renderList(); });
  dateEl?.addEventListener('change', async ()=>{ await loadData(); applySubtitle(); renderList(); updateNav(); });
  prevEl?.addEventListener('click', async ()=>{ const idx=dates.indexOf(dateEl.value||''); if(idx>=0 && idx<dates.length-1){ dateEl.value=dates[idx+1]; await loadData(); applySubtitle(); renderList(); updateNav(); }});
  nextEl?.addEventListener('click', async ()=>{ const idx=dates.indexOf(dateEl.value||''); if(idx>0){ dateEl.value=dates[idx-1]; await loadData(); applySubtitle(); renderList(); updateNav(); }});
  qEl?.addEventListener('input', ()=>{ renderList(); renderTop(); });
  srcEl?.addEventListener('change', ()=>{ renderList(); renderTop(); });
  winEl?.addEventListener('change', ()=>{ renderList(); renderTop(); });
  dateEl?.addEventListener('change', async ()=>{ await loadData(); applySubtitle(); renderList(); renderTop(); updateNav(); });
  prevEl?.addEventListener('click', async ()=>{ 
    let idx=dates.indexOf(dateEl.value||'');
    if(idx===-1 && dates.length>0){ dateEl.value = dates[0]; idx = 0; }
    if(idx>=0 && idx<dates.length-1){ dateEl.value=dates[idx+1]; }
    else return;
    await loadData(); applySubtitle(); renderList(); renderTop(); updateNav();
  });
  nextEl?.addEventListener('click', async ()=>{ 
    const val = dateEl.value||''; let idx=dates.indexOf(val);
    if(idx>0){ dateEl.value=dates[idx-1]; }
    else return;
    await loadData(); applySubtitle(); renderList(); renderTop(); updateNav();
  });

  // Re-render on language change
  window.addEventListener('language-changed', ()=>{ applySubtitle(); renderList(); renderTop(); });
}
window.addEventListener('DOMContentLoaded', () => renderAIRadar('ai-radar'));
