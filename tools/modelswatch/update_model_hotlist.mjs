#!/usr/bin/env node
/* Update models_hotlist.json: compute 7d deltas, freshness, score; append new models per task */
import fs from 'fs';
import { info } from './log.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCHEMA_VERSION } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const dataDir = path.join(root, 'data/ai/modelswatch');

const LIMIT_PER_TASK = Number(process.env.HOTLIST_LIMIT_PER_TASK || '1');
const MIN_SEED_PER_TASK = Number(process.env.HOTLIST_MIN_SEED_PER_TASK || '2');
const FRESH_TAU = Number(process.env.HOTLIST_FRESHNESS_TAU_DAYS || '30');
const DEBUG = /^(1|true|yes)$/i.test(process.env.HOTLIST_DEBUG||'');

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function writeJSON(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function dateKey(offsetDays){
  const now = new Date();
  const t = now.getTime() - offsetDays*86400000;
  const d = new Date(t);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' });
  return fmt.format(d);
}
function loadSnapshot(key, file){
  const p = path.join(dataDir, 'snapshots', key, file);
  return readJSON(p) || {};
}
function zStats(values){
  if(!values.length) return { mean:0, std:1 };
  const mean = values.reduce((a,b)=>a+b,0)/values.length;
  const varc = values.reduce((a,b)=> a+ (b-mean)**2, 0)/values.length;
  const std = Math.sqrt(varc) || 1;
  return { mean, std };
}
function z(value,{mean,std}){ return std<1e-9 ? 0 : (value-mean)/std; }
function freshness(days){ return Math.exp(-days/Math.max(1,FRESH_TAU)); }
function daysSince(iso){ if(!iso) return 999; const t = Date.parse(iso); if(isNaN(t)) return 999; return (Date.now()-t)/86400000; }

function ensureHotlistShape(obj){
  if(!obj || typeof obj !== 'object') return { version:1, updated_at:'', by_category:{} };
  if(!obj.by_category) obj.by_category={};
  if(typeof obj.version!=='number') obj.version=1;
  return obj;
}

function collectAllTaskKeys(categories){
  const keys=[];
  (categories||[]).forEach(c=> (c.subcategories||[]).forEach(s=> (s.tasks||[]).forEach(t=> keys.push(t.key))));
  return keys;
}

function mapTaskKeysByTask(categories){
  const m=new Map();
  (categories||[]).forEach(c=> (c.subcategories||[]).forEach(s=> (s.tasks||[]).forEach(t=> m.set(t.key, {cat:c, sub:s, task:t}))));
  return m;
}

function loadAliasConfig(){
  const p = path.join(dataDir, 'task_aliases.json');
  const cfg = readJSON(p) || {};
  const { _meta, ...rest } = cfg;
  return rest;
}

function generateHeuristicVariants(taskKey){
  const base = taskKey.toLowerCase();
  const parts = base.split(/[_-]/).filter(Boolean);
  const variants = new Set();
  variants.add(base);
  variants.add(parts.join('-'));
  variants.add(parts.join('_'));
  variants.add(parts.join(''));
  // acronym if multi-part
  if(parts.length > 1){
    const ac = parts.map(p=> p[0]).join('');
    if(ac.length >= 3) variants.add(ac);
  }
  // add diffusion special case expansions
  if(base.includes('text') && base.includes('image')){
    variants.add('txt2img');
  }
  if(base.includes('text') && base.includes('video')){
    variants.add('txt2video');
  }
  return [...variants].filter(v=> v.length>=3);
}

function normalizeStringToTokens(s){
  if(!s) return [];
  return String(s).toLowerCase()
    .replace(/[:@#\/=]/g,' ') // split common separators
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g,' ') // keep CJK and alphanum
    .split(/\s+/).filter(Boolean);
}

function normalizeTagForMatch(tag){
  if(!tag) return '';
  // drop dataset:, base_model:, license:, region:, arxiv: prefixes
  return String(tag).toLowerCase().replace(/^(dataset:|base_model:|license:|region:|arxiv:)/,'').replace(/[^a-z0-9\u4e00-\u9fff]+/g,' ').trim();
}

function normalizeZh(str){
  if(!str) return [];
  // Remove full-width and half-width parentheses content
  const cleaned = str.replace(/（.*?）/g,'').replace(/\(.*?\)/g,'').trim();
  const arr = [];
  if(cleaned && cleaned.length>=2) arr.push(cleaned);
  if(str !== cleaned && str.length>=2) arr.push(str.replace(/（|）/g,''));
  return arr;
}

function buildAliasMap(taskMap){
  const manual = loadAliasConfig();
  const ALIAS = {};
  for(const [k, meta] of taskMap.entries()){
    const keyLower = k.toLowerCase();
    const arr = new Set();
    // manual
    (manual[keyLower] || manual[k] || []).forEach(a=> arr.add(a.toLowerCase()));
    // heuristic variants
    generateHeuristicVariants(keyLower).forEach(v=> arr.add(v));
    // localized names
    if(meta?.task){
      const { en, zh, es } = meta.task;
      [en, es].filter(Boolean).forEach(txt=>{
        const t = String(txt).toLowerCase();
        if(t.length>=4) arr.add(t.replace(/[^a-z0-9_-]+/g,'-'));
      });
      // zh handling
      normalizeZh(zh).forEach(z=> arr.add(z.toLowerCase()));
    }
    ALIAS[keyLower] = [...arr];
  }
  return ALIAS;
}

function categorizeModel(it, taskMap, aliasMap){
  if(Array.isArray(it.task_keys) && it.task_keys.length){
    return it.task_keys.filter(k=>taskMap.has(k));
  }
  const idLow = String(it.id||'').toLowerCase();
  const nameLow = String(it.name||'').toLowerCase();
  const combined = `${idLow} ${nameLow} ${(it.summary||'').toLowerCase()} ${(it.description||'').toLowerCase()}`;
  // Build both raw and normalized tag sets for more robust matching
  const rawTags = (it.tags||[]).map(t=>String(t).toLowerCase());
  const tagSet = new Set(rawTags);
  const normTags = new Set(rawTags.map(normalizeTagForMatch).filter(Boolean));
  const keys = new Set();
  const debugHits = [];
  for(const [k] of taskMap.entries()){
    const tk = k.toLowerCase();
    // exact tag or id match
    if(tagSet.has(tk) || idLow.includes(tk)) { keys.add(k); continue; }
    // normalized tag match (e.g., image-classification -> image classification)
    if([...normTags].some(nt=> nt.includes(tk.replace(/[_-]/g,' ')) || tk.replace(/[_-]/g,' ').includes(nt))){ keys.add(k); continue; }

    // token overlap fuzzy match between task key/name/aliases and combined text/tags
    const tkTokens = normalizeStringToTokens(tk).filter(t=> t.length>=2);
    if(tkTokens.length){
      const combinedTokens = new Set(normalizeStringToTokens(combined));
      const normTagTokens = new Set(Array.from(normTags).flatMap(t=> normalizeStringToTokens(t)));
      let common = 0;
      for(const tkn of tkTokens){ if(combinedTokens.has(tkn) || normTagTokens.has(tkn)) common++; }
      // match if at least two tokens overlap or majority of tkTokens overlap
      if(common >= 2 || (common>0 && common / tkTokens.length >= 0.6)) { keys.add(k); continue; }
    }

    // alias-based matching (aliases expanded and normalized in buildAliasMap)
    const aliases = aliasMap[tk] || [];
    if(aliases.some(alias => {
      const nal = String(alias).toLowerCase();
      if(nal.length<2) return false;
      if(combined.includes(nal)) return true;
      if(tagSet.has(nal)) return true;
      const nalTokens = normalizeStringToTokens(nal);
      if(nalTokens.length>=2){
        const combinedTokens = new Set(normalizeStringToTokens(combined));
        let common = 0; for(const tkn of nalTokens) if(combinedTokens.has(tkn)) common++;
        if(common >= 2 || (common>0 && common / nalTokens.length >= 0.6)) return true;
      }
      return false;
    })){ keys.add(k); continue; }
  }
  if(DEBUG){
    if(keys.size){
      debugHits.push(`[HIT] ${it.id} => ${[...keys].join(',')}`);
    } else {
      debugHits.push(`[MISS] ${it.id}`);
    }
    if(debugHits.length) debugHits.forEach(l=> console.log('[update_model_hotlist][debug]', l));
  }
  return [...keys];
}

function computeScore(entry){
  const d7 = entry.stats.downloads_7d||0;
  const l7 = entry.stats.likes_7d||0;
  const fresh = freshness(daysSince(entry.updated_at));
  return entry.score_model = 0.6*entry._z_d7 + 0.3*entry._z_l7 + 0.1*fresh;
}

async function main(){
  const today = dateKey(0);
  const day7 = dateKey(7);
  const snapTodayHF = loadSnapshot(today, 'hf.json');
  const snap7HF = loadSnapshot(day7, 'hf.json');
  const snapTodayGH = loadSnapshot(today, 'github.json');
  const snap7GH = loadSnapshot(day7, 'github.json');

  // Merge corpora: prefer HF then GitHub so we have more candidates
  const corpusHF = readJSON(path.join(dataDir, 'corpus.hf.json')) || { items: [] };
  const corpusGH = readJSON(path.join(dataDir, 'corpus.github.json')) || { items: [] };
  const corpus = { items: [ ...(corpusHF.items||[]), ...(corpusGH.items||[]) ] };
  // Categories file actually resides one level up: data/ai/ai_categories.json
  const catFile = readJSON(path.join(root, 'data/ai/ai_categories.json')) || readJSON(path.join(dataDir, 'ai_categories.json'));
  const hotlistPath = path.join(dataDir, 'models_hotlist.json');
  const hotlist = ensureHotlistShape(readJSON(hotlistPath));

  const categories = catFile?.categories || catFile || [];
  const taskKeys = collectAllTaskKeys(categories);
  if(!taskKeys.length){
    console.warn('[update_model_hotlist] No task keys loaded; categories length=', categories.length, 'Check ai_categories.json path.');
  } else {
    console.log('[update_model_hotlist] Loaded task keys:', taskKeys.length);
  }
  const taskMap = mapTaskKeysByTask(categories);

  // Load summary cache to merge multilingual summaries into hotlist entries
  const summaryCachePath = path.join(dataDir, 'summary_cache.json');
  const SUMMARY_CACHE = (readJSON(summaryCachePath) || {}).models || {};

  const existingIds = new Set();
  for(const arr of Object.values(hotlist.by_category)) arr.forEach(it=> existingIds.add(it.id));

  // Build alias map once
  const aliasMap = buildAliasMap(taskMap);
  console.log('[update_model_hotlist] alias map built with keys:', Object.keys(aliasMap).length);

  // Build candidate entries
  const candidates=[];
  for(const it of corpus.items||[]){
    const id = it.id || it.repo_id || it.url || it.name; if(!id) continue;
    // Determine source and snapshot maps
    const src = (it.source || '').toLowerCase() || (id && id.includes('/') && id.split('/').length===2 ? 'github' : 'hf');
    let snapT = {};
    let snapP = {};
    if(src === 'github'){
      snapT = snapTodayGH[id] || { stars:0, last_modified: it.updated_at };
      snapP = snap7GH[id] || { stars: snapT.stars, last_modified: it.updated_at };
    } else {
      snapT = snapTodayHF[id] || { downloads:0, likes:0, last_modified: it.updated_at };
      snapP = snap7HF[id] || { downloads: snapT.downloads, likes: snapT.likes, last_modified: it.updated_at };
    }
    // Treat GitHub star delta as downloads_7d for scoring consistency
    const downloads_7d = src === 'github' ? Math.max(0, (snapT.stars||0) - (snapP.stars||0)) : Math.max(0, (snapT.downloads||0) - (snapP.downloads||0));
    const likes_7d = src === 'github' ? 0 : Math.max(0, (snapT.likes||0) - (snapP.likes||0));
    const task_keys = categorizeModel(it, taskMap, aliasMap);
    // Keep unclassified items (we'll expose a separate global_github list below)
    // if(task_keys.length===0) continue; // previously skipped unclassified
    const entry = {
      id,
      source: src,
      name: it.name || id.split('/').pop(),
      url: it.url || (src==='github' ? `https://github.com/${id}` : `https://huggingface.co/${id}`),
      tags: it.tags||[],
      stats: {
        downloads_total: src==='github' ? (snapT.stars||0) : (snapT.downloads||0),
        likes_total: src==='github' ? 0 : (snapT.likes||0),
        downloads_7d,
        likes_7d
      },
      updated_at: snapT.last_modified || it.updated_at || new Date().toISOString(),
      added_at: today,
      // Prefer multilingual summaries from the persistent summary cache (if available)
      summary: it.summary || '',
      summary_en: '',
      summary_zh: '',
      summary_es: '',
      flags: { pinned:false, hidden:false },
      task_keys
    };
    // Try to find a matching summary in the summary cache. summary cache keys include source prefix like 'hf:...'
    const scKeyCandidates = [ `hf:${id}`, id ];
    let sc = null;
    for(const k of scKeyCandidates){ if(SUMMARY_CACHE[k]){ sc = SUMMARY_CACHE[k]; break; } }
    if(sc){
      entry.summary_en = sc.summary_en || sc.summary || '';
      entry.summary_zh = sc.summary_zh || sc.summary || '';
      entry.summary_es = sc.summary_es || sc.summary || '';
      entry.summary = sc.summary || entry.summary || entry.summary_en || entry.summary_zh || entry.summary_es || '';
    }
    candidates.push(entry);
  }

  // Collect stats for z-score
  const d7Vals = candidates.map(c=>c.stats.downloads_7d);
  const l7Vals = candidates.map(c=>c.stats.likes_7d);
  const zD = zStats(d7Vals); const zL = zStats(l7Vals);
  candidates.forEach(c=>{ c._z_d7 = z(c.stats.downloads_7d, zD); c._z_l7 = z(c.stats.likes_7d, zL); computeScore(c); });
  if(DEBUG){
    console.log('[update_model_hotlist][debug] candidate count:', candidates.length);
    const dist = {};
    for(const c of candidates){ for(const k of c.task_keys){ dist[k]=(dist[k]||0)+1; } }
    const top = Object.entries(dist).sort((a,b)=>b[1]-a[1]).slice(0,15);
    console.log('[update_model_hotlist][debug] top task distribution:', top.map(([k,v])=> `${k}:${v}`).join(' '));
  }

  // Create a top-level global_github list to allow UI to show more GH snapshot items
  try{
    const GH_GLOBAL_LIMIT = Number(process.env.HOTLIST_GLOBAL_GH_LIMIT || '24');
    const ghCandidates = candidates.filter(c=> c.source==='github' || (c.source && c.source.toLowerCase()==='github'));
    ghCandidates.sort((a,b)=> (b.score_model||0) - (a.score_model||0));
    const topGh = ghCandidates.slice(0, GH_GLOBAL_LIMIT).map(p=>({
      id: p.id, source: p.source, name: p.name, url: p.url, tags: p.tags, stats: p.stats,
      updated_at: p.updated_at, summary: p.summary || p.summary_en || p.summary_zh || '', score_model: p.score_model || 0
    }));
    hotlist.global_github = topGh;
    console.log('[update_model_hotlist] global_github list built, items=', topGh.length);
  }catch(e){ /* non-fatal */ }

  // Group by task key and append
  let appended=0;
  const appendedCounts = {}; // track per-task appended counts for logging
  for(const tk of taskKeys){
    const already = hotlist.by_category[tk] || (hotlist.by_category[tk]=[]);
    const pool = candidates.filter(c=> c.task_keys.includes(tk) && !existingIds.has(c.id));
    if(pool.length){
      pool.sort((a,b)=> b.score_model - a.score_model);
      // Primary append respecting LIMIT_PER_TASK
      const primary = pool.slice(0, LIMIT_PER_TASK);
      if(primary.length){
        already.push(...primary.map(p=>({
          id: p.id,
            source: p.source,
            name: p.name,
            url: p.url,
            tags: p.tags,
            stats: p.stats,
            updated_at: p.updated_at,
            added_at: p.added_at,
            summary: p.summary,
            flags: p.flags,
            score_model: p.score_model,
            task_keys: p.task_keys
        })));
        appended += primary.length;
        appendedCounts[tk] = (appendedCounts[tk]||0) + primary.length;
      }
      // Seeding: ensure minimum bucket size
      if(already.length < MIN_SEED_PER_TASK){
        const need = MIN_SEED_PER_TASK - already.length;
        const extra = pool.slice(LIMIT_PER_TASK, LIMIT_PER_TASK + need).filter(x=> !already.some(a=>a.id===x.id));
        if(extra.length){
          already.push(...extra.map(p=>({
            id: p.id,
            source: p.source,
            name: p.name,
            url: p.url,
            tags: p.tags,
            stats: p.stats,
            updated_at: p.updated_at,
            added_at: p.added_at,
            summary: p.summary,
            flags: p.flags,
            score_model: p.score_model,
            task_keys: p.task_keys
          })));
          appended += extra.length;
          appendedCounts[tk] = (appendedCounts[tk]||0) + extra.length;
        }
      }
    }
  }

  // Backfill task_keys and score_model for existing entries using candidate data where available
  const candidateMap = new Map(candidates.map(c=> [c.id, c]));
  let backfilled = 0;
  for(const arr of Object.values(hotlist.by_category)){
    arr.forEach(e=>{
      // backfill task_keys
      if(!e.task_keys || !e.task_keys.length){
        const cand = candidateMap.get(e.id);
        const tk = cand ? cand.task_keys : null;
        if(tk && tk.length){ e.task_keys = tk; backfilled++; }
      }
      // backfill or normalize score_model so sorting works consistently
      const cand = candidateMap.get(e.id);
      if(cand && typeof cand.score_model === 'number'){
        e.score_model = cand.score_model;
      } else {
        // preserve existing numeric score_model if present, otherwise default to 0
        e.score_model = (typeof e.score_model === 'number') ? e.score_model : 0;
      }
    });
  }
  if(backfilled){
    console.log(`[update_model_hotlist] backfilled task_keys for ${backfilled} existing entries`);
  }

  // Merge summary fields from SUMMARY_CACHE into existing hotlist entries where possible
  let summaryMerged = 0;
  for(const arr of Object.values(hotlist.by_category)){
    for(const e of arr){
      // Skip explicit placeholders (will be removed later)
      if(e.flags && e.flags.placeholder) continue;
      const src = e.source || 'hf';
      const tryKeys = [ `${src}:${e.id}`, e.id ];
      let sc = null;
      for(const k of tryKeys){ if(SUMMARY_CACHE[k]){ sc = SUMMARY_CACHE[k]; break; } }
      if(sc){
        if(!e.summary || e.summary === ''){ e.summary = sc.summary || ''; }
        if(!e.summary_en) e.summary_en = sc.summary_en || sc.summary || '';
        if(!e.summary_zh) e.summary_zh = sc.summary_zh || sc.summary || '';
        if(!e.summary_es) e.summary_es = sc.summary_es || sc.summary || '';
        summaryMerged++;
      }
    }
  }
  if(summaryMerged) console.log(`[update_model_hotlist] merged summaries for ${summaryMerged} existing hotlist entries`);

  // Ensure each category array is sorted by computed score_model so consumers display correct ordering
  for(const k of Object.keys(hotlist.by_category)){
    try{ hotlist.by_category[k].sort((a,b)=> (b.score_model||0) - (a.score_model||0)); }catch(e){ /* ignore sort errors */ }
  }
  hotlist.updated_at = new Date().toISOString();
  hotlist.version = SCHEMA_VERSION;
  // Remove any leftover placeholder entries before writing out the hotlist so the UI and consumers
  // don't see synthetic placeholder cards.
  for(const k of Object.keys(hotlist.by_category)){
    hotlist.by_category[k] = (hotlist.by_category[k]||[]).filter(e=> !(e.flags && e.flags.placeholder));
  }
  writeJSON(hotlistPath, hotlist);
  info(`[update_model_hotlist] appended ${appended} new entries across ${taskKeys.length} tasks`);

  // Non-destructive logging: print per-task appended counts (sorted desc) so CI logs show which tasks gained items
  try{
    const taskEntries = Object.entries(appendedCounts).filter(([,c])=> c>0).sort((a,b)=> b[1]-a[1]);
    if(taskEntries.length){
      console.log('[update_model_hotlist] per-task appended counts:');
      for(const [tk,c] of taskEntries){
        console.log('  ', tk.padEnd(36), c);
      }
    } else {
      console.log('[update_model_hotlist] no new per-task appends in this run');
    }
  }catch(e){ /* non-fatal logging error */ }
}

main().catch(e=>{ console.error(e); process.exit(1); });
