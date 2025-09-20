#!/usr/bin/env node
/**
 * coverage_guard.mjs
 * Warn (GitHub Actions ::warning) if any model task bucket or project category has < MIN (default 2) items.
 */
import fs from 'fs';
import path from 'path';

const MIN = Number(process.env.COVERAGE_MIN || 2);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const BASE = path.join(ROOT, 'data/ai/modelswatch');

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }

function checkHotlist(file, key='by_category'){
  const p = path.join(BASE, file);
  const j = readJSON(p);
  if(!j){ console.log(`::warning ::Missing hotlist file ${file}`); return []; }
  const obj = j[key]||{};
  const misses=[];
  for(const k of Object.keys(obj)){
    const arr = obj[k]||[];
    if(arr.length < MIN) misses.push({ key:k, count:arr.length });
  }
  return misses;
}

const modelMiss = checkHotlist('models_hotlist.json');
const projMiss = checkHotlist('projects_hotlist.json');
const gaps = { min: MIN, model_tasks_underfilled: modelMiss, project_categories_underfilled: projMiss, generated_at: new Date().toISOString() };
try { fs.writeFileSync(path.join(BASE,'coverage_gaps.json'), JSON.stringify(gaps,null,2)); } catch{}
if(modelMiss.length){ console.log('::warning ::Model task buckets under-filled: ' + modelMiss.map(m=>`${m.key}(${m.count})`).join(', ')); }
if(projMiss.length){ console.log('::warning ::Project category buckets under-filled: ' + projMiss.map(m=>`${m.key}(${m.count})`).join(', ')); }
if(!modelMiss.length && !projMiss.length){ console.log('[coverage_guard] All buckets meet minimum', MIN); }
if((process.env.COVERAGE_FAIL_ON_MISS==='1' || /^true$/i.test(process.env.COVERAGE_FAIL_ON_MISS||'')) && (modelMiss.length||projMiss.length)){
  console.error('[coverage_guard] Failing due to underfilled buckets');
  process.exit(1);
}
