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

function categorizeModel(it, taskMap){
  // Use provided task_keys if exist OR infer from tags (lightweight heuristic) -> here we only place models if any match
  const keys = new Set();
  const srcTags = (it.tags||[]).map(x=>String(x).toLowerCase());
  for(const [k,{task}] of taskMap.entries()){
    const tk = k.toLowerCase();
    // naive: if exact tag equals key OR tag contains token OR id contains key substring
    if(srcTags.includes(tk) || (it.id||'').toLowerCase().includes(tk)) keys.add(k);
  }
  // Prefer explicit provided
  if(Array.isArray(it.task_keys) && it.task_keys.length) return it.task_keys.filter(k=>taskMap.has(k));
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
  const catFile = readJSON(path.join(dataDir, 'ai_categories.json')) || readJSON(path.join(dataDir, 'ai_categories.json'.replace('data/ai/modelswatch','data/ai')));
  const hotlistPath = path.join(dataDir, 'models_hotlist.json');
  const hotlist = ensureHotlistShape(readJSON(hotlistPath));

  const categories = catFile?.categories || catFile || [];
  const taskKeys = collectAllTaskKeys(categories);
  const taskMap = mapTaskKeysByTask(categories);

  const existingIds = new Set();
  for(const arr of Object.values(hotlist.by_category)) arr.forEach(it=> existingIds.add(it.id));

  // Build candidate entries
  const candidates=[];
  for(const it of corpus.items||[]){
    const id = it.id || it.repo_id || it.url || it.name; if(!id) continue;
    const snapT = snapToday[id] || { downloads:0, likes:0, last_modified: it.updated_at };
    const snapP = snap7[id] || { downloads: snapT.downloads, likes: snapT.likes, last_modified: it.updated_at };
    const downloads_7d = Math.max(0, (snapT.downloads||0) - (snapP.downloads||0));
    const likes_7d = Math.max(0, (snapT.likes||0) - (snapP.likes||0));
    const task_keys = categorizeModel(it, taskMap);
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
            score_model: p.score_model
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
            score_model: p.score_model
          })));
          appended += extra.length;
        }
      }
    } else if(already.length < MIN_SEED_PER_TASK){
      // Could attempt backfill from previously added to other tasks sharing same id, skip for simplicity now.
    }
  }

  hotlist.updated_at = new Date().toISOString();
  hotlist.version = SCHEMA_VERSION;
  writeJSON(hotlistPath, hotlist);
  info(`[update_model_hotlist] appended ${appended} new entries across ${taskKeys.length} tasks`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
