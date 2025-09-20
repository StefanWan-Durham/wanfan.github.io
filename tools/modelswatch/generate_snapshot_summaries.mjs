/**
 * generate_snapshot_summaries.mjs
 * Inject tri-lingual summaries into today's snapshots (hf.json + gh.json) using incremental cache.
 * Strategy: compute content hash per item; reuse cached summaries if hash unchanged; otherwise call LLM once returning JSON {summary_en, summary_zh, summary_es}.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { summarizeTriJSON, summarizeDiagnostics } from './summarize_multi.mjs';
import { spawn, spawnSync } from 'child_process';

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
const ENABLE_FALLBACK = /^(1|true|yes)$/i.test(process.env.SUMMARY_FALLBACK||'');

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
  // Optional limiting (post-cold-start cost control)
  // Env variables:
  //   SNAPSHOT_MAX_NEW: absolute cap of new items to summarize (after reuse) (e.g. 40)
  //   SNAPSHOT_MIN_PER_SOURCE: guarantee at least N per source (hf/github) before applying global cap (default 0)
  //   SNAPSHOT_PRIORITY_FIELDS: comma-separated stat fields to sort desc (e.g. "downloads_total,stars,likes_total")
  //   SNAPSHOT_LIMIT_MODE: 'priority' (default) | 'random'
  //   COLD_START_DONE: if set truthy -> enable limiting logic. If not, skip limiting so first run builds full cache.
  //   COLD_START_MARK_FILE: marker file path (default data/ai/modelswatch/cold_start_done.json); if exists treat as done.
  //   AUTO_WRITE_COLD_START_MARK: if '1' then after a run where no limiting applied and all new items processed, create marker file.
  // If cap < toGen.length we trim and record skipped count.
  let skippedDueToLimit = 0;
  const originalToGenCount = toGen.length;
  const MAX_NEW = parseInt(process.env.SNAPSHOT_MAX_NEW||'0',10) || 0;
  const markFile = process.env.COLD_START_MARK_FILE || path.join(DATA_DIR,'cold_start_done.json');
  const coldStartDoneEnv = /^(1|true|yes|on)$/i.test(process.env.COLD_START_DONE||'');
  let coldStartDone = coldStartDoneEnv || fs.existsSync(markFile);
  if(!coldStartDone && MAX_NEW>0){
    console.log('[snapshot-summaries] cold start not marked done; ignoring limiting vars this run');
  }
  if(coldStartDone && MAX_NEW>0 && toGen.length>MAX_NEW){
    const MIN_PER_SOURCE = parseInt(process.env.SNAPSHOT_MIN_PER_SOURCE||'0',10) || 0;
    const priorityFields = (process.env.SNAPSHOT_PRIORITY_FIELDS||'downloads_total,stars,likes_total').split(',').map(s=>s.trim()).filter(Boolean);
    const mode = (process.env.SNAPSHOT_LIMIT_MODE||'priority').toLowerCase();
    // Bucket by source
    const bucket = { hf: [], github: [] };
    toGen.forEach(e=> bucket[e.source]?.push(e));
    function score(entry){
      const st = entry.it.stats||{}; let s=0; let m=1;
      for(const f of priorityFields){
        if(typeof st[f]==='number'){ s += st[f]*m; }
        m = m/10; // diminishing weight chain
      }
      return s;
    }
    if(mode==='priority'){
      bucket.hf.sort((a,b)=> score(b)-score(a));
      bucket.github.sort((a,b)=> score(b)-score(a));
    } else if(mode==='random') {
      for(const k of ['hf','github']) bucket[k].sort(()=> Math.random()-0.5);
    }
    // Take guaranteed minimum first
    const selected = [];
    for(const k of ['hf','github']){
      const arr = bucket[k];
      const take = MIN_PER_SOURCE>0 ? arr.splice(0, Math.min(MIN_PER_SOURCE, arr.length)) : [];
      selected.push(...take);
    }
    // Merge remaining into one pool and apply ordering again if priority mode across combined
    const remaining = [...bucket.hf, ...bucket.github];
    if(mode==='priority') remaining.sort((a,b)=> score(b)-score(a));
    else if(mode==='random') remaining.sort(()=> Math.random()-0.5);
    const slotsLeft = Math.max(0, MAX_NEW - selected.length);
    selected.push(...remaining.slice(0, slotsLeft));
    const newSet = new Set(selected.map(e=> e.key));
    skippedDueToLimit = toGen.filter(e=> !newSet.has(e.key)).length;
    if(skippedDueToLimit>0){
      console.log(`[snapshot-summaries] limit applied: MAX_NEW=${MAX_NEW} kept=${selected.length} skipped=${skippedDueToLimit} mode=${mode} priorityFields=${priorityFields.join('|')}`);
      toGen.length = 0; // mutate original
      selected.forEach(e=> toGen.push(e));
    }
  }
  if(toGen.length){
    const sampleIds = toGen.slice(0,8).map(x=>x.it.id).join(', ');
    console.log(`[snapshot-summaries] planning batch: toGenerate=${toGen.length} reuse=${reuse} sampleIds=[${sampleIds}]`);
  } else {
    console.log('[snapshot-summaries] nothing new to summarize (all reused from cache)');
  }

  // EARLY AVAILABILITY PROBE: Avoid hammering endpoint if clearly unreachable.
  let llmUnavailable = false;
  if(API_KEY && toGen.length){
    try {
      const probe = await llmRequest('PING TEST ONLY');
      const any = (probe.en||probe.zh||probe.es);
      if(!any && summarizeDiagnostics.network_error>0 && summarizeDiagnostics.success===0){
        llmUnavailable = true;
        console.warn('[snapshot-summaries] LLM appears unreachable after probe; will skip per-item calls and use fallback logic.');
      }
    } catch(e){
      llmUnavailable = true;
      console.warn('[snapshot-summaries] probe exception; marking LLM unavailable', e.message);
    }
  }

  if(toGen.length && !API_KEY){
    console.warn('[snapshot-summaries] API key missing; cannot generate new summaries.');
  }
  if(toGen.length === 0){
    // Early fast-path summary (still continue to write files for consistency)
    console.log(`[snapshot-summaries] total=${total} reuse=${reuse} generated=0 failed=0 (fast-path)`);
  }

  let fallbackCount = 0;
  let generated = [];
  if(toGen.length){
    if(llmUnavailable || !API_KEY){
      generated = toGen.map(({it,key,hash})=>{
        if(ENABLE_FALLBACK){
          const base = (it.summary || it.description || '').slice(0,160).trim();
          const short = base || it.name || it.id;
          const en = `Auto summary (fallback:${llmUnavailable? 'unavailable':'no-key'}) : ${short}`;
          const zh = `自动摘要（占位:${llmUnavailable? '无法连接':'缺少密钥'}）: ${short}`;
          const es = `Resumen automático (fallback: ${llmUnavailable? 'sin-conexión':'sin-clave'}) : ${short}`;
          const neutral = zh || en || es;
          it.summary_en = en; it.summary_zh = zh; it.summary_es = es; it.summary = neutral;
          cache.models[key] = { hash, updated_at: it.updated_at || nowIso, summary_en: en, summary_zh: zh, summary_es: es, summary: neutral, last_generated: nowIso, fallback: true };
          fallbackCount++; gen++; return true;
        }
        return false;
      });
    } else {
      // Batch mode: call python tri_summarizer once if USE_PYTHON_SUMMARIZER or force batch path via env SNAPSHOT_USE_BATCH
      const useBatch = /^(1|true|yes|on)$/i.test(process.env.SNAPSHOT_USE_BATCH||process.env.USE_PYTHON_SUMMARIZER||'');
      if(useBatch){
        const prompts = toGen.map(x=> buildPrompt(x.it));
        await new Promise(resolveBatch=>{
          const child = spawn('python', ['tools/tri_summarizer.py','--batch']);
            let out='';
            child.stdout.on('data', d=> { out += d.toString(); });
            child.stderr.on('data', d=> { process.stderr.write(d.toString()); });
            child.on('error', e=> { console.warn('[snapshot-summaries] batch python spawn error', e.message); });
            child.on('close', code=>{
              if(code===0){
                try {
                  const parsed = JSON.parse(out);
                  const results = parsed.results||[];
                  results.forEach((r, idx)=>{
                    const entry = toGen[idx]; if(!entry) return;
                    const { it, key, hash } = entry;
                    let en = r.en||''; let zh = r.zh||''; let es = r.es||'';
                    if(!(en||zh||es) && ENABLE_FALLBACK){
                      const base = (it.summary || it.description || '').slice(0,160).trim();
                      const short = base || it.name || it.id;
                      en = en || `Auto summary (fallback:empty): ${short}`;
                      zh = zh || `自动摘要（占位:空响应）: ${short}`;
                      es = es || `Resumen automático (fallback: vacío): ${short}`;
                    }
                    const neutral = zh || en || es || it.summary || it.description || '';
                    if(en||zh||es){
                      it.summary_en = en; it.summary_zh = zh; it.summary_es = es; it.summary = neutral;
                      const isFallback = !(r.en||r.zh||r.es);
                      if(isFallback) fallbackCount++;
                      cache.models[key] = { hash, updated_at: it.updated_at || nowIso, summary_en: en, summary_zh: zh, summary_es: es, summary: neutral, last_generated: nowIso, fallback: isFallback };
                      gen++;
                      generated.push(true);
                    } else {
                      generated.push(false);
                    }
                  });
                  const diag = parsed.diagnostics || {};
                  console.log(`[snapshot-summaries] batch tri_summarizer results total=${results.length} ok=${diag.ok_count||''} cacheHits=${diag.cache_hits||''} cacheMiss=${diag.cache_misses||''} json=${diag.json_path_count||''} seq=${diag.seq_path_count||''} elapsed=${diag.elapsed_sec||''}s`);
                } catch(e){
                  console.warn('[snapshot-summaries] batch parse error', e.message);
                }
              } else {
                console.warn('[snapshot-summaries] batch python exit', code);
              }
              resolveBatch();
            });
            // feed prompts
            child.stdin.write(prompts.join('\n')+'\n');
            child.stdin.end();
        });
      } else {
        // fallback to previous per-item path if batch disabled
        const per = await mapLimit(toGen, MAX_CONCURRENCY, async ({ it, key, hash })=>{
          const prompt = buildPrompt(it);
          const res = await llmRequest(prompt);
          let { en, zh, es } = res;
          if(!(en||zh||es) && ENABLE_FALLBACK){
            const base = (it.summary || it.description || '').slice(0,160).trim();
            const short = base || it.name || it.id;
            en = en || `Auto summary (fallback): ${short}`;
            zh = zh || `自动摘要（占位）: ${short}`;
            es = es || `Resumen automático (fallback): ${short}`;
          }
          const neutral = zh || en || es || it.summary || it.description || '';
          if(en||zh||es){
            it.summary_en = en; it.summary_zh = zh; it.summary_es = es; it.summary = neutral;
            const isFallback = !(res.en||res.zh||res.es);
            if(isFallback) fallbackCount++;
            cache.models[key] = { hash, updated_at: it.updated_at || nowIso, summary_en: en, summary_zh: zh, summary_es: es, summary: neutral, last_generated: nowIso, fallback: isFallback };
            gen++; return true;
          }
          return false;
        });
        generated = per;
      }
    }
  }

  cache.generated_at = nowIso;
  writeJSON(CACHE_FILE, cache);
  // Write enriched summary arrays into companion files (do not mutate original minimal snapshot maps)
  const enrichedHFPath = path.join(dayDir, 'hf_summaries.json');
  const enrichedGHPath = path.join(dayDir, 'gh_summaries.json');
  writeJSON(enrichedHFPath, { date: day, items: itemsHF });
  writeJSON(enrichedGHPath, { date: day, items: itemsGH });
  const failedCount = (generated||[]).filter(v=>v===false).length;
  if(toGen.length){
    console.log(`[snapshot-summaries] total=${total} reuse=${reuse} generated=${gen} failed=${failedCount} batch=${/^(1|true|yes|on)$/i.test(process.env.SNAPSHOT_USE_BATCH||process.env.USE_PYTHON_SUMMARIZER||'')} -> wrote hf_summaries.json & gh_summaries.json`);
  }
  try {
    writeJSON(path.join(DATA_DIR,'summaries_diagnostics.json'), {
      generated_at: nowIso,
      total_items_considered: total,
      to_generate: toGen.length,
      generated: gen,
      failed: failedCount,
      api_key_present: summarizeDiagnostics.api_key_present,
      attempts: summarizeDiagnostics.attempts,
      success: summarizeDiagnostics.success,
      empty: summarizeDiagnostics.empty,
      parse_fail: summarizeDiagnostics.parse_fail,
      network_error: summarizeDiagnostics.network_error,
      status_errors: summarizeDiagnostics.status_errors,
      endpoint_fallbacks: summarizeDiagnostics.endpoint_fallbacks,
      fallback_count: fallbackCount,
      skipped_due_to_limit: skippedDueToLimit,
      cold_start_done: coldStartDone,
      original_to_generate: originalToGenCount
    });
  } catch{}
  // Cold start marker auto-write
  try {
    const autoWrite = /^(1|true|yes|on)$/i.test(process.env.AUTO_WRITE_COLD_START_MARK||'');
    if(autoWrite && !coldStartDone){
      if(skippedDueToLimit===0){
        writeJSON(markFile, { created_at: nowIso, note: 'Cold start full generation completed', original_to_gen: originalToGenCount });
        console.log('[snapshot-summaries] wrote cold start marker', markFile);
      } else {
        console.log('[snapshot-summaries] cold start marker NOT written (limiting applied)');
      }
    }
  } catch{}
}

main().then(()=>{ console.log('[snapshot-summaries] done'); }).catch(e=>{ console.error(e); process.exit(1); });
