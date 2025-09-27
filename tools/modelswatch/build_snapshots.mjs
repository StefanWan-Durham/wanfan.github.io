#!/usr/bin/env node
/* Build daily snapshots for HF models & GitHub repos to enable 7d delta calculations. */
import fs from 'fs';
import { info } from './log.js';
import { fetchGithubTop } from './fetch_github.js';
import { fetchHFTop } from './fetch_hf.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const dataDir = path.join(root, 'data/ai/modelswatch');
const snapRoot = path.join(dataDir, 'snapshots');

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function writeJSON(p, obj){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function todayKey(){
  // Use Asia/Shanghai date key
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' });
  return fmt.format(now); // YYYY-MM-DD
}

function mapHF(items){
  const out = {};
  for(const it of items){
    const id = it.id || it.repo_id || it.url || it.name; if(!id) continue;
    const stats = it.stats||{};
    // Using new schema: downloads_total / likes_total (fallback to existing keys)
    const downloads = stats.downloads_total ?? stats.hf_downloads_7d ?? stats.hf_downloads ?? 0;
    const likes = stats.likes_total ?? stats.hf_likes ?? 0;
    out[id] = {
      downloads,
      likes,
      last_modified: it.updated_at || it.lastModified || ''
    };
  }
  return out;
}

function mapGH(items){
  const out = {};
  for(const it of items){
    const id = it.id || it.repo_id || it.url || it.name; if(!id) continue;
    const stats = it.stats||{};
    out[id] = {
      stars: stats.stars || stats.stargazers_count || 0,
      forks: stats.forks || 0,
      pushed_at: it.updated_at || ''
    };
  }
  return out;
}

async function main(){
  const key = todayKey();
  let hfCorpus = readJSON(path.join(dataDir, 'corpus.hf.json')) || { items: [] };
  let ghCorpus = readJSON(path.join(dataDir, 'corpus.github.json')) || { items: [] };
  // Prefer live fetch to capture daily-changing stats when possible
  try{
    const liveGH = await fetchGithubTop();
    if(Array.isArray(liveGH) && liveGH.length >= 6){ ghCorpus = { items: liveGH }; info('[build_snapshots] using live github top list for snapshot'); }
  }catch(e){ /* ignore live fetch failures */ }
  try{
    const liveHF = await fetchHFTop();
    if(Array.isArray(liveHF) && liveHF.length >= 6){ hfCorpus = { items: liveHF }; info('[build_snapshots] using live hf top list for snapshot'); }
  }catch(e){ /* ignore live fetch failures */ }
  const hfSnap = mapHF(hfCorpus.items||[]);
  const ghSnap = mapGH(ghCorpus.items||[]);
  const outDir = path.join(snapRoot, key);
  fs.mkdirSync(outDir, {recursive:true});
  writeJSON(path.join(outDir, 'hf.json'), hfSnap);
  writeJSON(path.join(outDir, 'gh.json'), ghSnap);
  info(`[build_snapshots] wrote snapshots for ${key}: hf=${Object.keys(hfSnap).length}, gh=${Object.keys(ghSnap).length}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
