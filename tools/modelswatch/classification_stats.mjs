#!/usr/bin/env node
/**
 * classification_stats.mjs
 * Compute coverage stats for task_keys across corpus.hf.json and corpus.github.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = path.resolve(here, '../../');
const BASE = path.join(ROOT, 'data/ai/modelswatch');

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }

function tally(items){
  const total = items.length;
  let withTasks = 0;
  const dist = {};
  for(const it of items){
    const tks = Array.isArray(it.task_keys)? it.task_keys.filter(Boolean):[];
    if(tks.length){ withTasks++; tks.forEach(k=> dist[k]=(dist[k]||0)+1); }
  }
  return { total, with_tasks: withTasks, pct_with_tasks: total? +(withTasks*100/total).toFixed(2):0, task_distribution: Object.entries(dist).sort((a,b)=> b[1]-a[1]).map(([k,v])=>({task:k,count:v})) };
}

const hf = readJSON(path.join(BASE,'corpus.hf.json'))?.items || [];
const gh = readJSON(path.join(BASE,'corpus.github.json'))?.items || [];
const out = {
  generated_at: new Date().toISOString(),
  hf: tally(hf),
  github: tally(gh)
};
try { fs.mkdirSync(BASE, { recursive: true }); } catch{}
fs.writeFileSync(path.join(BASE,'classification_stats.json'), JSON.stringify(out,null,2));
console.log('[classification_stats] hf pct_with_tasks', out.hf.pct_with_tasks, 'github pct_with_tasks', out.github.pct_with_tasks);
