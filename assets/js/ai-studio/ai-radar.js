async function renderAIRadar(containerId = 'ai-radar') {
  const listEl = document.getElementById(containerId);
  const subEl = document.getElementById('rad-sub');
  try {
    const res = await fetch('/data/ai/airadar/latest.json', { cache: 'no-store' });
    const data = await res.json();
    listEl.innerHTML = '';

    // Localized subtitle
    const lang = (localStorage.getItem('lang')||document.documentElement.lang||'zh').toLowerCase();
    const gen = new Date(data.generated_at);
    const ts = gen.toLocaleString();
    const count = (data.items||[]).length;
    if (subEl){
      if (lang === 'en') subEl.textContent = `Last ${data.window_hours}h · ${count} items · Updated ${ts}`;
      else if (lang === 'es') subEl.textContent = `Últimas ${data.window_hours}h · ${count} entradas · Actualizado ${ts}`;
      else subEl.textContent = `最近 ${data.window_hours} 小时 · ${count} 条 · 更新：${ts}`;
    }

    (data.items || []).forEach(it => {
      const card = document.createElement('article');
      card.className = 'card rad-card';
      const title = it.title && it.title.trim() ? it.title.trim() : '(无标题)';
      const source = (it.source && (it.source.site || it.source.feed)) || '未知';
      const time = new Date(it.published_at).toLocaleString();
      const plain = String(it.raw_excerpt || '').replace(/<[^>]+>/g,'').replace(/[\r\n\t]+/g,' ').trim();
      const excerpt = plain.length > 220 ? (plain.slice(0, 200) + '…') : plain;
      card.innerHTML = `
        <h3 class="rad-title"><a href="${it.url}" target="_blank" rel="noopener">${title}</a></h3>
        <div class="rad-meta">
          <span>${time}</span>
          <span>｜${source}</span>
        </div>
        ${excerpt ? `<p class="rad-excerpt">${excerpt}</p>` : ''}
      `;
      listEl.appendChild(card);
    });
  } catch (e) {
    if (listEl) listEl.innerHTML = '<article class="card rad-card"><div class="rad-meta">AI 风向标数据加载失败。</div></article>';
    console.error(e);
  }
}
window.addEventListener('DOMContentLoaded', () => renderAIRadar('ai-radar'));
