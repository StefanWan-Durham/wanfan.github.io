#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { info, warn } from './log.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGithubTop } from './fetch_github.js';
import { fetchHFTop } from './fetch_hf.js';
import { summarizeTriJSON } from './summarize_multi.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const outDir = path.join(root, 'data/ai/modelswatch');

function writeJSON(p, obj){ writeFileSync(p, JSON.stringify(obj, null, 2)); }

const DS_KEY = process.env.DEEPSEEK_API_KEY || '';

function composePrompt(it){
  const lines = [];
  lines.push(`名称: ${it.name||it.id||''}`);
  if(it.url) lines.push(`链接: ${it.url}`);
  const stats = it.stats||{};
  const statBits=[];
  if(stats.stars) statBits.push(`Stars ${stats.stars}`);
  if(stats.forks) statBits.push(`Forks ${stats.forks}`);
  if(stats.hf_downloads_7d) statBits.push(`Downloads7d ${stats.hf_downloads_7d}`);
  if(stats.hf_likes) statBits.push(`Likes ${stats.hf_likes}`);
  if(statBits.length) lines.push(`指标: ${statBits.join(' · ')}`);
  const desc = it.summary || it.description || it.card_desc || '';
  if(desc) lines.push(`简介: ${desc}`);
  return lines.join('\n');
}

async function main(){
  const now = new Date().toISOString();
  const gh = await fetchGithubTop();
  const hf = await fetchHFTop();
  // Optionally enrich with Chinese summary for Top views
  if(DS_KEY){
    const mapLimit = async (arr, limit, fn)=>{
      if(!Array.isArray(arr)||arr.length===0) return [];
      const out=new Array(arr.length); let i=0; let running=0;
      return await new Promise((resolve)=>{
        const step=()=>{
          while(i<arr.length && running<limit){
            const idx=i++; running++;
            Promise.resolve(fn(arr[idx], idx)).then(v=>{out[idx]=v;}).catch(()=>{out[idx]=arr[idx];}).finally(()=>{running--; if(i>=arr.length && running===0) resolve(out); else step();});
          }
        };
        step();
      });
    };
    const enrich = async (items)=>{
      return await mapLimit(items, 3, async (it)=>{
        const prompt = composePrompt(it);
        const { en, zh, es } = await summarizeTriJSON(prompt).catch(()=>({en:'',zh:'',es:''}));
        const neutral = zh || en || es || it.summary || it.description || '';
        return { ...it, summary: neutral, summary_en: en, summary_zh: zh, summary_es: es };
      });
    };
    const gh2 = await enrich(gh);
    const hf2 = await enrich(hf);
    writeJSON(path.join(outDir, 'top_github.json'), { updated_at: now, items: gh2 });
    writeJSON(path.join(outDir, 'top_hf.json'), { updated_at: now, items: hf2 });
  }else{
    // Weekly job updates only the weekly top files and corpus; it does NOT write daily_* files.
  writeJSON(path.join(outDir, 'top_github.json'), { updated_at: now, items: gh });
  writeJSON(path.join(outDir, 'top_hf.json'), { updated_at: now, items: hf });
  }
  // Also refresh corpus files for daily picks
  writeJSON(path.join(outDir, 'corpus.github.json'), { updated_at: now, items: gh });
  writeJSON(path.join(outDir, 'corpus.hf.json'), { updated_at: now, items: hf });
  info('[weekly] refreshed corpus + top files');
  // Chain: build snapshots + update hotlists (model & project)
  try {
    const { spawnSync } = await import('child_process');
    function runNode(script){
      const r = spawnSync('node', [script], { stdio: 'inherit' });
  if(r.status!==0) warn(`[weekly] script failed: ${script}`);
    }
    runNode('tools/modelswatch/build_snapshots.mjs');
    // New: generate tri-lingual snapshot summaries (incremental cache-based)
    try {
      runNode('tools/modelswatch/generate_snapshot_summaries.mjs');
    } catch(e){ warn('[weekly] snapshot summary stage failed', e); }
    runNode('tools/modelswatch/update_model_hotlist.mjs');
    runNode('tools/modelswatch/update_project_hotlist.mjs');
    // Write latest snapshot pointer (after summaries exist)
    try { runNode('tools/modelswatch/write_latest_snapshot.mjs'); } catch(e){ warn('[weekly] latest snapshot writer failed', e); }
  }catch(e){ warn('[weekly] hotlist chain failed', e); }
}

main().catch(e=>{ console.error(e); process.exit(1); });
