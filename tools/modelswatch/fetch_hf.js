#!/usr/bin/env node
/* Fetch popular public HF models via REST (no auth required for public). */
import fs from 'fs';
import path from 'path';
import { info, debug, warn } from './log.js';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data', 'ai', 'modelswatch');
const ITEMS_DIR = path.join(DATA_DIR, 'items');

function ensureDirs(){ fs.mkdirSync(DATA_DIR, {recursive:true}); fs.mkdirSync(ITEMS_DIR, {recursive:true}); }
function writeJSON(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

const HF_TOKEN = process.env.HF_TOKEN || '';
async function hfList(){
  // Public browse endpoint (documented): sort=downloads, limit
  const url = 'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=60';
  const headers = { 'User-Agent': 'modelswatch/1.0' };
  if (HF_TOKEN) {
    headers.Authorization = `Bearer ${HF_TOKEN}`;
    debug('Using HF_TOKEN for authenticated request');
  } else {
    debug('No HF_TOKEN provided; using anonymous request');
  }
  let res;
  try {
    res = await fetch(url, { headers });
  } catch(e){
    warn('HF list network error', e.message);
    throw e;
  }
  if (!res.ok) {
    warn('HF list failed status', res.status);
    throw new Error('HF list failed ' + res.status);
  }
  const arr = await res.json();
  return arr;
}

function mapModel(m){
  const downloads = m.downloads || 0;
  const likes = m.likes || 0;
  return {
    id: m.id,
    source: 'hf',
    name: m.id.split('/').pop(),
    url: `https://huggingface.co/${m.id}`,
    license: m.license || 'N/A',
    lang: 'N/A',
    tags: m.tags || [],
    categories: { capabilities: [], scenes: [], lifecycle: [] },
    stats: {
      // Canonical cumulative fields (Phase 1 schema)
      downloads_total: downloads,
      likes_total: likes
      // NOTE: Removed pseudo fields hf_downloads_7d / hf_likes (were misleading totals masquerading as 7d). Front-end now normalizes.
    },
    score: 0,
    timeline: { t: [], stars: [], downloads: [] },
    summary: m.cardData?.summary || m.description || '',
    updated_at: m.lastModified || m.lastModifiedAt || new Date().toISOString(),
  };
}

function scoreModel(it){
  const dl = it.stats.downloads_total || 0;
  const likes = it.stats.likes_total || 0;
  return dl*0.002 + likes*0.5;
}

export async function fetchHFTop(){
  ensureDirs();
  let arr = [];
  try { arr = await hfList(); }
  catch(e){
    // Reuse last top file if available
    try{ const prev = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'top_hf.json'),'utf8')); if(prev && Array.isArray(prev.items)) return prev.items; }catch{}
    return [];
  }
  const items = (arr||[]).filter(m => !m.gated).map(mapModel);
  items.forEach(it=>{ it.score = scoreModel(it); });
  return items;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchHFTop().then(items=>{
    info('HF items:', items.length);
  }).catch(e=>{ console.error(e); process.exit(1); });
}
