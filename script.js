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

  // Trigger About portrait effect when clicking About link in nav
  (function wireAboutNavEffect(){
    const aboutLinks = Array.from(document.querySelectorAll('a[href$="about.html"], a[href="#about"], a[data-nav="about"]'));
    if (!aboutLinks.length) return;
    aboutLinks.forEach(a => {
      a.addEventListener('click', (e) => {
        try { sessionStorage.setItem('triggerAboutFx', '1'); } catch {}
        // If link stays on this page (hash/nav), trigger immediately
        const href = a.getAttribute('href') || '';
        const isHash = href.startsWith('#');
        const samePageAbout = href.includes('#about');
        if (isHash || samePageAbout) {
          const target = document.querySelector('.about-portrait.fx-reveal') || document.querySelector('.about-photo .fx-tilt');
          if (target && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            triggerAboutReveal(target);
          }
        }
      }, { passive: true });
    });
  })();

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
    // Ensure the URL variant matches selected language so OG/Twitter share cards stay consistent
    (function ensurePageLangURL(){
      const path = location.pathname;
      const pageLang = path.endsWith('.en.html') ? 'en' : path.endsWith('.es.html') ? 'es' : 'zh';
      function targetFor(lang){
        if (lang === 'en') return path.endsWith('.en.html') ? path : path.replace(/\.es\.html$|\.html$/, '.en.html');
        if (lang === 'es') return path.endsWith('.es.html') ? path : path.replace(/\.en\.html$|\.html$/, '.es.html');
        // zh default: no lang suffix
        return path.replace(/\.(en|es)\.html$/, '.html');
      }
      // On load, prefer current page variant and persist it
      try { localStorage.setItem('lang', pageLang); } catch {}
      // On language change, redirect to the corresponding variant
      window.addEventListener('language-changed', (e) => {
        const lang = (e && e.detail && e.detail.lang) || (localStorage.getItem('lang') || 'zh');
        if (lang !== pageLang) {
          const target = targetFor(lang);
          if (target && target !== path) location.href = target + location.search + location.hash;
        }
      });
    })();
    function getActiveLang(){
      return localStorage.getItem('lang') || document.documentElement.lang || 'zh';
    }
    function updateTocLabel(){
      const tocWrap = document.querySelector('.toc');
      if (!tocWrap) return;
      const lang = getActiveLang();
      const label = lang === 'en' ? 'Contents' : (lang === 'es' ? 'Índice' : '目录');
      tocWrap.setAttribute('aria-label', label);
      const strong = tocWrap.querySelector('strong');
      if (strong) strong.textContent = label;
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
      // Prefer the visible article block that actually has h2 headings
      const visibleBlocks = Array.from(isPost.querySelectorAll('.i18n-block:not([hidden])'));
      let active = visibleBlocks.find(b => b.closest('.container.prose') && b.querySelector('h2[id]'))
               || visibleBlocks.find(b => b.querySelector('h2[id]'))
               || isPost;
      const headings = active.querySelectorAll('h2[id]');
      headings.forEach(h => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${h.id}`;
  // Remove any leading numbering like "1.", "2)", "(3)", or full-width variants to avoid double numbering in the OL
  const raw = (h.textContent || '').replace(/\s+/g, ' ').trim();
  const cleaned = raw.replace(/^\s*(?:\d+[\.\) 、]|[\(（]\d+[\)）])\s*/, '');
  a.textContent = cleaned || raw;
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

    // Toggle localized hero image according to language
    function syncPostHero(){
      const lang = getActiveLang();
      const arts = isPost.querySelectorAll('.post-hero-art');
      arts.forEach(el => {
        const l = el.getAttribute('data-lang');
        if (l === lang) { el.hidden = false; }
        else { el.hidden = true; }
      });
    }

    // Initial sync
    syncLangBlocks();
    updateTocLabel();
    buildToc();
    updateReadingTime();
    syncPostHero();
    // Rebuild when language changes
    window.addEventListener('language-changed', () => {
      syncLangBlocks();
      updateTocLabel();
      buildToc();
      updateReadingTime();
      syncPostHero();
    });

    // Share feature: WeChat QR, WhatsApp, Copy link, Download cover, Native share
    (function initShare(){
      const bar = document.querySelector('.share-toolbar');
      if (!bar) return;
      function activeLang(){ return localStorage.getItem('lang') || document.documentElement.lang || 'zh'; }
      function currentUrl(){ return location.href.split('#')[0]; }
      function postCover(){
        const lang = activeLang();
        // Try to read current visible hero image src
        const art = document.querySelector('.post-hero-art:not([hidden]) img');
        if (art && art.getAttribute('src')) return art.getAttribute('src');
        // fallback by convention
        if (lang==='en') return '../assets/blog/rag-hero-en.v5.svg';
        if (lang==='es') return '../assets/blog/rag-hero-es.v5.svg';
        return '../assets/blog/rag-hero-zh.v5.svg';
      }
      function whatsappHref(){
        const text = encodeURIComponent(document.title + ' ' + currentUrl());
        return 'https://wa.me/?text=' + text;
      }
      function setDownloadLink(a){
        const src = postCover();
        a.setAttribute('href', src);
        // derive filename
        const fn = src.split('/').pop() || 'cover.svg';
        a.setAttribute('download', fn);
      }
      // Minimal QR generator for URL using a tiny SVG fallback (no external dep)
      async function renderQR(target, text){
        target.innerHTML = '';
        function drawWithLib(){
          try {
            if (window.QRCode) {
              target.innerHTML = '';
              // eslint-disable-next-line no-new
              new window.QRCode(target, { text, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
              return true;
            }
          } catch {}
          return false;
        }
        // Try local vendor lib (preferred)
        if (drawWithLib()) return;
        // Try to lazy-load from CDN as a resilience fallback when online
        try {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
            s.async = true;
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
          });
          if (drawWithLib()) return;
        } catch {}
        // Final fallback: show the URL text if no lib available
        const note = document.createElement('div');
        note.className = 'muted';
        note.style.cssText = 'font-size:12px;word-break:break-all;text-align:center;max-width:280px;';
        note.textContent = text;
        target.appendChild(note);
      }
      function openModal(){ document.getElementById('share-modal')?.removeAttribute('hidden'); }
      function closeModal(){ document.getElementById('share-modal')?.setAttribute('hidden',''); }

      // Wire actions
      const btnWeChat = bar.querySelector('[data-share="wechat"]');
      const btnWhats = bar.querySelector('[data-share="whatsapp"]');
      const btnCopy = bar.querySelector('[data-share="copy"]');
      const btnDown = bar.querySelector('[data-share="download"]');
      const btnNative = bar.querySelector('[data-share="native"]');
      const modal = document.getElementById('share-modal');
      const modalClose = modal?.querySelector('[data-close]');
      const qr = document.getElementById('qr');
      if (btnWhats) btnWhats.setAttribute('href', whatsappHref());
      if (btnDown) setDownloadLink(btnDown);
      if (btnWeChat) btnWeChat.addEventListener('click', () => { openModal(); renderQR(qr, currentUrl()); });
      if (modalClose) modalClose.addEventListener('click', closeModal);
      if (modal) modal.addEventListener('click', (e)=>{ if (e.target===modal) closeModal(); });
      if (btnCopy) btnCopy.addEventListener('click', async ()=>{
        try { await navigator.clipboard.writeText(currentUrl());
          const lang = activeLang();
          const ok = (window.translations?.[lang]?.share_copied) || 'Copied';
          btnCopy.textContent = ok;
          setTimeout(()=>{ btnCopy.querySelector ? (btnCopy.querySelector('span')? btnCopy.querySelector('span').textContent = (window.translations?.[lang]?.share_copy)||'Copy link' : btnCopy.textContent=(window.translations?.[lang]?.share_copy)||'Copy link') : null; }, 1400);
        } catch {}
      });
      if (btnNative) btnNative.addEventListener('click', async ()=>{
        if (navigator.share) {
          try { await navigator.share({ title: document.title, url: currentUrl() }); } catch {}
        } else {
          // fallback to copy
          try { await navigator.clipboard.writeText(currentUrl()); } catch {}
        }
      });

      // Keep WhatsApp link and download cover in sync when language changes
      window.addEventListener('language-changed', () => {
        if (btnWhats) btnWhats.setAttribute('href', whatsappHref());
        if (btnDown) setDownloadLink(btnDown);
      });
    })();
  })();

  // Theme toggle: manual light/dark override with localStorage persistence
  // Note: 'system' mode temporarily disabled per request.
  const THEME_KEY = 'theme'; // 'light' | 'dark'
  const root = document.documentElement;
  const toggleBtn = document.getElementById('theme-toggle');
  function getEffectiveTheme() {
    const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  // System-follow disabled: default to dark if unset
  return 'dark';
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
      // Fallback: force dark (system mode disabled)
      theme = 'dark';
      root.setAttribute('data-theme', 'dark');
      root.setAttribute('data-theme-mode', 'dark');
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
    // Show tooltip as the action: switching to the other theme
    const nextInit = (savedTheme === 'dark') ? 'light' : 'dark';
    const actionText = nextInit === 'dark' ? t('theme_switch_to_dark') : t('theme_switch_to_light');
    toggleBtn.setAttribute('aria-label', t('theme_toggle_label'));
    toggleBtn.setAttribute('title', actionText);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      // Cycle through: dark -> light -> dark
      const current = localStorage.getItem(THEME_KEY) || 'dark';
      const order = ['dark','light'];
      const idx = order.indexOf(current);
      const next = order[(idx + 1) % order.length];
  applyTheme(next);
  // After switching, compute the next target again for tooltip
  const nextTarget = next === 'dark' ? 'light' : 'dark';
  const actionText2 = nextTarget === 'dark' ? t('theme_switch_to_dark') : t('theme_switch_to_light');
  toggleBtn.title = actionText2;
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
        // Persist and apply language regardless of presence of <select>
        try { localStorage.setItem('lang', code); } catch {}
        if (langSelect) { langSelect.value = code; }
        if (typeof translatePage === 'function') translatePage(code);
        setLangLabel();
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

  // Contact form: AJAX submission with static fallback
  (function enhanceContactForm(){
    const form = document.getElementById('contact-form');
    if (!form) return;
    const status = document.getElementById('form-status');
    const lang = localStorage.getItem('lang') || document.documentElement.lang || 'zh';
    function t(k){ try { return (window.translations?.[lang]?.[k]) || ''; } catch { return ''; } }
    // Slider verification wiring
    let verified = false;
    const slider = document.getElementById('slider-verify');
    if (slider) {
      const thumb = slider.querySelector('.slider-thumb');
      const track = slider;
      let dragging = false;
      let startX = 0;
      let startLeft = 0;
      const max = () => track.clientWidth - thumb.clientWidth;
      function setLeft(px){ thumb.style.left = Math.max(0, Math.min(max(), px)) + 'px'; }
      function complete(){
        verified = true;
        slider.classList.add('done');
        // lock thumb to end
        setLeft(max());
        thumb.style.cursor = 'default';
        thumb.style.background = 'color-mix(in oklab, var(--success) 20%, var(--surface))';
        slider.querySelector('.slider-track span')?.remove();
        const check = document.createElement('span');
        check.textContent = '✓';
        check.style.color = 'var(--success)';
        check.style.fontWeight = '700';
        check.style.fontSize = '1rem';
        const center = document.createElement('div');
        center.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:var(--success)';
        center.appendChild(check);
        slider.appendChild(center);
      }
      function onDown(e){ dragging = true; startX = (e.touches?e.touches[0].clientX:e.clientX); startLeft = parseFloat(thumb.style.left||'0'); thumb.style.cursor='grabbing'; e.preventDefault(); }
      function onMove(e){ if(!dragging) return; const x=(e.touches?e.touches[0].clientX:e.clientX); const dx=x-startX; setLeft(startLeft+dx); }
      function onUp(){ if(!dragging) return; dragging=false; thumb.style.cursor='grab'; if(parseFloat(thumb.style.left||'0')>=max()-4){ complete(); } else { setLeft(0); } }
      thumb.addEventListener('mousedown', onDown); thumb.addEventListener('touchstart', onDown, {passive:false});
      window.addEventListener('mousemove', onMove, {passive:false}); window.addEventListener('touchmove', onMove, {passive:false});
      window.addEventListener('mouseup', onUp); window.addEventListener('touchend', onUp);
    }
    // If redirected back with ?sent=1 (no-JS fallback), show success
    try {
      const url = new URL(location.href);
      if (url.searchParams.get('sent') === '1' && status) {
        status.hidden = false; status.className = 'alert success'; status.textContent = t('form_success');
      }
    } catch {}
    function validate(){
      const name = form.querySelector('#name');
      const email = form.querySelector('#email');
      const message = form.querySelector('#message');
      if (!name?.value || !email?.value || !message?.value){ return { ok:false, reason:'required' }; }
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      return ok ? { ok:true } : { ok:false, reason:'email' };
    }
    form.addEventListener('submit', async (e) => {
      // Progressive enhancement: use fetch if available
      if (!window.fetch) return; // fall back to default submit
      e.preventDefault();
      if (!verified) {
        if (status){ status.hidden = false; status.className = 'alert error'; status.textContent = t('verify_needed') || 'Please complete verification before submitting'; }
        return;
      }
      const v = validate();
      if (!v.ok){
        if (status){
          status.hidden = false; status.className = 'alert error';
          status.textContent = v.reason==='email'? t('form_invalid_email') : t('form_required');
        }
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      if (btn){ btn.disabled = true; btn.style.opacity = .7; }
      if (status){ status.hidden = false; status.className = 'alert'; status.textContent = '...'; }
      try {
        const data = new FormData(form);
        const res = await fetch(form.action, { method: 'POST', body: data, headers: { 'Accept': 'application/json' } });
        if (res.ok){
          form.reset();
          if (status){ status.className = 'alert success'; status.textContent = t('form_success'); }
        } else {
          throw new Error('send failed');
        }
      } catch {
        if (status){
          status.hidden = false; status.className = 'alert error';
          const email = 'fan.wan.uk@gmail.com';
          status.textContent = `${t('form_error')} ${email}`;
        }
      } finally {
        if (btn){ btn.disabled = false; btn.style.opacity = 1; }
      }
    });
  })();

  // Blog list page: switch card link and thumbnail per language
  (function syncBlogListCards(){
    const isBlogList = location.pathname.endsWith('/blog.html') || document.querySelector('main .blog-posts');
    if (!isBlogList) return;
    function apply() {
      const lang = localStorage.getItem('lang') || document.documentElement.lang || 'zh';
      document.querySelectorAll('.post-card').forEach(card => {
        const link = card.querySelector('a.post-link');
        const img = card.querySelector('img.post-thumb');
        // Determine the target href for this language from the primary link's data attributes
        let targetHref = '';
        if (link) {
          targetHref = link.getAttribute(`data-href-${lang}`) || link.getAttribute('href') || '';
          if (targetHref) link.setAttribute('href', targetHref);
        }
        // Also update the title link (inside h3) to point to the same language-specific URL
        const titleLink = card.querySelector('h3 a');
        if (titleLink && targetHref) {
          titleLink.setAttribute('href', targetHref);
        }
        if (img) {
          const src = img.getAttribute(`data-src-${lang}`) || img.getAttribute('src');
          if (src) img.setAttribute('src', src);
        }
      });
    }
    apply();
    window.addEventListener('language-changed', apply);
  })();

  // If landing on About page (or About section in home), trigger a one-off pop effect
  (function triggerAboutFxOnLoad(){
    const target = document.querySelector('.about-portrait.fx-reveal') || document.querySelector('.about-photo .fx-tilt');
    if (!target) return; // only on pages that have the element
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flag = (()=>{ try { return sessionStorage.getItem('triggerAboutFx'); } catch { return null; } })();
    if (prefersReduced) return; // respect reduced motion, image will show via CSS
    // Trigger on explicit nav intent or on page refresh/load directly (no flag)
    try { sessionStorage.removeItem('triggerAboutFx'); } catch {}
    triggerAboutReveal(target);
  })();

  function triggerAboutReveal(target){
    // If we have the reveal effect, use it; else fallback to pop
    if (target.classList && target.classList.contains('fx-reveal')){
      target.classList.remove('revealed');
      // force reflow
      void target.offsetWidth;
      target.classList.add('revealed');
    } else {
      target.classList.remove('fx-pop');
      void target.offsetWidth;
      target.classList.add('fx-pop');
      target.addEventListener('animationend', () => target.classList.remove('fx-pop'), { once: true });
    }
  }

  // About page: subtle parallax tilt + moving highlight on portrait
  (function parallaxPortrait(){
    const card = document.querySelector('.about-portrait.fx-tilt');
    if (!card) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    if (prefersReduced || !hasFinePointer) return; // skip on touch or reduced motion

    const maxTilt = 8; // degrees
    const damp = 18;    // lower = snappier
    let rx = 0, ry = 0; // current rotation
    let vx = 0, vy = 0; // velocity for smoothing
    let rafId = 0;

    function animate(){
      // exponential smoothing
      rx += (vx - rx) / damp;
      ry += (vy - ry) / damp;
      card.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      rafId = requestAnimationFrame(animate);
    }

    function onMove(e){
      const rect = card.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const x = (e.clientX - cx) / (rect.width / 2); // [-1,1]
      const y = (e.clientY - cy) / (rect.height / 2); // [-1,1]
      // target rotations (invert y for natural tilt)
      vy = Math.max(-maxTilt, Math.min(maxTilt, -y * maxTilt));
      vx = Math.max(-maxTilt, Math.min(maxTilt, x * maxTilt));
      // shift highlight with cursor (0%..100%)
      const px = `${50 + x * 20}%`;
      const py = `${50 + y * 20}%`;
      card.style.setProperty('--fx-x', px);
      card.style.setProperty('--fx-y', py);
    }

    function reset(){
      vx = vy = rx = ry = 0;
      card.style.transform = 'none';
      card.style.removeProperty('--fx-x');
      card.style.removeProperty('--fx-y');
    }

    card.addEventListener('mouseenter', () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(animate); });
    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseleave', () => { cancelAnimationFrame(rafId); reset(); });
  })();

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