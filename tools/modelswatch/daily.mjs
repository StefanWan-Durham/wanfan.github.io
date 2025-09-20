#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { info } from './log.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGithubTop } from './fetch_github.js';
import { fetchHFTop } from './fetch_hf.js';
import { SCHEMA_VERSION } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const dir = path.join(root, 'data/ai/modelswatch');
const archiveDir = path.join(dir, 'daily');

function readJSON(p){
  if(!existsSync(p)) return { items: [] };
  try{ return JSON.parse(readFileSync(p,'utf8')); }catch{ return { items: [] }; }
}
function writeJSON(p, obj){ writeFileSync(p, JSON.stringify(obj, null, 2)); }

// --- Lightweight .env loader (local only) ---
function loadDotEnv(){
  try{
    const envPath = path.join(root, '.env');
    if(!existsSync(envPath)) return;
    const txt = readFileSync(envPath, 'utf8');
    for(const line of txt.split(/\r?\n/)){
      const l = line.trim();
      if(!l || l.startsWith('#')) continue;
      const eq = l.indexOf('=');
      if(eq<=0) continue;
      const k = l.slice(0, eq).trim();
      const v = l.slice(eq+1).trim();
      if(!(k in process.env)) process.env[k] = v;
    }
  }catch{}
}
loadDotEnv();

// --- DeepSeek Chat summarizer (optional) ---
const DS_KEY = process.env.DEEPSEEK_API_KEY || '';
const DS_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DS_MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS||'768');
const LLM_CONN_TIMEOUT = Number(process.env.LLM_CONN_TIMEOUT||'30'); // seconds
const LLM_READ_TIMEOUT = Number(process.env.LLM_READ_TIMEOUT||'240'); // seconds

function withTimeout(ms){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(new Error('timeout')), ms);
  return { signal: controller.signal, clear: ()=>clearTimeout(timer) };
}

async function dsSummarizeLang(prompt, lang){
  if(!DS_KEY) throw new Error('DeepSeek API key missing');
  const url = `${DS_BASE}/chat/completions`;
  let system = '';
  if(lang==='zh') system = '你是资深AI编辑。请用中文为给定开源项目或模型撰写一段4-6句的精炼摘要，面向泛技术读者，避免营销语，突出用途、亮点与适用场景。限制在280字以内。';
  else if(lang==='en') system = 'You are a senior AI editor. Write a concise English summary (4-6 sentences, max ~280 chars) for the given open-source project or model, highlighting use cases, strengths, and applicability. No marketing fluff.';
  else if(lang==='es') system = 'Eres un editor técnico experto. Escribe un resumen breve en español (4-6 oraciones, máx ~280 caracteres) del proyecto o modelo de código abierto dado. Destaca usos, puntos fuertes y casos de uso. Evita marketing.';
  else system = 'You are a helpful editor. Write a concise summary.';
  const body = {
    model: DS_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: DS_MAX_TOKENS,
    temperature: 0.3
  };
  const { signal, clear } = withTimeout(LLM_READ_TIMEOUT*1000);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DS_KEY}`
    },
    body: JSON.stringify(body),
    signal
  });
  clear();
  if(!res.ok){ throw new Error('DeepSeek failed: '+res.status); }
  const data = await res.json();
  const txt = data?.choices?.[0]?.message?.content?.trim() || '';
  if(!txt) throw new Error('No content');
  return txt;
}

function truncateSummary(text){
  const t = String(text||'').replace(/\s+/g,' ').trim();
  return t.length>300 ? t.slice(0,297)+'…' : t;
}

async function smartSummarizeMulti(it){
  // Compose an LLM prompt with safe context
  const src = it.source||'github';
  const lines = [];
  lines.push(`名称: ${it.name||it.id||''}`);
  if(it.url) lines.push(`链接: ${it.url}`);
  if(it.license) lines.push(`协议: ${it.license}`);
  const stats = it.stats||{};
  const statBits = [];
  if(stats.stars) statBits.push(`Stars ${stats.stars}`);
  if(stats.forks) statBits.push(`Forks ${stats.forks}`);
  if(stats.hf_downloads_7d) statBits.push(`Downloads7d ${stats.hf_downloads_7d}`);
  if(stats.hf_likes) statBits.push(`Likes ${stats.hf_likes}`);
  if(statBits.length) lines.push(`指标: ${statBits.join(' · ')}`);
  if(Array.isArray(it.tags) && it.tags.length) lines.push(`标签: ${it.tags.slice(0,10).join(', ')}`);
  const desc = it.summary || it.description || it.card_desc || '';
  if(desc) lines.push(`简介: ${desc}`);
  const prompt = lines.join('\n');

  // Try DeepSeek; fallback to truncate if unavailable/failed
  try{
    const [zh, en, es] = await Promise.all([
      dsSummarizeLang(prompt, 'zh'),
      dsSummarizeLang(prompt, 'en'),
      dsSummarizeLang(prompt, 'es'),
    ]);
    return { zh, en, es };
  }catch{
    const base = truncateSummary(desc);
    return { zh: base, en: base, es: '' };
  }
}

// Simple semaphore to avoid hammering API
async function mapLimit(list, limit, fn){
  if(!Array.isArray(list) || list.length===0) return [];
  const out = new Array(list.length);
  let nextIndex = 0;
  let completed = 0;
  return new Promise((resolve) => {
    const runNext = () => {
      if (completed === list.length) { resolve(out); return; }
      while (nextIndex < list.length && (completed + (nextIndex - completed)) < completed + limit) {
        const cur = nextIndex++;
        Promise.resolve(fn(list[cur], cur))
          .then(v => { out[cur] = v; })
          .catch(() => { out[cur] = null; })
          .finally(() => { completed++; runNext(); });
      }
    };
    runNext();
  });
}

function pickTop(items, n){
  // Simple heuristic: sort by (7d growth, then score/stars/downloads)
  const sc = i => (i.stats?.stars_7d||i.stats?.hf_downloads_7d||0);
  const sec = i => (i.score||i.stats?.stars||i.stats?.hf_downloads||0);
  return [...items].sort((a,b)=> (sc(b)-sc(a)) || (sec(b)-sec(a)) ).slice(0,n);
}

// --- Category-aware diverse selection with cooldown/state ---
function loadCategories(){
  const p = path.join(dir,'categories.json');
  try{
    const j = JSON.parse(readFileSync(p,'utf8'));
    return j?.categories?.capabilities || [];
  }catch{ return []; }
}

function normCapsFromItem(it, knownCaps){
  const caps = it?.categories?.capabilities || [];
  // fallback: scan tags/summary/name for simple hints
  if(caps.length) return caps.filter(c=>knownCaps.includes(c));
  const text = `${it.name||''} ${(it.summary||'')} ${(it.tags||[]).join(' ')}`;
  const hints = [
    ['llm', /(\bllm\b|gpt|llama|mistral|qwen)/i],
    ['finetune', /(ft|fine ?tune|lora|adapter)/i],
    ['retrieval', /(rag|retriev|vector|rerank)/i],
    ['multimodal', /(multimodal|vision-language|vlm|音视频|多模态)/i],
    ['agent', /(agent|assistant|自动化|workflow)/i],
    ['asr', /(asr|speech[- ]?to[- ]?text|whisper|识别)/i],
    ['tts', /(tts|text[- ]?to[- ]?speech|合成)/i],
    ['speech', /(audio|speech)/i],
    ['vision', /(vision|视觉|detection|segmentation)/i],
    ['image', /(image|图像|sdxl|diffusion)/i],
    ['video', /(video|视频)/i],
    ['code_llm', /(code|coder|copilot|编程)/i],
    ['recommender', /(recommender|recommendation|推荐)/i],
    ['time_series', /(time series|时序|forecast)/i],
    ['graph_learning', /(graph|图 学|gnn)/i],
    ['safety', /(safety|安全|guardrail)/i],
    ['alignment', /(alignment|sft|rlhf|dpo|对齐)/i],
    ['redteaming', /(red ?team|越狱|攻击)/i],
    ['moderation', /(moderation|审查|过滤)/i],
    ['compression', /(compress|量化|剪枝|蒸馏|distill|int8|int4)/i],
    ['distillation', /(distill|蒸馏)/i],
  ];
  const out = new Set();
  for(const [k, re] of hints){ if(re.test(text) && knownCaps.includes(k)) out.add(k); }
  return [...out];
}

function buildQuotaFromCorpus(corpusItems, N, caps){
  const cnt = Object.fromEntries(caps.map(c=>[c,0]));
  let total=0;
  for(const it of corpusItems){
    const cs = normCapsFromItem(it, caps);
    const hit = cs.find(c=>cnt.hasOwnProperty(c));
    if(hit){ cnt[hit]++; total++; }
  }
  const q = Object.fromEntries(caps.map(c=>[c,0]));
  let sum=0;
  for(const c of caps){
    const part = total? (cnt[c]/total) : 0;
    q[c] = Math.max(1, Math.round(part*N));
    sum += q[c];
  }
  // normalize to N
  const keys = [...caps];
  while(sum>N){
    keys.sort((a,b)=>q[b]-q[a]);
    const c = keys[0];
    if(q[c]>1){ q[c]--; sum--; } else break;
  }
  while(sum<N){
    keys.sort((a,b)=>q[b]-q[a]);
    const c = keys[0]; q[c]++; sum++;
  }
  return q;
}

function loadRecentFromArchives(windowDays){
  // scan dates.json for last windowDays
  const datesPath = path.join(archiveDir, 'dates.json');
  const recentById = {};
  const recentByOwner = {};
  const byCatCount = {}; // key: capabilities::<cap>
  let dates=[];
  try{ dates = JSON.parse(readFileSync(datesPath,'utf8')); if(!Array.isArray(dates)) dates=[]; }catch{ dates=[]; }
  const pick = dates.slice(0, Math.min(windowDays, dates.length));
  for(const d of pick){
    const p = path.join(archiveDir, `${d}.json`);
    try{
      const j = JSON.parse(readFileSync(p,'utf8'));
      const arr = j?.items||[];
      for(const it of arr){
        const id = it.id || it.repo_id || it.url || it.name; if(!id) continue;
        recentById[id] = d;
        const owner = (it.owner || String(id).split('/')[0] || '').toLowerCase();
        if(owner) recentByOwner[owner] = d;
        const caps = (it.categories?.capabilities)||[];
        for(const c of caps){ byCatCount[`capabilities::${c}`] = (byCatCount[`capabilities::${c}`]||0)+1; }
      }
    }catch{ /* ignore */ }
  }
  return { recentById, recentByOwner, byCatCount };
}

function computeDeficit(quota, recentCatCount){
  const def = {};
  for(const c of Object.keys(quota)){
    const recent = (recentCatCount[`capabilities::${c}`]||0) / Math.max(1, 7);
    def[c] = Math.max(0, quota[c] - recent); // simple deficit
  }
  const maxv = Math.max(1, ...Object.values(def));
  for(const c in def) def[c] = def[c]/maxv; // normalize 0..1
  return def;
}

function selectDiverse(allItems, N, opts){
  const { recentById, recentByOwner, quota, alpha=1.0, cooldownDays=14, knownCaps=[] } = opts;
  const today = Date.now();
  const picked=[]; const pickedOwners=new Set();
  const deficit = computeDeficit(quota, opts.recentCatCount||{});
  function base(it){ const s=it.stats||{}; return (s.stars_7d||s.hf_downloads_7d||it.score||s.stars||s.hf_downloads||0); }
  function inCooldown(dateStr){ if(!dateStr) return false; const dt=Date.parse(dateStr); return (today - dt) < cooldownDays*86400000; }
  function capsOf(it){ const cs = normCapsFromItem(it, knownCaps); return cs.length?cs:[knownCaps[0]].filter(Boolean); }

  while(picked.length<N){
    const remainCaps = Object.entries(quota).filter(([c,v])=>v>0);
    let targetCap = remainCaps.length ? remainCaps.sort((a,b)=>(b[1]-a[1]))[0][0] : null;

    let candidates = allItems.filter(it=>{
      if(picked.some(p=>p.id===it.id)) return false;
      const owner = (it.owner||String(it.id||'').split('/')[0]||'').toLowerCase();
      if(pickedOwners.has(owner)) return false;
      if(inCooldown(recentById[it.id])) return false;
      if(inCooldown(recentByOwner[owner])) return false;
      if(targetCap){ const cs = capsOf(it); if(!cs.includes(targetCap)) return false; }
      return true;
    });
    if(!candidates.length && targetCap){
      candidates = allItems.filter(it=>{
        if(picked.some(p=>p.id===it.id)) return false;
        const owner = (it.owner||String(it.id||'').split('/')[0]||'').toLowerCase();
        if(pickedOwners.has(owner)) return false;
        if(inCooldown(recentById[it.id])) return false;
        if(inCooldown(recentByOwner[owner])) return false;
        return true;
      });
    }
    if(!candidates.length) break;

    const scored = candidates.map(it=>{
      const cs = capsOf(it);
      const gap = Math.max(0, ...cs.map(c=>deficit[c]||0));
      const gapBoost = 1 + alpha*gap;
      return { it, score: base(it)*gapBoost };
    }).sort((a,b)=>b.score-a.score);

    const chosen = scored[0].it;
    picked.push(chosen);
    const owner = (chosen.owner||String(chosen.id||'').split('/')[0]||'').toLowerCase();
    pickedOwners.add(owner);
    const cs = capsOf(chosen);
    const cap = targetCap && cs.includes(targetCap) ? targetCap : (cs[0]||null);
    if(cap && quota[cap]>0) quota[cap]--;
  }
  return picked;
}

async function main(){
  const nowDate = new Date();
  const now = nowDate.toISOString();
  // Use Beijing date (Asia/Shanghai, UTC+8) for archive/day keys
  const yyyyMmDd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(nowDate);
  let cg = readJSON(path.join(dir,'corpus.github.json')).items||[];
  let ch = readJSON(path.join(dir,'corpus.hf.json')).items||[];
  // Robustness: if corpus is missing/too small, fetch fresh tops directly
  try{
    if(!Array.isArray(cg) || cg.length < 6){
      // Try local weekly outputs first
      const tg = readJSON(path.join(dir,'top_github.json')).items||[];
      if(Array.isArray(tg) && tg.length >= 6) cg = tg;
    }
    if(!Array.isArray(cg) || cg.length < 6){
      const ghLive = await fetchGithubTop();
      if(Array.isArray(ghLive) && ghLive.length) cg = ghLive;
    }
  }catch{}
  try{
    if(!Array.isArray(ch) || ch.length < 6){
      const th = readJSON(path.join(dir,'top_hf.json')).items||[];
      if(Array.isArray(th) && th.length >= 6) ch = th;
    }
    if(!Array.isArray(ch) || ch.length < 6){
      const hfLive = await fetchHFTop();
      if(Array.isArray(hfLive) && hfLive.length) ch = hfLive;
    }
  }catch{}
  const N = Number(process.env.MODELSWATCH_DAILY_N||'6');
  const NGH = Number(process.env.MODELSWATCH_DAILY_GH_N||N);
  const NHF = Number(process.env.MODELSWATCH_DAILY_HF_N||N);
  const COOLDOWN = Number(process.env.MODELSWATCH_DAILY_COOLDOWN_DAYS||'14');
  const WINDOW = Number(process.env.MODELSWATCH_DAILY_HISTORY_WINDOW||'7');
  const ALPHA = Number(process.env.MODELSWATCH_DAILY_ALPHA||'1.0');

  // Load categories (capabilities only) and recent history
  const knownCaps = loadCategories();
  const recent = loadRecentFromArchives(WINDOW);
  try{
    writeJSON(path.join(dir,'state.json'), {
      cooldown_days: COOLDOWN,
      history_window_days: WINDOW,
      recent: {
        by_id: recent.recentById,
        by_owner: recent.recentByOwner,
        by_category_count: recent.byCatCount
      }
    });
  }catch{}

  // Build quotas from corpus distribution
  const quotaGH = buildQuotaFromCorpus(cg, NGH, knownCaps);
  const quotaHF = buildQuotaFromCorpus(ch, NHF, knownCaps);

  // Diverse selection per source
  const gTop = selectDiverse(cg, NGH, { ...recent, quota:{...quotaGH}, alpha: ALPHA, cooldownDays: COOLDOWN, knownCaps });
  const hTop = selectDiverse(ch, NHF, { ...recent, quota:{...quotaHF}, alpha: ALPHA, cooldownDays: COOLDOWN, knownCaps });
  info(`[daily] github candidates=${cg.length}, pick=${gTop.length}; hf candidates=${ch.length}, pick=${hTop.length}`);
  // Summarize with DeepSeek when available; limit concurrency to 3
  const gsum = await mapLimit(gTop, 3, async (it)=> {
    const { zh, en, es } = await smartSummarizeMulti(it);
    // Neutral prefers Chinese, then English, then Spanish, then existing/desc
    const neutral = zh || en || es || it.summary || it.description || '';
    return { ...it, summary: neutral, summary_en: en, summary_zh: zh, summary_es: es };
  });
  const hsum = await mapLimit(hTop, 3, async (it)=> {
    const { zh, en, es } = await smartSummarizeMulti(it);
    const neutral = zh || en || es || it.summary || it.description || '';
    return { ...it, summary: neutral, summary_en: en, summary_zh: zh, summary_es: es };
  });
  // --- Reason label & text augmentation ---
  function inferReasonLabel(it){
    const s = (it.summary||'').toLowerCase();
    const tags = (it.tags||[]).map(t=>String(t).toLowerCase());
    if((it.stats?.stars_7d||0) > 200 || (it.stats?.downloads_7d||0) > 5000000) return 'trending_growth';
    if(tags.includes('agent') || /agent/.test(s)) return 'agent_workflow';
    if(tags.includes('quantization') || /quantiz|int8|int4|量化/.test(s)) return 'model_optimization';
    if(/distill|蒸馏/.test(s)) return 'distillation';
    if(/benchmark|evaluation|leaderboard|榜/.test(s)) return 'benchmark_update';
    if(/security|安全|越狱|attack|防护/.test(s)) return 'security_safety';
    if(/release|v\d+\.\d+/.test(s)) return 'new_release';
    return 'notable';
  }
  function buildReasonText(it, label){
    const name = it.name||it.id;
    switch(label){
      case 'trending_growth': return `短期增速显著，活跃度激增：${name}`;
      case 'agent_workflow': return `Agent/工作流相关能力突出：${name}`;
      case 'model_optimization': return `模型优化/量化相关实践：${name}`;
      case 'distillation': return `蒸馏/轻量化成果：${name}`;
      case 'benchmark_update': return `基准测试/评测更新：${name}`;
      case 'security_safety': return `安全与对齐相关更新：${name}`;
      case 'new_release': return `新版本发布：${name}`;
      default: return `值得关注的项目：${name}`;
    }
  }
  function decorate(items){
    return items.map(it=>{
      const label = inferReasonLabel(it);
      const reason = buildReasonText(it, label);
      return { ...it, reason_label: label, reason_text: reason };
    });
  }
  const gDecorated = decorate(gsum);
  const hDecorated = decorate(hsum);
  writeJSON(path.join(dir,'daily_github.json'), { version:SCHEMA_VERSION, updated_at: now, items: gDecorated });
  writeJSON(path.join(dir,'daily_hf.json'), { version:SCHEMA_VERSION, updated_at: now, items: hDecorated });
  info(`[daily] wrote daily_github.json=${gsum.length}, daily_hf.json=${hsum.length}`);

  // --- Write combined archive for calendar browsing ---
  try{
    // ensure archiveDir exists
    try{ await import('fs/promises').then(fs=>fs.mkdir(archiveDir, { recursive: true })); }catch{}
  const combined = { version:SCHEMA_VERSION, date: yyyyMmDd, updated_at: now, items: [...gDecorated, ...hDecorated] };
    const archivePath = path.join(archiveDir, `${yyyyMmDd}.json`);
    writeJSON(archivePath, combined);
  info(`[daily] archived ${combined.items.length} items -> ${archivePath}`);

    // maintain dates.json (most-recent-first, unique)
    const datesPath = path.join(archiveDir, 'dates.json');
    let dates = [];
    if(existsSync(datesPath)){
      try{ dates = JSON.parse(readFileSync(datesPath,'utf8')); if(!Array.isArray(dates)) dates = []; }catch{ dates=[]; }
    }
    if(!dates.includes(yyyyMmDd)){
      dates.unshift(yyyyMmDd);
      // Trim to a reasonable length to keep repo small
      if(dates.length>120) dates = dates.slice(0,120);
      writeJSON(datesPath, dates);
  info(`[daily] updated dates.json (${dates.length} dates)`);
    }
  }catch(e){ console.warn('[daily] archive write failed:', e.message||e); }
}

main().catch(e=>{ console.error(e); process.exit(1); });
