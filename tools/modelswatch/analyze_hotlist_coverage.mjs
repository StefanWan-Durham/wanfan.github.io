#!/usr/bin/env node
/**
 * analyze_hotlist_coverage.mjs
 * Reports coverage statistics for models_hotlist.json:
 *  - Total models
 *  - Per-task counts
 *  - Tasks with zero items (vs taxonomy)
 *  - Top N tasks by count
 *  - Optional JSON output for CI consumption (pass OUT=path)
 *
 * Usage:
 *   node tools/modelswatch/analyze_hotlist_coverage.mjs [--hotlist path] [--categories path] [--out path]
 * Env (alternative):
 *   HOTLIST_PATH, AI_CATEGORIES_PATH, OUT_JSON
 */
import fs from 'fs';
import path from 'path';
import url from 'url';

const args = process.argv.slice(2);
function argVal(name, env){
  const i = args.indexOf(name); if(i>=0 && args[i+1]) return args[i+1];
  if(process.env[env]) return process.env[env];
}
const hotlistPath = argVal('--hotlist','HOTLIST_PATH') || 'data/models/models_hotlist.json';
const categoriesPath = argVal('--categories','AI_CATEGORIES_PATH') || 'data/ai/ai_categories.json';
const outPath = argVal('--out','OUT_JSON') || '';

function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf-8')); }catch(e){ return null; } }

let hotlistRaw = readJSON(hotlistPath) || {};
let hotlist = [];
// Support multiple hotlist shapes:
//  - array of models
//  - { models: [...] } or { items: [...] }
//  - { by_category: { taskKey: [ ...models ] } }
if (Array.isArray(hotlistRaw)) {
  hotlist = hotlistRaw;
} else if (hotlistRaw && Array.isArray(hotlistRaw.models)) {
  hotlist = hotlistRaw.models;
} else if (hotlistRaw && Array.isArray(hotlistRaw.items)) {
  hotlist = hotlistRaw.items;
} else if (hotlistRaw && typeof hotlistRaw === 'object' && hotlistRaw.by_category && typeof hotlistRaw.by_category === 'object') {
  // Flatten by_category map into a single array of entries
  for (const v of Object.values(hotlistRaw.by_category)) {
    if (Array.isArray(v)) hotlist.push(...v);
  }
} else {
  hotlist = [];
}

let catsRaw = readJSON(categoriesPath);
let cats = [];
if(Array.isArray(catsRaw)) cats = catsRaw; else if(catsRaw && Array.isArray(catsRaw.categories)) cats = catsRaw.categories; else cats = [];

// Gather all task keys from taxonomy (robust against malformed nodes)
const taxonomyTasks = new Set();
try {
  for(const c of (cats||[])){
    if(!c || typeof c!=='object') continue;
    for(const s of (c.subcategories||[])){
      if(!s || typeof s!=='object') continue;
      for(const t of (s.tasks||[])){
        if(t && typeof t==='object' && t.key) taxonomyTasks.add(t.key);
      }
    }
  }
} catch(e){
  console.warn('[coverage] taxonomy parse issue:', e.message);
}
if(taxonomyTasks.size===0){
  console.warn('[coverage] WARNING: taxonomyTasks empty – check categories file path or structure');
}

// Count occurrences
const counts = {}; let modelsWithTasks = 0;
for(const m of hotlist){
  const tks = Array.isArray(m.task_keys)? m.task_keys : [];
  if(tks.length) modelsWithTasks++;
  for(const k of tks){ counts[k] = (counts[k]||0)+1; }
}

// Build coverage arrays
const zeroTasks = [...taxonomyTasks].filter(k=> !counts[k]);
const presentTasks = Object.keys(counts).sort((a,b)=> counts[b]-counts[a]);

const summary = {
  hotlistPath,
  totalModels: hotlist.length,
  modelsWithTasks,
  distinctTasks: presentTasks.length,
  taxonomyTasks: taxonomyTasks.size,
  zeroTasks,
  topTasks: presentTasks.slice(0,15).map(k=> ({ key:k, count:counts[k] }))
};

// CLI Report
console.log('[coverage] Hotlist:', hotlistPath);
console.log('[coverage] Total models:', summary.totalModels, 'with any task_keys:', modelsWithTasks);
console.log('[coverage] Distinct tasks present:', summary.distinctTasks, 'of taxonomy:', summary.taxonomyTasks);
if(zeroTasks.length){
  console.log('[coverage] Tasks with zero items ('+zeroTasks.length+'):', zeroTasks.join(', '));
}else{
  console.log('[coverage] All taxonomy tasks have at least one model.');
}
console.log('[coverage] Top tasks by count:');
for(const t of summary.topTasks){ console.log('  -', t.key, ':', t.count); }

if(outPath){
  try{ fs.writeFileSync(outPath, JSON.stringify(summary,null,2)); console.log('[coverage] Wrote JSON summary ->', outPath); }catch(e){ console.error('[coverage] Failed write', outPath, e); }
}
