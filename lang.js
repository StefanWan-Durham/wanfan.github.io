/*
 * Simple multilingual support for Fan Wan's personal website.
 *
 * This script defines translation dictionaries for Chinese (zh), English (en)
 * and Spanish (es). Each piece of text on the page is associated with a
 * `data-i18n` attribute whose value corresponds to a key in the
 * dictionaries below. Input placeholders are annotated using the
 * `data-i18n-placeholder` attribute. When the language selector changes or
 * when the page loads, the script updates the text and placeholders to
 * reflect the chosen language. The selected language is persisted in
 * localStorage so that navigation between pages retains the user's
 * preference.
 */

const translations = {
  zh: {
    // Global
    site_title: '万凡 · 个人网站',
    nav_home: '首页',
    nav_about: '关于我',
    nav_research: '学术出版物',
    nav_blog: '博客',
  nav_contact: '联系我',
  nav_ai_lab: 'AI Lab',
  ai_lab_title: 'AI Lab',
  ai_lab_intro: '自动资讯与报告 · 站内智能小应用',
  ai_lab_news_title: '自动资讯 & 报告',
  ai_lab_news_desc: '机器替你读每天：AI Daily、快讯雷达、论文一页纸、模型与工具追踪等。',
  ai_lab_daily_title: 'AI Daily · 每日一更',
  ai_lab_empty: '暂无数据，敬请期待。',
  ai_lab_apps_title: '站内智能小应用',
  ai_lab_apps_desc: 'AI Teacher、Ask My Site、Long-form to Slides/Audio 等交互 Demo。',
  coming_soon: '功能开发中，敬请期待…',
    // Hero
    hero_title: '你好，我是万凡',
  hero_subtitle: '杜伦大学计算机科学专业博士 — 打造可靠、可控、可解释的 AI 系统。',
  hero_btn_contact: '联系我',
  hero_btn_selected: '精选作品',
  hero_btn_cv: '下载简历',
    // Home – About summary
    about_title: '关于我',
    about_p1: '我是一名专注于大语言模型产业化的研究者，获英国纽卡斯尔大学硕士、杜伦大学计算机科学博士（2025），曾任杜伦大学 HI-Lab 实验室主管。我的目标是把研究做成可运行的系统：让模型理解企业知识、保护隐私，并给出可验证答案。',
    about_p2: '当前在一家中央企业从事 AI 研发，与产品和业务团队协作，将前沿方法打磨为稳定、可运维的能力。我的方法论是 可复现、可评测、可维护。近期工作聚焦于知识增强型 LLM、联邦学习、以及 LLM 微调与下游任务，并通过复盘与开源持续推进迭代。',
    // Research summary
    research_title: '学术出版物',
    research_desc: '我在机器学习、计算机视觉和多媒体分析等领域发表了多篇论文，涵盖联邦学习、神经辐射场和零样本学习等主题。点击下方按钮查看完整列表。',
    research_btn: '查看研究成果',
    // Blog summary
  blog_title: '博客',
  blog_subtitle: '关于人工智能、研究和工程的笔记',
    blog_desc: '在这里，我将分享关于机器学习、计算机视觉、大语言模型以及职业发展的思考与心得。敬请期待我的最新文章。',
    blog_btn: '进入博客',
    blog_coming_soon_title: '敬请期待',
    blog_coming_soon_desc: '博客内容正在筹备中，请稍后再来。',
  // Portfolio
  portfolio_title: '作品集',
  portfolio_filter_all: '全部',
  portfolio_filter_llm: 'LLM',
  portfolio_filter_cv: 'CV',
    // Contact summary
    contact_title: '联系我',
    contact_desc: '如果你对合作或交流感兴趣，欢迎通过邮件或社交媒体与我取得联系。',
    contact_btn: '联系页面',
  contact_or_email: '或通过邮箱：',
  // Footer CTA
  footer_cta_title: '一起合作？',
  footer_cta_desc: '我可提供 LLM 应用、计算机视觉与多媒体分析相关的咨询与合作。',
    // Biography page
    bio_title: '个人简介',
    bio_p1: '我是一名专注于大语言模型产业化的研究者，获英国纽卡斯尔大学硕士、杜伦大学计算机科学博士（2025），曾任杜伦大学 HI-Lab 实验室主管。我的目标是把研究做成可运行的系统：让模型理解企业知识、保护隐私，并给出可验证答案。',
    bio_p2: '当前在一家中央企业从事 AI 研发，与产品和业务团队协作，将前沿方法打磨为稳定、可运维的能力。我的方法论是 可复现、可评测、可维护。近期工作聚焦于知识增强型 LLM、联邦学习、以及 LLM 微调与下游任务，并通过复盘与开源持续推进迭代。',
    education_title: '教育经历',
    edu_phd_title: '杜伦大学 · 博士 (2020.10 – 2025.01)',
    edu_phd_desc: '计算机科学专业，研究方向涵盖计算机视觉、多模态算法和大语言模型。',
    edu_msc_title: '纽卡斯尔大学 · 硕士 (2017.09 – 2018.08)',
    edu_msc_desc: '计算机科学专业，以优秀成绩毕业，主修编程、数据库和软件工程等课程。',
    edu_bsc_title: '山西农业大学 · 学士 (2013.09 – 2017.07)',
    edu_bsc_desc: '软件工程专业，掌握数据结构、计算机网络、Web 开发等基础课程。',
    interests_title: '研究兴趣',
    interest_ml: '机器学习与联邦学习',
    interest_cv: '计算机视觉与多媒体分析',
    interest_llm: '大语言模型与 AI 智能体',
    interest_privacy: '隐私保护算法与分布式 AI',
  publications_more_title: '更多论文',
  co_corresponding: '\u2020共同通讯',
  co_first: '*共同一作',
  phd_thesis: '博士学位论文',
    // Share UI
    share_label: '分享',
    share_wechat: '微信',
    share_whatsapp: 'WhatsApp',
    share_copy: '复制链接',
    share_copied: '已复制',
    share_download: '下载封面',
    share_share: '系统分享',
    share_close: '关闭',
    share_wechat_qr_tip: '使用微信“扫一扫”分享本文',
    // Publications page
    publications_list_title: '代表性论文',
  view_pdf: '在线阅读 PDF',
  download_pdf: '下载 PDF',
  pdf_viewer_title: 'PDF 阅读器',
  pdf_not_found: '未找到 PDF 文件',
    // Contact form
    form_name: '姓名',
    form_name_placeholder: '你的名字',
    form_email: '邮箱',
    form_email_placeholder: '你的邮箱',
    form_message: '留言',
    form_message_placeholder: '你的留言',
  form_send: '发送',
  form_success: '已发送！我会尽快回复你。',
  form_error: '发送失败，请稍后重试或直接邮件至：',
  form_required: '请填写所有必填项',
  form_invalid_email: '邮箱格式不正确'
  ,
  // Contact verification
  verify_title: '验证',
  verify_slide_label: '向右滑动完成验证',
  verify_needed: '请先完成验证再提交',
  // Theme toggle
  theme_toggle_label: '主题切换',
  theme_mode_system: '跟随系统',
  theme_mode_dark: '深色模式',
  theme_mode_light: '浅色模式',
  theme_switch_to_light: '切换为浅色模式',
  theme_switch_to_dark: '切换为深色模式'
  },
  en: {
    site_title: 'Fan Wan · Personal Website',
    nav_home: 'Home',
    nav_about: 'About',
    nav_research: 'Research',
    nav_blog: 'Blog',
  nav_contact: 'Contact',
  nav_ai_lab: 'AI Lab',
  ai_lab_title: 'AI Lab',
  ai_lab_intro: 'Automated Briefings · In-site AI Apps',
  ai_lab_news_title: 'Automated Briefings & Reports',
  ai_lab_news_desc: 'Daily AI read: AI Daily, News Radar, Paper Digest, and Release Tracker.',
  ai_lab_daily_title: 'AI Daily · Daily Update',
  ai_lab_empty: 'No data yet. Stay tuned.',
  ai_lab_apps_title: 'In-site AI Apps',
  ai_lab_apps_desc: 'AI Teacher, Ask My Site, and Long-form to Slides/Audio demos.',
  coming_soon: 'Coming soon…',
    hero_title: "Hi, I'm Fan Wan",
  hero_subtitle: 'Durham CS PhD — Engineering Trustworthy, Controllable, Explainable AI.',
  hero_btn_contact: 'Contact me',
  hero_btn_selected: 'Selected Work',
  hero_btn_cv: 'Download CV',
    about_title: 'About Me',
    about_p1: "I obtained my Master’s degree in Computer Science from Newcastle University in 2018 (with distinction) and completed my Ph.D. in Computer Science at Durham University in January 2025. I currently work as a researcher at Tongfang Knowledge Network Digital Technology Co., Ltd., part of China National Nuclear Corporation.",
    about_p2: 'My research focuses on applying large language models (LLMs) in real-world nuclear industry scenarios. I am passionate about machine learning, computer vision, multimedia analysis and developing LLM-based agents and downstream tasks.',
    research_title: 'Research Publications',
    research_desc: 'I have published several papers in areas such as machine learning, computer vision and multimedia analysis, covering topics like federated learning, neural radiance fields and zero-shot learning. Click the button below to view the full list.',
    research_btn: 'View Research',
  blog_title: 'Blog',
  blog_subtitle: 'Notes on AI, research, and engineering',
    blog_desc: 'Here I will share my thoughts and insights on machine learning, computer vision, large language models and career development. Stay tuned for my latest posts.',
    blog_btn: 'Visit Blog',
    blog_coming_soon_title: 'Coming Soon',
    blog_coming_soon_desc: 'Blog content is being prepared, please come back later.',
  // Portfolio
  portfolio_title: 'Portfolio',
  portfolio_filter_all: 'All',
  portfolio_filter_llm: 'LLM',
  portfolio_filter_cv: 'CV',
    contact_title: 'Contact Me',
    contact_desc: 'If you are interested in collaboration or communication, feel free to contact me via email or social media.',
    contact_btn: 'Contact Page',
  contact_or_email: 'Or email:',
  // Footer CTA
  footer_cta_title: 'Collaborate?',
  footer_cta_desc: 'I can help with LLM applications, computer vision and multimedia analysis.',
    bio_title: 'Biography',
    bio_p1: "I obtained my Master’s degree in Computer Science from Newcastle University in 2018 (with distinction) and completed my Ph.D. in Computer Science at Durham University in January 2025. During my doctoral studies, I focused on computer vision and multimodal algorithms and actively explored large language models and their applications to real-world problems.",
    bio_p2: 'Currently, I work as a researcher at Tongfang Knowledge Network Digital Technology Co., Ltd., part of China National Nuclear Corporation, dedicated to applying large language models to nuclear industry scenarios. I am passionate about machine learning, federated learning, computer vision, multimedia analysis and AIGC technologies, and participate in various interdisciplinary collaborations.',
    education_title: 'Education',
    edu_phd_title: 'Durham University · Ph.D. (Oct 2020 – Jan 2025)',
    edu_phd_desc: 'Computer Science with a focus on computer vision, multimodal algorithms and large language models.',
    edu_msc_title: 'Newcastle University · M.Sc. (Sep 2017 – Aug 2018)',
    edu_msc_desc: 'Computer Science, graduated with distinction; major courses included programming, databases and software engineering.',
    edu_bsc_title: 'Shanxi Agricultural University · B.Sc. (Sep 2013 – Jul 2017)',
    edu_bsc_desc: 'Software Engineering, learned fundamentals such as data structures, computer networks and web development.',
    interests_title: 'Research Interests',
    interest_ml: 'Machine Learning & Federated Learning',
    interest_cv: 'Computer Vision & Multimedia Analysis',
    interest_llm: 'Large Language Models & AI Agents',
    interest_privacy: 'Privacy‑Preserving Algorithms & Distributed AI',
    publications_list_title: 'Selected Publications',
  publications_more_title: 'More Publications',
  co_corresponding: '\u2020Co‑corresponding',
  co_first: '*Co‑first author',
  phd_thesis: 'Ph.D. thesis',
    // Share UI
    share_label: 'Share',
    share_wechat: 'WeChat',
    share_whatsapp: 'WhatsApp',
    share_copy: 'Copy link',
    share_copied: 'Copied',
    share_download: 'Download cover',
    share_share: 'Share…',
    share_close: 'Close',
    share_wechat_qr_tip: 'Scan in WeChat to share this post',
  view_pdf: 'View PDF',
  download_pdf: 'Download PDF',
  pdf_viewer_title: 'PDF Viewer',
  pdf_not_found: 'PDF not available',
    form_name: 'Name',
    form_name_placeholder: 'Your name',
    form_email: 'Email',
    form_email_placeholder: 'Your email',
    form_message: 'Message',
    form_message_placeholder: 'Your message',
  form_send: 'Send',
  form_success: 'Sent! I will get back to you soon.',
  form_error: 'Failed to send. Please try again later or email me at:',
  form_required: 'Please fill in all required fields',
  form_invalid_email: 'Invalid email address',
  // Contact verification
  verify_title: 'Verification',
  verify_slide_label: 'Slide right to verify',
  verify_needed: 'Please complete verification before submitting',
  // Theme toggle
  theme_toggle_label: 'Toggle theme',
  theme_mode_system: 'Follow system',
  theme_mode_dark: 'Dark mode',
  theme_mode_light: 'Light mode',
  theme_switch_to_light: 'Switch to light theme',
  theme_switch_to_dark: 'Switch to dark theme'
  },
  es: {
    site_title: 'Fan Wan · Sitio personal',
    nav_home: 'Inicio',
    nav_about: 'Acerca de',
    nav_research: 'Investigación',
    nav_blog: 'Blog',
  nav_contact: 'Contacto',
  nav_ai_lab: 'AI Lab',
  ai_lab_title: 'AI Lab',
  ai_lab_intro: 'Informes automáticos · Apps de IA en el sitio',
  ai_lab_news_title: 'Informes automáticos y resúmenes',
  ai_lab_news_desc: 'Lectura diaria: AI Daily, Radar de noticias, Resumen de papers y seguimiento de lanzamientos.',
  ai_lab_daily_title: 'AI Daily · Actualización diaria',
  ai_lab_empty: 'Sin datos por ahora. Próximamente.',
  ai_lab_apps_title: 'Apps de IA en el sitio',
  ai_lab_apps_desc: 'AI Teacher, Ask My Site y demo de convertir a diapositivas/audio.',
  coming_soon: 'Próximamente…',
    hero_title: 'Hola, soy Fan Wan',
  hero_subtitle: 'Ph.D. en Ciencias de la Computación (Durham) — Ingeniería de IA confiable, controlable y explicable.',
  hero_btn_contact: 'Contáctame',
  hero_btn_selected: 'Trabajos destacados',
  hero_btn_cv: 'Descargar CV',
    about_title: 'Sobre mí',
    about_p1: 'Obtuve mi maestría en Ciencias de la Computación en la Universidad de Newcastle en 2018 (con distinción) y completé mi doctorado en Ciencias de la Computación en la Universidad de Durham en enero de 2025. Actualmente trabajo como investigador en Tongfang Knowledge Network Digital Technology Co., Ltd., parte de la Corporación Nacional Nuclear de China.',
    about_p2: 'Mi investigación se centra en aplicar modelos de lenguaje grandes (LLM) en escenarios reales de la industria nuclear. Me apasionan el aprendizaje automático, la visión por computadora, el análisis multimedia y el desarrollo de agentes basados en LLM y tareas posteriores.',
    research_title: 'Publicaciones de investigación',
    research_desc: 'He publicado varios trabajos en áreas como aprendizaje automático, visión por computadora y análisis multimedia, cubriendo temas como aprendizaje federado, campos de radiancia neural y aprendizaje de cero muestras. Haga clic en el botón de abajo para ver la lista completa.',
    research_btn: 'Ver investigación',
  blog_title: 'Blog',
  blog_subtitle: 'Notas sobre IA, investigación e ingeniería',
    blog_desc: 'Aquí compartiré mis pensamientos e ideas sobre aprendizaje automático, visión por computadora, modelos de lenguaje grandes y desarrollo profesional. Mantente al tanto de mis publicaciones más recientes.',
    blog_btn: 'Visitar blog',
    blog_coming_soon_title: 'Próximamente',
    blog_coming_soon_desc: 'El contenido del blog está en preparación, por favor vuelve más tarde.',
  // Portfolio
  portfolio_title: 'Portafolio',
  portfolio_filter_all: 'Todo',
  portfolio_filter_llm: 'LLM',
  portfolio_filter_cv: 'CV',
    contact_title: 'Contáctame',
    contact_desc: 'Si estás interesado en colaborar o conversar, no dudes en contactarme por correo electrónico o redes sociales.',
    contact_btn: 'Página de contacto',
  contact_or_email: 'O por correo:',
  // Footer CTA
  footer_cta_title: '¿Colaboramos?',
  footer_cta_desc: 'Puedo ayudar con aplicaciones LLM, visión por computadora y análisis multimedia.',
    bio_title: 'Biografía',
    bio_p1: 'Obtuve mi maestría en Ciencias de la Computación en la Universidad de Newcastle en 2018 (con distinción) y completé mi doctorado en Ciencias de la Computación en la Universidad de Durham en enero de 2025. Durante mis estudios de doctorado me enfoqué en visión por computadora y algoritmos multimodales y exploré activamente modelos de lenguaje grandes y sus aplicaciones a problemas reales.',
    bio_p2: 'Actualmente trabajo como investigador en Tongfang Knowledge Network Digital Technology Co., Ltd., parte de la Corporación Nacional Nuclear de China, dedicado a aplicar modelos de lenguaje grandes a los escenarios de la industria nuclear. Me apasionan el aprendizaje automático, el aprendizaje federado, la visión por computadora, el análisis multimedia y las tecnologías AIGC, y participo en diversas colaboraciones interdisciplinarias.',
    education_title: 'Educación',
    edu_phd_title: 'Universidad de Durham · Doctorado (octubre 2020 – enero 2025)',
    edu_phd_desc: 'Ciencias de la Computación, con enfoque en visión por computadora, algoritmos multimodales y modelos de lenguaje grandes.',
    edu_msc_title: 'Universidad de Newcastle · Maestría (septiembre 2017 – agosto 2018)',
    edu_msc_desc: 'Ciencias de la Computación, graduado con distinción; cursos principales como programación, bases de datos e ingeniería de software.',
    edu_bsc_title: 'Universidad Agrícola de Shanxi · Licenciatura (septiembre 2013 – julio 2017)',
    edu_bsc_desc: 'Ingeniería de Software, aprendió fundamentos incluyendo estructuras de datos, redes informáticas y desarrollo web.',
    interests_title: 'Intereses de investigación',
    interest_ml: 'Aprendizaje automático y aprendizaje federado',
    interest_cv: 'Visión por computadora y análisis multimedia',
    interest_llm: 'Modelos de lenguaje grandes y agentes de IA',
    interest_privacy: 'Algoritmos de preservación de privacidad y IA distribuida',
    publications_list_title: 'Publicaciones seleccionadas',
  publications_more_title: 'Más publicaciones',
  co_corresponding: '\u2020Autor corresponsal conjunto',
  co_first: '*Autor/a co‑principal',
  phd_thesis: 'Tesis doctoral',
    // Share UI
    share_label: 'Compartir',
    share_wechat: 'WeChat',
    share_whatsapp: 'WhatsApp',
    share_copy: 'Copiar enlace',
    share_copied: 'Copiado',
    share_download: 'Descargar portada',
    share_share: 'Compartir…',
    share_close: 'Cerrar',
    share_wechat_qr_tip: 'Escanea en WeChat para compartir este artículo',
  view_pdf: 'Ver PDF',
  download_pdf: 'Descargar PDF',
  pdf_viewer_title: 'Visor de PDF',
  pdf_not_found: 'PDF no disponible',
    form_name: 'Nombre',
    form_name_placeholder: 'Tu nombre',
    form_email: 'Correo electrónico',
    form_email_placeholder: 'Tu correo electrónico',
    form_message: 'Mensaje',
    form_message_placeholder: 'Tu mensaje',
  form_send: 'Enviar',
  form_success: '¡Enviado! Te responderé pronto.',
  form_error: 'No se pudo enviar. Inténtalo más tarde o escríbeme a:',
  form_required: 'Completa los campos obligatorios',
  form_invalid_email: 'Correo electrónico no válido',
  // Contact verification
  verify_title: 'Verificación',
  verify_slide_label: 'Desliza a la derecha para verificar',
  verify_needed: 'Completa la verificación antes de enviar',
  // Theme toggle
  theme_toggle_label: 'Cambiar tema',
  theme_mode_system: 'Seguir sistema',
  theme_mode_dark: 'Modo oscuro',
  theme_mode_light: 'Modo claro',
  theme_switch_to_light: 'Cambiar a modo claro',
  theme_switch_to_dark: 'Cambiar a modo oscuro'
  }
};

/**
 * Apply translations to all elements annotated with data-i18n and
 * data-i18n-placeholder attributes. The HTML document's lang attribute
 * will also be updated accordingly.
 *
 * @param {string} lang The language code to apply (zh, en or es).
 */
function translatePage(lang) {
  // Set the lang attribute on the document root
  document.documentElement.setAttribute('lang', lang);
  // Translate text content
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      el.textContent = translations[lang][key];
    }
  });
  // Translate placeholders
  const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
  placeholders.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (translations[lang] && translations[lang][key]) {
      el.setAttribute('placeholder', translations[lang][key]);
    }
  });
  // Update the document title if it has data-i18n attribute
  const titleEl = document.querySelector('title[data-i18n]');
  if (titleEl) {
    const key = titleEl.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      titleEl.textContent = translations[lang][key];
    }
  }

  // Update theme toggle tooltip/title
  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    const mode = localStorage.getItem('theme') || 'system';
    const modeText = mode === 'system' ? translations[lang].theme_mode_system
                     : mode === 'dark' ? translations[lang].theme_mode_dark
                     : translations[lang].theme_mode_light;
    toggleBtn.setAttribute('aria-label', translations[lang].theme_toggle_label);
    toggleBtn.setAttribute('title', `${translations[lang].theme_toggle_label}（${modeText}）`);
  }

  // Update language button text without removing its icon
  const langBtn = document.getElementById('lang-button');
  if (langBtn) {
    const map = { en: 'English', zh: '中文', es: 'Español' };
    const labelEl = langBtn.querySelector('.label');
    const cur = localStorage.getItem('lang') || 'en';
    if (labelEl) labelEl.textContent = `Language` + (map[cur] ? ` · ${map[cur]}` : '');
    else langBtn.textContent = `Language` + (map[cur] ? ` · ${map[cur]}` : '');
  }

  // Notify others that language changed (for components needing rerender)
  try { window.dispatchEvent(new CustomEvent('language-changed', { detail: { lang } })); } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  const langSelect = document.getElementById('lang-select');
  // Prefer user's saved choice, else the document's declared language, else zh
  const defaultLang = localStorage.getItem('lang') || document.documentElement.lang || 'zh';
  // Expose for other scripts
  try { window.translations = translations; } catch {}
  translatePage(defaultLang);
  if (langSelect) {
    langSelect.value = defaultLang;
    langSelect.addEventListener('change', () => {
      const selected = langSelect.value;
      localStorage.setItem('lang', selected);
      translatePage(selected);
    });
  }
});