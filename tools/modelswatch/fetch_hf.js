#!/usr/bin/env node
/* Fetch popular public HF models via REST (no auth required for public). */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data', 'ai', 'modelswatch');
const ITEMS_DIR = path.join(DATA_DIR, 'items');

function ensureDirs(){ fs.mkdirSync(DATA_DIR, {recursive:true}); fs.mkdirSync(ITEMS_DIR, {recursive:true}); }
function writeJSON(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

async function hfList(){
  // Public browse endpoint (documented): sort=downloads, limit
  const url = 'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=60';
  const res = await fetch(url);
  if (!res.ok) throw new Error('HF list failed ' + res.status);
  const arr = await res.json();
  return arr;
}

function mapModel(m){
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
      hf_downloads_7d: (m.downloads || 0),
      hf_likes: m.likes || 0,
    },
    score: 0,
    timeline: { t: [], stars: [], downloads: [] },
    summary: m.cardData?.summary || m.description || '',
    updated_at: m.lastModified || m.lastModifiedAt || new Date().toISOString(),
  };
}

function scoreModel(it){
  const dl = it.stats.hf_downloads_7d||0;
  const likes = it.stats.hf_likes||0;
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
    console.log('HF items:', items.length);
  }).catch(e=>{ console.error(e); process.exit(1); });
}
