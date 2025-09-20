#!/usr/bin/env node
/**
 * summaries_coverage.mjs
 * Report snapshot tri-lingual summary coverage (today & cumulative cache) + daily file coverage.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Reliable cross-platform root resolution
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const CACHE_FILE = path.join(DATA_DIR, 'summary_cache.json');

function readJSON(p){ try{return JSON.parse(fs.readFileSync(p,'utf-8'));}catch{return null;} }
function todayKey(){ const d=new Date(); return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d); }

function collectToday(){
  const day = todayKey();
  const dir = path.join(SNAP_DIR, day);
  const hfSide = readJSON(path.join(dir,'hf_summaries.json'));
  const ghSide = readJSON(path.join(dir,'gh_summaries.json'));
  const arr = [];
  function takeSide(src, side){
    if(side && Array.isArray(side.items)){
      for(const it of side.items){ if(!it||!it.id) continue; arr.push({ source: src, id: it.id, zh: !!it.summary_zh, en: !!it.summary_en, es: !!it.summary_es }); }
      return true;
    }
    return false;
  }
  const usedHF = takeSide('hf', hfSide);
  const usedGH = takeSide('github', ghSide);
  if(!usedHF){
    const hfMap = readJSON(path.join(dir,'hf.json'))||{};
    for(const id of Object.keys(hfMap)){ arr.push({ source:'hf', id, zh:false, en:false, es:false }); }
  }
  if(!usedGH){
    const ghMap = readJSON(path.join(dir,'gh.json'))||{};
    for(const id of Object.keys(ghMap)){ arr.push({ source:'github', id, zh:false, en:false, es:false }); }
  }
  return arr;
}

function summarizeFlags(arr){
  let total=0, full=0, partial=0, none=0;
  for(const r of arr){ total++; const c = (r.zh?1:0)+(r.en?1:0)+(r.es?1:0); if(c===3) full++; else if(c===0) none++; else partial++; }
  return { total, full, partial, none, pct_full: total? +(full*100/total).toFixed(2):0 };
}

function main(){
  const today = collectToday();
  const todayStats = summarizeFlags(today);
  const cache = readJSON(CACHE_FILE) || { models:{} };
  const cacheEntries = Object.values(cache.models||{}).map(v=>({ zh:!!v.summary_zh, en:!!v.summary_en, es:!!v.summary_es }));
  const cacheStats = summarizeFlags(cacheEntries);
  const out = { generated_at: new Date().toISOString(), today: todayStats, cache: cacheStats };
  const outPath = path.join(DATA_DIR, 'summaries_coverage.json');
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  fs.writeFileSync(outPath, JSON.stringify(out,null,2));
  console.log('[summaries_coverage] wrote', outPath, out);
}

main();
