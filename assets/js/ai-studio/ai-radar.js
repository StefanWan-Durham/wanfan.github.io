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
  return b;
}

function extractHost(u){ try{ return new URL(u).host.replace(/^www\./,''); }catch{ return ''; } }

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
    // populate dynamic sources
    try{
      const hosts = Array.from(new Set(items.map(it=> extractHost(it.url||it.source?.site||it.source?.feed||'')).filter(Boolean))).sort();
      const current = srcEl.value;
      srcEl.innerHTML = '<option value="">全部来源</option>' + hosts.map(h=>`<option value="${h}">${h}</option>`).join('');
      if (hosts.includes(current)) srcEl.value=current; else srcEl.value='';
    }catch{}
  }

  function applySubtitle(){
    const lang=(localStorage.getItem('lang')||document.documentElement.lang||'zh').toLowerCase();
    const gen = new Date(payload.generated_at||Date.now());
    const ts = gen.toLocaleString(); const count = items.length; const win = payload.window_hours||48;
    if(!subEl) return;
    if (lang==='en') subEl.textContent = `Last ${win}h · ${count} items · Updated ${ts}`;
    else if (lang==='es') subEl.textContent = `Últimas ${win}h · ${count} entradas · Actualizado ${ts}`;
    else subEl.textContent = `最近 ${win} 小时 · ${count} 条 · 更新：${ts}`;
  }

  function filterItems(){
    const q=(qEl?.value||'').trim().toLowerCase();
    const src=(srcEl?.value||'').trim().toLowerCase();
    const win=parseInt(winEl?.value||'48',10);
    const now = Date.now();
    return items.filter(it=>{
      // window filter (from generated_at backwards)
      if (!dateEl.value){
        const t = new Date(it.published_at).getTime();
        if (isFinite(t)){
          if ((now - t) > win*3600*1000) return false;
        }
      }
      if (src){ const host = extractHost(it.url||''); if(host && !host.includes(src)) return false; }
      if (!q) return true;
      const blob = `${it.title||''} ${it.raw_excerpt||''} ${(it.source?.site||'')} ${(it.source?.feed||'')}`.toLowerCase();
      return q.split(/\s+/).filter(Boolean).some(w=>blob.includes(w));
    });
  }

  function cardHTML(it){
    const title = it.title && it.title.trim() ? it.title.trim() : '(无标题)';
    const host = extractHost((it.source&& (it.source.site||it.source.feed)) || it.url || '') || '未知来源';
    const time = relTime(it.published_at);
    const badges = guessBadges(it).map(b=>`<span class="badge">${b}</span>`).join(' ');
  const plain = String(it.raw_excerpt || '').replace(/<[^>]+>/g,'').replace(/[\r\n\t]+/g,' ').trim();
  const short = plain.length > 220 ? (plain.slice(0, 200) + '…') : plain;
  const id = 'rad-'+Math.random().toString(36).slice(2);
    return `
      <article class="card rad-card">
        <div style="display:flex;align-items:flex-start;gap:8px;justify-content:space-between">
          <h3 class="rad-title" style="margin:0">
            ${badges?`<span style="margin-right:6px">${badges}</span>`:''}
            <a href="${it.url}" target="_blank" rel="noopener">${title}</a>
          </h3>
          
        </div>
        <div class="rad-meta">
          <span>${time||new Date(it.published_at).toLocaleString()}</span>
          <span>｜${host}</span>
        </div>
    ${short?`<p class="rad-excerpt" id="${id}" data-short="${short.replace(/\"/g,'&quot;')}" data-full="${plain.replace(/\"/g,'&quot;')}">${short}</p>`:''}
    ${plain && plain.length>220 ? `<button class="btn text small" data-expands="${id}">展开更多</button>`:''}
      </article>
    `;
  }

  function renderList(){
    if(!listEl) return;
    const arr = filterItems();
    listEl.innerHTML = arr.map(cardHTML).join('');
    // bind expand toggles
    listEl.querySelectorAll('button[data-expands]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-expands');
        const p = document.getElementById(id);
        if(!p) return;
        const full = p.getAttribute('data-full')||'';
        const short = p.getAttribute('data-short')||'';
        if(btn.textContent.includes('展开')){ p.textContent = full; btn.textContent='收起内容'; }
        else { p.textContent = short; btn.textContent='展开更多'; }
      });
    });
  }

  function getTopItems(arr){
    const marked = arr.filter(it=> guessBadges(it).length>0).slice(0,5);
    if (marked.length>=3) return marked;
    return arr.slice(0,5);
  }
  function renderTop(){
    if(!topEl) return;
    const arr = filterItems();
    const top = getTopItems(arr);
    topEl.innerHTML = top.map(it=>{
      const host = extractHost(it.url||'') || '—';
      return `<div class="card rad-card"><div class="rad-meta">${relTime(it.published_at)} ｜ ${host}</div><div class="rad-title"><a href="${it.url}" target="_blank" rel="noopener">${(it.title||'').trim()}</a></div></div>`;
    }).join('');
  }

  // Load flow
  await loadDates();
  setDateBounds();
  if(dates.length>0){ dateEl.value=dates[0]; }
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
  prevEl?.addEventListener('click', async ()=>{ const idx=dates.indexOf(dateEl.value||''); if(idx>=0 && idx<dates.length-1){ dateEl.value=dates[idx+1]; await loadData(); applySubtitle(); renderList(); renderTop(); updateNav(); }});
  nextEl?.addEventListener('click', async ()=>{ const idx=dates.indexOf(dateEl.value||''); if(idx>0){ dateEl.value=dates[idx-1]; await loadData(); applySubtitle(); renderList(); renderTop(); updateNav(); }});

  // Re-render on language change
  window.addEventListener('language-changed', ()=>{ applySubtitle(); renderList(); });
  window.addEventListener('language-changed', ()=>{ applySubtitle(); renderList(); renderTop(); });
}
window.addEventListener('DOMContentLoaded', () => renderAIRadar('ai-radar'));
