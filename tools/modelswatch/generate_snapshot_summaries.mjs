/**
 * generate_snapshot_summaries.mjs
 * Inject tri-lingual summaries into today's snapshots (hf.json + gh.json) using incremental cache.
 * Strategy: compute content hash per item; reuse cached summaries if hash unchanged; otherwise call LLM once returning JSON {summary_en, summary_zh, summary_es}.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { summarizeTriJSON } from './summarize_multi.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const CACHE_FILE = path.join(DATA_DIR, 'summary_cache.json');
const CORPUS_GH = path.join(DATA_DIR, 'corpus.github.json');
const CORPUS_HF = path.join(DATA_DIR, 'corpus.hf.json');
const SCHEMA_VERSION = 1;

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MAX_CONCURRENCY = Number(process.env.SUMMARY_MAX_CONCURRENCY || 3);

function readJSON(p){ try{return JSON.parse(fs.readFileSync(p,'utf-8'));}catch{return null;} }
function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj,null,2)); }
function todayKey(){ const d=new Date(); const tz = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d); return tz; }
function hashItem(it){
  const stats = it.stats||{};
  const fields = [it.id||'', it.name||'', it.source||'', (it.description||'').slice(0,4000), (it.summary||'').slice(0,4000), (it.tags||[]).sort().join(','), stats.stars||stats.downloads||stats.likes||'', stats.downloads||'', stats.likes||'', it.updated_at||''];
  const h = crypto.createHash('sha256').update(fields.join('|')).digest('hex');
  return 'sha256:'+h;
}
function ensureCache(){ const c = readJSON(CACHE_FILE); if(!c||typeof c!=='object'||!c.models){ return { schema_version: SCHEMA_VERSION, generated_at:'', models:{} }; } return c; }

function buildPrompt(it){
  const stats = it.stats||{}; const statBits=[];
  if(stats.stars) statBits.push(`Stars ${stats.stars}`);
  if(stats.forks) statBits.push(`Forks ${stats.forks}`);
  if(stats.downloads_total) statBits.push(`DownloadsTotal ${stats.downloads_total}`);
  if(stats.downloads_7d) statBits.push(`Downloads7d ${stats.downloads_7d}`);
  if(stats.likes_total) statBits.push(`Likes ${stats.likes_total}`);
  const desc = it.summary || it.description || '';
  return `PROJECT ID: ${it.id}\nNAME: ${it.name||it.id}\nSOURCE: ${it.source}\nURL: ${it.url||''}\nTAGS: ${(it.tags||[]).slice(0,20).join(', ')}\nSTATS: ${statBits.join(' · ')}\nRAW_DESC: ${desc}`.slice(0,4000);
}

// llmRequest now delegates to shared summarizeTriJSON
const llmRequest = summarizeTriJSON;

async function mapLimit(arr, limit, fn){
  const out=new Array(arr.length); let i=0; let running=0; return await new Promise(resolve=>{ const step=()=>{ while(i<arr.length && running<limit){ const idx=i++; running++; Promise.resolve(fn(arr[idx],idx)).then(v=>out[idx]=v).catch(()=>out[idx]=null).finally(()=>{ running--; if(i>=arr.length && running===0) resolve(out); else step(); }); } }; step(); }); }

async function main(){
  console.log('[snapshot-summaries] starting');
  const day = todayKey();
  const dayDir = path.join(SNAP_DIR, day);
  const hfSnapPath = path.join(dayDir,'hf.json');
  const ghSnapPath = path.join(dayDir,'gh.json');
  const hfSnap = readJSON(hfSnapPath) || {}; // id -> {downloads, likes, ...}
  const ghSnap = readJSON(ghSnapPath) || {}; // id -> {stars, forks, ...}
  // Load corpus metadata to construct meaningful prompts
  const corpusHF = (readJSON(CORPUS_HF)?.items)||[];
  const corpusGH = (readJSON(CORPUS_GH)?.items)||[];
  // Merge: only include items that appear in today's snapshot (ensures recent relevance / stats present)
  const itemsHF = corpusHF.filter(it=>it && (it.id||it.repo_id||it.name) && hfSnap[(it.id||it.repo_id||it.name)]).map(it=>{
    const id = it.id || it.repo_id || it.name; const statsRaw = hfSnap[id] || {}; const mergedStats = { ...(it.stats||{}), downloads_total: statsRaw.downloads, likes_total: statsRaw.likes };
    return { ...it, id, source: 'hf', stats: mergedStats };
  });
  const itemsGH = corpusGH.filter(it=>it && (it.id||it.repo_id||it.name) && ghSnap[(it.id||it.repo_id||it.name)]).map(it=>{
    const id = it.id || it.repo_id || it.name; const statsRaw = ghSnap[id] || {}; const mergedStats = { ...(it.stats||{}), stars: statsRaw.stars, forks: statsRaw.forks };
    return { ...it, id, source: 'github', stats: mergedStats };
  });

  let cache = ensureCache();
  const nowIso = new Date().toISOString();
  let reuse=0, gen=0, total=0;
  const toGen=[]; const meta=[];
  function processList(list, source){
    for(const it of (list||[])){
      if(!it || !it.id) continue; total++;
      const key = `${source}:${it.id}`;
      const h = hashItem(it);
      const cached = cache.models[key];
      if(cached && cached.hash === h && cached.summary_en && cached.summary_zh && cached.summary_es){
        // merge
        it.summary_en = cached.summary_en; it.summary_zh = cached.summary_zh; it.summary_es = cached.summary_es; it.summary = cached.summary || it.summary_zh || it.summary_en || it.summary_es || it.summary || it.description || '';
        reuse++;
      } else {
        toGen.push({ it, key, hash: h, source });
      }
    }
  }
  processList(itemsHF, 'hf');
  processList(itemsGH, 'github');
  console.log('[snapshot-summaries] debug after processList total', total, 'toGen', toGen.length);

  if(toGen.length && !API_KEY){
    console.warn('[snapshot-summaries] API key missing; cannot generate new summaries.');
  }
  if(toGen.length === 0){
    // Early fast-path summary (still continue to write files for consistency)
    console.log(`[snapshot-summaries] total=${total} reuse=${reuse} generated=0 failed=0 (fast-path)`);
  }

  const generated = await mapLimit(toGen, MAX_CONCURRENCY, async ({ it, key, hash })=>{
    if(!API_KEY) return null;
    const prompt = buildPrompt(it);
    const res = await llmRequest(prompt);
    const neutral = res.zh || res.en || res.es || it.summary || it.description || '';
    if(res.en||res.zh||res.es){
      it.summary_en = res.en; it.summary_zh = res.zh; it.summary_es = res.es; it.summary = neutral;
      cache.models[key] = { hash, updated_at: it.updated_at || nowIso, summary_en: res.en, summary_zh: res.zh, summary_es: res.es, summary: neutral, last_generated: nowIso };
      gen++; return true;
    } else {
      return false;
    }
  });

  cache.generated_at = nowIso;
  writeJSON(CACHE_FILE, cache);
  // Write enriched summary arrays into companion files (do not mutate original minimal snapshot maps)
  const enrichedHFPath = path.join(dayDir, 'hf_summaries.json');
  const enrichedGHPath = path.join(dayDir, 'gh_summaries.json');
  writeJSON(enrichedHFPath, { date: day, items: itemsHF });
  writeJSON(enrichedGHPath, { date: day, items: itemsGH });
  const failedCount = (generated||[]).filter(v=>v===false).length;
  if(toGen.length){
    console.log(`[snapshot-summaries] total=${total} reuse=${reuse} generated=${gen} failed=${failedCount} -> wrote hf_summaries.json & gh_summaries.json`);
  }
}

main().then(()=>{ console.log('[snapshot-summaries] done'); }).catch(e=>{ console.error(e); process.exit(1); });
