#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { info, warn } from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const dataDir = path.join(root, 'data/ai/modelswatch');
const dailyDir = path.join(dataDir, 'daily');

function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){ return null; } }
function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function normalizeKey(it){
  try{
    const raw = (it && (it.id || it.url || it.name)) || '';
    if(!raw) return '';
    let s = String(raw).trim().toLowerCase();
    s = s.replace(/^https?:\/\//,'');
    s = s.replace(/^www\./,'');
    s = s.replace(/\/?$/,'');
    s = s.replace(/^github\.com\//,'');
    s = s.replace(/^huggingface\.co\//,'');
    s = s.split(/[?#]/)[0];
    s = s.replace(/[^a-z0-9\/]+/g,'-');
    s = s.replace(/(^-+|-+$)/g,'');
    return s;
  }catch{ return String((it && (it.id||it.url||it.name))||'').toLowerCase(); }
}

function shallowNormalize(it){
  if(!it || typeof it !== 'object') return null;
  const id = it.id || it.repo_id || it.url || it.name || '';
  const source = it.source || (id && id.includes('huggingface.co') ? 'hf' : 'github');
  const name = it.name || (id||'').split('/').pop() || '';
  const base = {
    id, source, name,
    url: it.url || it.homepage || it.card_url || '',
    task_keys: Array.isArray(it.task_keys) ? it.task_keys.slice() : (it.task_keys? [it.task_keys] : []),
    tags: Array.isArray(it.tags) ? it.tags.slice(0,6) : [],
    summary: it.summary || it.description || it.card_desc || '',
    updated_at: it.updated_at || it.stats?.updated_at || ''
  };
  return base;
}

async function main(){
  info('build_all_hf: scanning daily directory:', dailyDir);
  // Ensure output directories exist
  try{ fs.mkdirSync(dataDir, { recursive: true }); }catch(e){}
  let files = [];
  try{ files = fs.readdirSync(dailyDir).filter(f=> f.endsWith('.json')).map(f=> path.join(dailyDir,f)); }catch(e){ warn('daily dir missing or unreadable', e); files = []; }
  const map = new Map(); // key -> item
  const taskCounts = {};
  for(const f of files){
    const j = readJSON(f);
    if(!j || !Array.isArray(j.items)) continue;
    for(const raw of j.items){
      const it = shallowNormalize(raw);
      if(!it) continue;
      // only include HF items for HF aggregation
      if(it.source !== 'hf') continue;
      const nk = normalizeKey(it) || (`hf::${it.id}`);
      if(map.has(nk)){
        // merge lightweight fields: prefer existing summary if present
        const ex = map.get(nk);
        // prefer longer summary
        if(!ex.summary && it.summary) ex.summary = it.summary;
        // merge task_keys
        const mergedKeys = new Set([...(ex.task_keys||[]), ...(it.task_keys||[])]);
        ex.task_keys = [...mergedKeys];
        // merge tags
        const mergedTags = new Set([...(ex.tags||[]), ...(it.tags||[])]);
        ex.tags = [...mergedTags].slice(0,6);
        // keep latest updated_at
        if((it.updated_at||'') > (ex.updated_at||'')) ex.updated_at = it.updated_at;
        map.set(nk, ex);
      }else{
        map.set(nk, it);
      }
    }
  }
  // finalize list and compute task counts
  const out = [];
  for(const [k,it] of map.entries()){
    out.push(it);
    if(Array.isArray(it.task_keys)){
      for(const tk of it.task_keys){ taskCounts[tk] = (taskCounts[tk]||0) + 1; }
    }
  }
  // write outputs
  const now = new Date().toISOString();
  const outPath = path.join(dataDir, 'all_dates_hf.json');
  const countsPath = path.join(dataDir, 'task_counts_history.json');
  writeJSON(outPath, { generated_at: now, items: out });
  writeJSON(countsPath, { generated_at: now, counts: taskCounts });
  info('build_all_hf: wrote', outPath, 'items=', out.length);
  info('build_all_hf: wrote', countsPath, 'tasks=', Object.keys(taskCounts).length);
}

main().catch(e=>{ warn('build_all_hf failed', e); process.exit(1); });
