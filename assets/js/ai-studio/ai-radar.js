async function renderAIRadar(containerId = 'ai-radar') {
  const el = document.getElementById(containerId);
  try {
    const res = await fetch('/data/ai/airadar/latest.json', { cache: 'no-store' });
    const data = await res.json();
    el.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'radar-header';
    header.textContent = `AI 风向标 · 最近 ${data.window_hours} 小时（更新：${new Date(data.generated_at).toLocaleString()})`;
    el.appendChild(header);

    (data.items || []).forEach(it => {
      const card = document.createElement('article');
      card.className = 'radar-card';
      card.innerHTML = `
        <h3 class="radar-title"><a href="${it.url}" target="_blank" rel="noopener">${it.title || '(无标题)'}</a></h3>
        <div class="radar-meta">
          <span>${new Date(it.published_at).toLocaleString()}</span>
          <span>｜来源：${(it.source && (it.source.site || it.source.feed)) || '未知'}</span>
        </div>
        <p class="radar-excerpt">${(it.raw_excerpt || '').replace(/<[^>]+>/g,'').slice(0,180)}</p>
      `;
      el.appendChild(card);
    });
  } catch (e) {
    el.textContent = 'AI 风向标数据加载失败。';
    console.error(e);
  }
}
window.addEventListener('DOMContentLoaded', () => renderAIRadar('ai-radar'));
