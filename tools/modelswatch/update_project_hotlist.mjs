#!/usr/bin/env node
/* Update projects_hotlist.json: compute 7d stars/forks deltas, freshness, score; append repos per engineering category */
import fs from 'fs';
import { info } from './log.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCHEMA_VERSION } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const dataDir = path.join(root, 'data/ai/modelswatch');

const LIMIT_PER_CAT = Number(process.env.HOTLIST_LIMIT_PER_CATEGORY || '1');
const MIN_SEED_PER_CATEGORY = Number(process.env.HOTLIST_MIN_SEED_PER_CATEGORY || '2');
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

function ensureShape(obj){ if(!obj||typeof obj!=='object') return { version:1, updated_at:'', by_category:{} }; if(!obj.by_category) obj.by_category={}; if(typeof obj.version!=='number') obj.version=1; return obj; }

function loadProjectCategories(){
  const p = path.join(dataDir, 'project_categories.json');
  const j = readJSON(p); return j?.categories||[];
}

// Heuristic mapping from repo topics/name to engineering category key
function classifyRepo(repo, categories){
  const name = (repo.id||'').toLowerCase();
  const desc = (repo.summary||'').toLowerCase();
  const tags = (repo.tags||[]).map(t=>String(t).toLowerCase());
  function has(re){ return re.test(name) || re.test(desc) || tags.some(t=>re.test(t)); }
  const mapRules = [
    ['framework_core', /(framework|pytorch|tensorflow|jax|engine|runtime|training)/],
    ['deployment_serving', /(serve|serving|deploy|inference|endpoint|gateway)/],
    ['optimization_compilers', /(compile|compiler|kernels|optimi[sz]e|tvm|triton)/],
    ['data_tooling', /(dataset|data|evaluation|benchmark|annotat|label|eval)/],
    ['agents_workflows', /(agent|workflow|orchestr|automation)/],
    ['security_safety', /(security|safety|guard|attack|defen[cs]e|red[- ]?team|moderation)/],
    ['mlops_monitoring', /(mlops|monitor|observe|logging|dashboard|metrics)/],
    ['edge_embedded', /(edge|embedded|ondevice|mobile|arm|raspberry|micro)/],
    ['ui_devex', /(ui|devex|ide|extension|studio|playground)/]
  ];
  for(const [cat,re] of mapRules){ if(has(re) && categories.find(c=>c.key===cat)) return cat; }
  // fallback: choose first category to avoid dropping (or return null to skip)
  return categories.length? categories[0].key : null;
}

function computeScore(entry){
  const s7 = entry.stats.stars_7d||0;
  const f7 = entry.stats.forks_7d||0;
  const fresh = freshness(daysSince(entry.updated_at));
  return entry.score_engineering = 0.6*entry._z_s7 + 0.2*entry._z_f7 + 0.2*fresh;
}

async function main(){
  const today = dateKey(0); const day7 = dateKey(7);
  const snapToday = loadSnapshot(today, 'gh.json');
  const snap7 = loadSnapshot(day7, 'gh.json');
  const corpus = readJSON(path.join(dataDir, 'corpus.github.json')) || { items: [] };
  const catList = loadProjectCategories();
  const hotlistPath = path.join(dataDir, 'projects_hotlist.json');
  const hotlist = ensureShape(readJSON(hotlistPath));

  const existingIds = new Set();
  for(const arr of Object.values(hotlist.by_category)) arr.forEach(it=> existingIds.add(it.id));

  const candidates=[];
  for(const it of (corpus.items||[])){
    const id = it.id || it.repo_id || it.url || it.name; if(!id) continue;
    const snapT = snapToday[id] || { stars:0, forks:0, pushed_at: it.updated_at };
    const snapP = snap7[id] || { stars: snapT.stars, forks: snapT.forks, pushed_at: it.updated_at };
    const stars_7d = Math.max(0, (snapT.stars||0) - (snapP.stars||0));
    const forks_7d = Math.max(0, (snapT.forks||0) - (snapP.forks||0));
    const catKey = classifyRepo(it, catList);
    if(!catKey) continue;
    const entry = {
      id,
      source: 'github',
      name: it.name || id.split('/').pop(),
      url: it.url || `https://github.com/${id}`,
      tags: it.tags||[],
      stats: {
        stars_total: snapT.stars||0,
        forks_total: snapT.forks||0,
        stars_7d,
        forks_7d
      },
      updated_at: snapT.pushed_at || it.updated_at || new Date().toISOString(),
      added_at: today,
      summary: it.summary || '',
      flags: { pinned:false, hidden:false },
      category_key: catKey
    };
    candidates.push(entry);
  }

  const sVals = candidates.map(c=>c.stats.stars_7d);
  const fVals = candidates.map(c=>c.stats.forks_7d);
  const zS = zStats(sVals); const zF = zStats(fVals);
  candidates.forEach(c=>{ c._z_s7 = z(c.stats.stars_7d, zS); c._z_f7 = z(c.stats.forks_7d, zF); computeScore(c); });

  let appended=0;
  for(const cat of catList){
    const key = cat.key;
    const bucket = hotlist.by_category[key] || (hotlist.by_category[key]=[]);
    const pool = candidates.filter(c=> c.category_key===key && !existingIds.has(c.id));
    if(pool.length){
      pool.sort((a,b)=> b.score_engineering - a.score_engineering);
      const primary = pool.slice(0, LIMIT_PER_CAT);
      if(primary.length){
        bucket.push(...primary.map(p=>({
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
          score_engineering: p.score_engineering
        })));
        appended += primary.length;
      }
      if(bucket.length < MIN_SEED_PER_CATEGORY){
        const need = MIN_SEED_PER_CATEGORY - bucket.length;
        const extra = pool.slice(LIMIT_PER_CAT, LIMIT_PER_CAT + need).filter(x=> !bucket.some(b=>b.id===x.id));
        if(extra.length){
          bucket.push(...extra.map(p=>({
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
            score_engineering: p.score_engineering
          })));
          appended += extra.length;
        }
      }
    }
  }

  hotlist.updated_at = new Date().toISOString();
  hotlist.version = SCHEMA_VERSION;
  writeJSON(hotlistPath, hotlist);
  info(`[update_project_hotlist] appended ${appended} new entries across ${Object.keys(hotlist.by_category).length} categories`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
