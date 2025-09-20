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
  const tagSet = new Set((it.tags||[]).map(t=>String(t).toLowerCase()));
  const keys = new Set();
  const debugHits = [];
  for(const [k] of taskMap.entries()){
    const tk = k.toLowerCase();
    if(tagSet.has(tk) || idLow.includes(tk)) { keys.add(k); continue; }
    const tokens = tk.split(/[_-]/).filter(t=>t.length>=3);
    if(tokens.some(tok=> combined.includes(tok) || [...tagSet].some(tag=> tag.includes(tok)))){ keys.add(k); continue; }
    const aliases = aliasMap[tk] || [];
    if(aliases.some(alias => combined.includes(alias) || [...tagSet].some(tag=> tag.includes(alias)))){ keys.add(k); continue; }
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
  const snapToday = loadSnapshot(today, 'hf.json');
  const snap7 = loadSnapshot(day7, 'hf.json');

  const corpus = readJSON(path.join(dataDir, 'corpus.hf.json')) || { items: [] };
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

  const existingIds = new Set();
  for(const arr of Object.values(hotlist.by_category)) arr.forEach(it=> existingIds.add(it.id));

  // Build alias map once
  const aliasMap = buildAliasMap(taskMap);
  console.log('[update_model_hotlist] alias map built with keys:', Object.keys(aliasMap).length);

  // Build candidate entries
  const candidates=[];
  for(const it of corpus.items||[]){
    const id = it.id || it.repo_id || it.url || it.name; if(!id) continue;
    const snapT = snapToday[id] || { downloads:0, likes:0, last_modified: it.updated_at };
    const snapP = snap7[id] || { downloads: snapT.downloads, likes: snapT.likes, last_modified: it.updated_at };
    const downloads_7d = Math.max(0, (snapT.downloads||0) - (snapP.downloads||0));
    const likes_7d = Math.max(0, (snapT.likes||0) - (snapP.likes||0));
  const task_keys = categorizeModel(it, taskMap, aliasMap);
    if(task_keys.length===0) continue; // skip unclassified
    const entry = {
      id,
      source: 'hf',
      name: it.name || id.split('/').pop(),
      url: it.url || `https://huggingface.co/${id}`,
      tags: it.tags||[],
      stats: {
        downloads_total: snapT.downloads||0,
        likes_total: snapT.likes||0,
        downloads_7d,
        likes_7d
      },
      updated_at: snapT.last_modified || it.updated_at || new Date().toISOString(),
      added_at: today,
      summary: it.summary || '',
      flags: { pinned:false, hidden:false },
      task_keys
    };
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

  // Group by task key and append
  let appended=0;
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
        }
      }
    } else if(already.length < MIN_SEED_PER_TASK){
      // Insert placeholder to guarantee visibility; flagged placeholder:true so UI can style/hide.
      const need = MIN_SEED_PER_TASK - already.length;
      for(let i=0;i<need;i++){
        already.push({
          id: `__placeholder__:${tk}:${i}`,
          source: 'hf',
          name: `(${tk}) placeholder` ,
          url: '',
          tags: [],
          stats: { downloads_total:0, likes_total:0, downloads_7d:0, likes_7d:0 },
          updated_at: new Date().toISOString(),
          added_at: today,
          summary: '',
          flags: { pinned:false, hidden:false, placeholder:true },
          score_model: -1,
          task_keys: [tk]
        });
        appended += 1;
      }
    }
  }

  // Backfill task_keys for existing entries missing them (using candidate map)
  const candMap = new Map(candidates.map(c=> [c.id, c.task_keys]));
  let backfilled = 0;
  for(const arr of Object.values(hotlist.by_category)){
    arr.forEach(e=>{
      if(!e.task_keys || !e.task_keys.length){
        const tk = candMap.get(e.id);
        if(tk && tk.length){ e.task_keys = tk; backfilled++; }
      }
    });
  }
  if(backfilled){
    console.log(`[update_model_hotlist] backfilled task_keys for ${backfilled} existing entries`);
  }

  hotlist.updated_at = new Date().toISOString();
  hotlist.version = SCHEMA_VERSION;
  writeJSON(hotlistPath, hotlist);
  info(`[update_model_hotlist] appended ${appended} new entries across ${taskKeys.length} tasks`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
