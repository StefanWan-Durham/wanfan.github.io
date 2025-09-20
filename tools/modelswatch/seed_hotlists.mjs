#!/usr/bin/env node
/* Seed hotlists to guarantee a minimum number of entries per task/category.
 * Strategy:
 *  - For models (HF): ensure each task key has at least MIN (default 2) entries.
 *  - For projects (GitHub): ensure each engineering category key has at least MIN entries.
 *  - Selection prioritizes corpus items with highest long-term total metrics (downloads_total/likes_total for HF, stars/forks for GitHub)
 *  - Avoid duplicates already present in the hotlist bucket.
 *  - Added entries get flags.seeded=true and score_model/score_engineering estimated using quick heuristic so sorting feels natural.
 */
import fs from 'fs';
import { info } from './log.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const dataDir = path.join(root, 'data/ai/modelswatch');

const MIN_PER = Number(process.env.HOTLIST_SEED_MIN || '2');
const FRESH_TAU = Number(process.env.HOTLIST_FRESHNESS_TAU_DAYS || '30');

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function writeJSON(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function daysSince(iso){ if(!iso) return 999; const t=Date.parse(iso); if(isNaN(t)) return 999; return (Date.now()-t)/86400000; }
function freshness(days){ return Math.exp(-days/Math.max(1,FRESH_TAU)); }

function ensureShape(obj){ if(!obj||typeof obj!=='object') return { version:1, updated_at:'', by_category:{} }; if(!obj.by_category) obj.by_category={}; if(typeof obj.version!=='number') obj.version=1; return obj; }

function estimateModelScore(stats, updated_at){
  const d7 = stats.downloads_7d || 0; // might be 0 at seed time
  const l7 = stats.likes_7d || 0;
  const dlTotal = stats.downloads_total || 0;
  const likeTotal = stats.likes_total || 0;
  const fresh = freshness(daysSince(updated_at));
  // Heuristic: use totals if deltas missing
  const baseD = d7 || dlTotal * 0.02; // assume ~2% week share if unknown
  const baseL = l7 || likeTotal * 0.05; // assume ~5% week share if unknown
  return 0.6*baseD + 0.3*baseL + 0.1*fresh*100;
}
function estimateProjectScore(stats, updated_at){
  const s7 = stats.stars_7d || 0;
  const f7 = stats.forks_7d || 0;
  const sTot = stats.stars_total || stats.stars || 0;
  const fTot = stats.forks_total || stats.forks || 0;
  const fresh = freshness(daysSince(updated_at));
  const baseS = s7 || sTot * 0.01; // assume ~1% week share
  const baseF = f7 || fTot * 0.01;
  return 0.6*baseS + 0.2*baseF + 0.2*fresh*100;
}

function loadCategories(){
  const aiCat = readJSON(path.join(dataDir,'ai_categories.json'));
  const catList = (aiCat?.categories)||aiCat||[];
  const taskKeys=[];
  (catList||[]).forEach(c=> (c.subcategories||[]).forEach(s=> (s.tasks||[]).forEach(t=> taskKeys.push(t.key))));
  return { taskKeys };
}
function loadProjectCategories(){
  const pc = readJSON(path.join(dataDir,'project_categories.json'));
  return (pc?.categories)||[];
}

function indexById(arr){ const m=new Map(); (arr||[]).forEach(it=>{ const id=it.id||it.repo_id||it.url||it.name; if(id) m.set(id,it);}); return m; }

function seedModels(){
  const corpus = readJSON(path.join(dataDir,'corpus.hf.json'))||{items:[]};
  const hotPath = path.join(dataDir,'models_hotlist.json');
  const hot = ensureShape(readJSON(hotPath));
  const { taskKeys } = loadCategories();
  const byId = indexById(corpus.items||[]);
  let added=0; let touched=0;

  for(const tk of taskKeys){
    const bucket = hot.by_category[tk] || (hot.by_category[tk]=[]);
    if(bucket.length >= MIN_PER) continue;
    touched++;
    // Build candidate pool: any corpus item whose tags or id includes token (lenient)
    const cand=[];
    for(const it of corpus.items||[]){
      const id = it.id||''; const tags=(it.tags||[]).map(t=>String(t).toLowerCase());
      const low = id.toLowerCase();
      if(low.includes(tk.toLowerCase()) || tags.includes(tk.toLowerCase())) cand.push(it);
    }
    // Fallback: global corpus if still empty
    const pool = cand.length? cand : corpus.items;
    const scored = pool.map(it=>{
      const stats = it.stats||{};
      const dl = stats.downloads_total || stats.hf_downloads_7d || 0;
      const likes = stats.likes_total || stats.hf_likes || 0;
      const pri = dl*0.002 + likes*0.5; // reuse earlier heuristic
      return { it, pri };
    }).sort((a,b)=> b.pri - a.pri);
    for(const {it} of scored){
      if(bucket.length >= MIN_PER) break;
      if(bucket.some(b=>b.id===it.id)) continue;
      const stats = { downloads_total: it.stats?.downloads_total||0, likes_total: it.stats?.likes_total||it.stats?.hf_likes||0 };
      const entry = {
        id: it.id, source:'hf', name: it.name||it.id.split('/').pop(), url: it.url||`https://huggingface.co/${it.id}`,
        tags: it.tags||[], stats, updated_at: it.updated_at||new Date().toISOString(), added_at: '', summary: it.summary||'', flags:{seeded:true}, score_model: estimateModelScore(stats, it.updated_at)
      };
      bucket.push(entry); added++;
    }
  }
  if(added>0){ hot.updated_at = new Date().toISOString(); writeJSON(hotPath, hot); }
  return { added, buckets:touched };
}

function seedProjects(){
  const corpus = readJSON(path.join(dataDir,'corpus.github.json'))||{items:[]};
  const hotPath = path.join(dataDir,'projects_hotlist.json');
  const hot = ensureShape(readJSON(hotPath));
  const cats = loadProjectCategories();
  let added=0; let touched=0;
  for(const cat of cats){
    const key = cat.key; const bucket = hot.by_category[key] || (hot.by_category[key]=[]);
    if(bucket.length >= MIN_PER) continue; touched++;
    // Candidate heuristics: try topic/desc/name match; fallback global
    const cand=[];
    for(const it of corpus.items||[]){
      const id = it.id||''; const tags=(it.tags||[]).map(t=>String(t).toLowerCase());
      const text = (it.summary||'') + ' ' + id;
      if(text.toLowerCase().includes(key.toLowerCase()) || tags.includes(key.toLowerCase())) cand.push(it);
    }
    const pool = cand.length? cand : corpus.items;
    const scored = pool.map(it=>{
      const s = it.stats||{}; const stars=s.stars||s.stars_total||0; const forks=s.forks||s.forks_total||0; const pri = stars + forks*0.2;
      return { it, pri };
    }).sort((a,b)=> b.pri - a.pri);
    for(const {it} of scored){
      if(bucket.length >= MIN_PER) break;
      if(bucket.some(b=>b.id===it.id)) continue;
      const stats = { stars_total: it.stats?.stars||0, forks_total: it.stats?.forks||0 };
      const entry = {
        id: it.id, source:'github', name: it.name||it.id.split('/').pop(), url: it.url||`https://github.com/${it.id}`,
        tags: it.tags||[], stats, updated_at: it.updated_at||new Date().toISOString(), added_at:'', summary: it.summary||'', flags:{seeded:true}, score_engineering: estimateProjectScore(stats, it.updated_at)
      };
      bucket.push(entry); added++;
    }
  }
  if(added>0){ hot.updated_at = new Date().toISOString(); writeJSON(hotPath, hot); }
  return { added, buckets:touched };
}

async function main(){
  const models = seedModels();
  const projects = seedProjects();
  info(`[seed_hotlists] models added=${models.added} bucketsTouched=${models.buckets}; projects added=${projects.added} bucketsTouched=${projects.buckets}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
