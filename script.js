/*
 * Front‑end interactivity for Fan Wan's personal website.
 *
 * This script handles the following behaviours:
 * 1. Updating the copyright year in the footer.
 * 2. Toggling the mobile navigation menu via the hamburger icon.
 * 3. Animating sections as they enter the viewport using an
 *    IntersectionObserver. Each section starts slightly faded and
 *    translated downwards; the observer adds the `visible` class to
 *    animate them into place.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Set current year in footer
  const yearSpan = document.getElementById('year');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  // Mobile navigation toggle
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('open');
    });
  }

  // Fade‑in sections as they scroll into view
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.section').forEach(section => {
    observer.observe(section);
  });

  // Blog enhancements: lang-block toggle, auto TOC from active lang, highlight + reading time
  (function enhanceBlog(){
    const isPost = document.querySelector('main.blog-post');
    if (!isPost) return;
    function getActiveLang(){
      return localStorage.getItem('lang') || document.documentElement.lang || 'zh';
    }
    function syncLangBlocks(){
      const lang = getActiveLang();
      const blocks = isPost.querySelectorAll('.i18n-block');
      if (blocks.length) {
        blocks.forEach(b => {
          const bLang = b.getAttribute('data-lang');
          if (bLang === lang) {
            b.hidden = false;
          } else {
            b.hidden = true;
          }
        });
      }
    }
    // Build TOC from the visible language block only
    function buildToc(){
      const toc = document.querySelector('.toc ol');
      if (!toc) return;
      toc.innerHTML = '';
      const active = isPost.querySelector('.i18n-block:not([hidden])') || isPost;
      const headings = active.querySelectorAll('h2[id]');
      headings.forEach(h => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${h.id}`;
        a.textContent = h.textContent.trim();
        li.appendChild(a);
        toc.appendChild(li);
      });
      // Active highlight
      const links = Array.from(toc.querySelectorAll('a'));
      const map = new Map();
      links.forEach(a => {
        const id = a.getAttribute('href').slice(1);
        const sec = document.getElementById(id);
        if (sec) map.set(sec, a);
      });
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          const link = map.get(e.target);
          if (!link) return;
          if (e.isIntersecting) {
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
          }
        });
      }, { rootMargin: '-40% 0px -55% 0px', threshold: [0, 1.0] });
      map.forEach((_, sec) => io.observe(sec));
    }
    function updateReadingTime(){
      const active = isPost.querySelector('.i18n-block:not([hidden])') || isPost;
      const metaP = isPost.querySelector('.page-hero .i18n-block:not([hidden]) .post-meta') || document.querySelector('.page-hero .post-meta');
      if (metaP && active) {
        const text = active.innerText || '';
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        const minutes = Math.max(1, Math.round(words / 260));
        const lang = getActiveLang();
        const label = lang === 'en' ? `Estimated read ${minutes} min` : lang === 'es' ? `Lectura ${minutes} min` : `预计阅读 ${minutes} 分钟`;
        // Replace any existing time segment at the end of meta text
        if (/预计阅读|Estimated read|Lectura/.test(metaP.textContent)) {
          metaP.textContent = metaP.textContent.replace(/(预计阅读.*|Estimated read.*|Lectura .*?)$/, label);
        } else {
          metaP.textContent += ` · ${label}`;
        }
      }
    }

    // Initial sync
    syncLangBlocks();
    buildToc();
    updateReadingTime();
    // Rebuild when language changes
    window.addEventListener('language-changed', () => {
      syncLangBlocks();
      buildToc();
      updateReadingTime();
    });
  })();

  // Theme toggle: manual light/dark override with localStorage persistence
  const THEME_KEY = 'theme'; // 'light' | 'dark' | 'system'
  const root = document.documentElement;
  const toggleBtn = document.getElementById('theme-toggle');
  function getEffectiveTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    // system: infer from media query
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch { return 'light'; }
  }
  function currentLang() {
    return localStorage.getItem('lang') || document.documentElement.lang || 'zh';
  }
  function t(key) {
    try { return (window.translations?.[currentLang()]?.[key]) || key; } catch { return key; }
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
      root.setAttribute('data-theme-mode', 'light');
    } else if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
      root.setAttribute('data-theme-mode', 'dark');
    } else {
      root.removeAttribute('data-theme'); // follow system
      root.setAttribute('data-theme-mode', 'system');
    }
    localStorage.setItem(THEME_KEY, theme);
  }

  // Initialize theme from storage or default to dark (as requested)
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(savedTheme);
  if (!localStorage.getItem(THEME_KEY)) {
    // reflect default in attribute for correct icon on first paint
    root.setAttribute('data-theme-mode', 'dark');
  }
  if (toggleBtn) {
    const modeText = savedTheme === 'system' ? t('theme_mode_system') : savedTheme === 'dark' ? t('theme_mode_dark') : t('theme_mode_light');
    toggleBtn.setAttribute('aria-label', t('theme_toggle_label'));
    toggleBtn.setAttribute('title', `${t('theme_toggle_label')} (${modeText})`);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      // Cycle through: dark -> light -> system -> dark
      const current = localStorage.getItem(THEME_KEY) || 'dark';
      const order = ['dark','light','system'];
      const idx = order.indexOf(current);
      const next = order[(idx + 1) % order.length];
      applyTheme(next);
      const title = next === 'system' ? t('theme_mode_system') : next === 'dark' ? t('theme_mode_dark') : t('theme_mode_light');
      toggleBtn.title = `${t('theme_toggle_label')} (${title})`;
    });
  }

  // Removed time-based 'auto' theme mode per request

  // Render portfolio from JSON
  async function renderPortfolio(filter = 'all') {
    const grid = document.querySelector('.portfolio-grid');
    if (!grid) return;
    try {
      const res = await fetch('portfolio.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      const items = await res.json();
      grid.innerHTML = '';
  const lang = currentLang();
      items.filter(it => filter === 'all' || it.category === filter).forEach(it => {
        const article = document.createElement('article');
        article.className = 'card portfolio-item';
        article.innerHTML = `
          <div class="portfolio-content">
            <div class="badge${it.badge === 'CV' ? ' success' : ''}">${it.badge}</div>
    <h3>${(it.title && (it.title[lang] || it.title.en || it.title.zh)) || ''}</h3>
    <p class="muted">${(it.summary && (it.summary[lang] || it.summary.en || it.summary.zh)) || ''}</p>
            <ul class="portfolio-meta">
      <li><span class="tag">${lang==='en'?'Role':lang==='es'?'Rol':'角色'}：${(it.role && (it.role[lang] || it.role.en || it.role.zh)) || ''}</span></li>
      <li><span class="tag">${lang==='en'?'Stack':lang==='es'?'Stack':'技术栈'}：${(it.stack||[]).join('·')}</span></li>
            </ul>
          </div>`;
        grid.appendChild(article);
      });
    } catch (e) {
      // keep existing static markup if fetch fails
    }
  }
  renderPortfolio();
  // Filters
  document.querySelectorAll('.portfolio-filters [data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-filter');
      renderPortfolio(f);
    });
  });

  // Language button + menu
  const langBtn = document.getElementById('lang-button');
  const langMenu = document.getElementById('lang-menu');
  const langSelect = document.getElementById('lang-select');
  function setLangLabel() {
    if (!langBtn) return;
    const map = { en: 'English', zh: '中文', es: 'Español' };
    const cur = localStorage.getItem('lang') || 'en';
    const labelEl = langBtn.querySelector('.label');
    if (labelEl) {
  labelEl.textContent = map[cur] || '';
    } else {
  // Fallback if no inner span exists (avoid removing the icon)
  langBtn.textContent = map[cur] || '';
    }
  }
  setLangLabel();
  if (langBtn && langMenu) {
    langBtn.addEventListener('click', () => {
      const open = langMenu.hasAttribute('hidden') ? false : true;
      if (open) {
        langMenu.setAttribute('hidden', '');
        langBtn.setAttribute('aria-expanded', 'false');
      } else {
        langMenu.removeAttribute('hidden');
        langBtn.setAttribute('aria-expanded', 'true');
      }
    });
    langMenu.querySelectorAll('li[data-lang]').forEach(item => {
      item.addEventListener('click', () => {
        const code = item.getAttribute('data-lang');
        if (langSelect) {
          langSelect.value = code;
          localStorage.setItem('lang', code);
          if (typeof translatePage === 'function') translatePage(code);
          setLangLabel();
        }
        langMenu.setAttribute('hidden', '');
        langBtn.setAttribute('aria-expanded', 'false');
      });
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!langMenu.contains(e.target) && !langBtn.contains(e.target)) {
        if (!langMenu.hasAttribute('hidden')) {
          langMenu.setAttribute('hidden', '');
          langBtn.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }

  // PWA: register service worker (avoid caching pitfalls in local/dev)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const isLocal = location.protocol === 'file:' || location.hostname === '' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (isLocal) {
        // Unregister any existing SW in dev to avoid stale resources
        navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
        return;
      }
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {/* noop */});
    });
  }

  // Rerender portfolio when language changes
  window.addEventListener('language-changed', () => {
    renderPortfolio();
    // Update Language button label too
    const btn = document.getElementById('lang-button');
    if (btn) {
      const map = { en: 'English', zh: '中文', es: 'Español' };
      const cur = localStorage.getItem('lang') || 'en';
      const labelEl = btn.querySelector('.label');
  if (labelEl) labelEl.textContent = map[cur] || '';
  else btn.textContent = map[cur] || '';
    }
  });

  // Publications: inline PDF viewer modal
  (function setupPdfModal(){
    const modal = document.getElementById('pdf-modal');
    if (!modal) return;
    const frame = document.getElementById('pdf-frame');
    const fallback = document.getElementById('pdf-fallback');
    const titleEl = document.getElementById('pdf-title');
    const isMobile = () => {
      try {
        const ua = navigator.userAgent || '';
        return /iPhone|iPad|Android|Mobile/i.test(ua) || window.innerWidth < 768;
      } catch { return window.innerWidth < 768; }
    };
    function openModal(src){
      if (frame) frame.src = src || '';
      if (fallback) fallback.hidden = !!src;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function closeModal(){
      modal.hidden = true;
      if (frame) frame.src = '';
      document.body.style.overflow = '';
    }
    modal.addEventListener('click', (e)=>{
      if (e.target && (e.target.hasAttribute('data-close'))) closeModal();
    });
    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
    document.querySelectorAll('.view-pdf[data-pdf]')?.forEach(btn => {
      btn.addEventListener('click', async () => {
        const src = btn.getAttribute('data-pdf');
        // Set dynamic title: PDF Viewer – <paper title>
        try {
          const h = btn.closest('.pub-item')?.querySelector('h3')?.textContent?.trim();
          if (titleEl) titleEl.textContent = h ? `PDF Viewer – ${h}` : (window.translations?.[localStorage.getItem('lang')||'en']?.pdf_viewer_title || 'PDF Viewer');
        } catch {}
        // On mobile devices, open the PDF directly in a new tab (native viewer)
        if (isMobile() && src) {
          try { window.open(src, '_blank', 'noopener,noreferrer'); } catch { location.href = src; }
          return;
        }
        // Probe availability before showing iframe to avoid broken content
        try {
          const head = await fetch(src, { method: 'HEAD' });
          if (head.ok) {
            openModal(src);
          } else {
            if (fallback) fallback.hidden = false;
            openModal('');
          }
        } catch {
          if (fallback) fallback.hidden = false;
          openModal('');
        }
      });
    });
  })();

  // Enhance Education section: add official website links to schools
  function enhanceEducationLinks(){
    const root = document;
    const container = root.querySelector('.education .timeline');
    if (!container) return;
    const lang = (localStorage.getItem('lang') || document.documentElement.lang || 'zh').slice(0,2);
    /** @type {Record<string, Array<{name:string,url:string}>>} */
    const map = {
      zh: [
        { name: '杜伦大学', url: 'https://www.durham.ac.uk/' },
        { name: '纽卡斯尔大学', url: 'https://www.ncl.ac.uk/' },
        { name: '山西农业大学', url: 'https://www.sxau.edu.cn/' }
      ],
      en: [
        { name: 'Durham University', url: 'https://www.durham.ac.uk/' },
        { name: 'Newcastle University', url: 'https://www.ncl.ac.uk/' },
        { name: 'Shanxi Agricultural University', url: 'https://www.sxau.edu.cn/' }
      ],
      es: [
        { name: 'Universidad de Durham', url: 'https://www.durham.ac.uk/' },
        { name: 'Universidad de Newcastle', url: 'https://www.ncl.ac.uk/' },
        { name: 'Universidad Agrícola de Shanxi', url: 'https://www.sxau.edu.cn/' }
      ]
    };
    const items = container.querySelectorAll('.timeline-item h3');
    items.forEach(h3 => {
      const text = h3.textContent || '';
      const list = map[lang] || map.zh;
      let replaced = text;
      for (const it of list) {
        if (replaced.includes(it.name)) {
          // Replace first occurrence with anchor
          const safeName = it.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          replaced = replaced.replace(new RegExp(safeName), `<a href="${it.url}" target="_blank" rel="noopener">${it.name}</a>`);
          break;
        }
      }
      h3.innerHTML = replaced;
    });
  }
  enhanceEducationLinks();
  window.addEventListener('language-changed', enhanceEducationLinks);
});