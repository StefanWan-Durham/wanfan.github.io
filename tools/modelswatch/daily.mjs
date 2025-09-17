#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGithubTop } from './fetch_github.js';
import { fetchHFTop } from './fetch_hf.js';

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

async function dsSummarizeChinese(prompt){
  if(!DS_KEY) throw new Error('DeepSeek API key missing');
  const url = `${DS_BASE}/chat/completions`;
  const body = {
    model: DS_MODEL,
    messages: [
      { role: 'system', content: '你是资深AI编辑。请用中文为给定开源项目或模型撰写一段4-6句的精炼摘要，面向泛技术读者，避免营销语，突出用途、亮点与适用场景。限制在280字以内。' },
      { role: 'user', content: prompt }
    ],
    max_tokens: DS_MAX_TOKENS,
    temperature: 0.3
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DS_KEY}`
    },
    body: JSON.stringify(body)
  });
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

async function smartSummarize(it){
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
    const s = await dsSummarizeChinese(prompt);
    return s;
  }catch{
    return truncateSummary(desc);
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

async function main(){
  const now = new Date().toISOString();
  const yyyyMmDd = now.slice(0,10);
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
  const gTop = pickTop(cg, 6);
  const hTop = pickTop(ch, 6);
  console.log(`[daily] github candidates=${cg.length}, pick=${gTop.length}; hf candidates=${ch.length}, pick=${hTop.length}`);
  // Summarize with DeepSeek when available; limit concurrency to 3
  const gsum = await mapLimit(gTop, 3, async (it)=> ({...it, summary: await smartSummarize(it)}));
  const hsum = await mapLimit(hTop, 3, async (it)=> ({...it, summary: await smartSummarize(it)}));
  writeJSON(path.join(dir,'daily_github.json'), { updated_at: now, items: gsum });
  writeJSON(path.join(dir,'daily_hf.json'), { updated_at: now, items: hsum });
  console.log(`[daily] wrote daily_github.json=${gsum.length}, daily_hf.json=${hsum.length}`);

  // --- Write combined archive for calendar browsing ---
  try{
    // ensure archiveDir exists
    try{ await import('fs/promises').then(fs=>fs.mkdir(archiveDir, { recursive: true })); }catch{}
    const combined = { date: yyyyMmDd, updated_at: now, items: [...gsum, ...hsum] };
    const archivePath = path.join(archiveDir, `${yyyyMmDd}.json`);
    writeJSON(archivePath, combined);
    console.log(`[daily] archived ${combined.items.length} items -> ${archivePath}`);

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
      console.log(`[daily] updated dates.json (${dates.length} dates)`);
    }
  }catch(e){ console.warn('[daily] archive write failed:', e.message||e); }
}

main().catch(e=>{ console.error(e); process.exit(1); });
