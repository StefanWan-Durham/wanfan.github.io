#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');

function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){ return null; } }
function writeJSON(p,obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function normalizeToTokens(s){
  if(!s) return [];
  return String(s).toLowerCase()
    .replace(/[:@#\/=]/g,' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g,' ')
    .split(/\s+/).filter(Boolean).map(t=> t.trim());
}

function normalizeAliasForm(tok){
  // prefer hyphen-separated alnum or raw CJK
  if(!tok) return '';
  const t = String(tok).toLowerCase().trim();
  if(/[\u4e00-\u9fff]/.test(t)) return t; // keep CJK as-is
  return t.replace(/[^a-z0-9]+/g,'-').replace(/(^-+|-+$)/g,'');
}

function collectHFItems(){
  const allPath = path.join(DATA_DIR, 'all_dates_hf.json');
  const dailyDir = path.join(DATA_DIR, 'daily');
  let items = [];
  const all = readJSON(allPath);
  if(all && Array.isArray(all.items) && all.items.length){
    items = all.items.slice();
  } else {
    try{
      const files = fs.readdirSync(dailyDir).filter(f=> f.endsWith('.json')).map(f=> path.join(dailyDir,f));
      for(const f of files){ const j = readJSON(f); if(j && Array.isArray(j.items)) items.push(...j.items); }
    }catch(e){ /* ignore */ }
  }
  return items;
}

function loadCategories(){
  const catPath = path.join(ROOT, 'data/ai/ai_categories.json');
  const j = readJSON(catPath) || {};
  const categories = j.categories || j || [];
  const keys = [];
  (categories||[]).forEach(c=> (c.subcategories||[]).forEach(s=> (s.tasks||[]).forEach(t=> keys.push(t.key))));
  return { categories, keys };
}

function buildTaskExampleMap(items){
  const map = new Map(); // task -> [texts]
  for(const it of items){
    const tks = Array.isArray(it.task_keys) ? it.task_keys : (it.task_keys? [it.task_keys] : []);
    if(!tks.length) continue;
    const textParts = [];
    if(it.name) textParts.push(it.name);
    if(it.id && String(it.id).includes('/')) textParts.push(String(it.id).split('/').pop());
    if(Array.isArray(it.tags)) textParts.push(...it.tags.slice(0,6));
    if(it.summary) textParts.push(it.summary);
    if(it.description) textParts.push(it.description);
    const text = textParts.join(' ');
    for(const tk of tks){
      if(!map.has(tk)) map.set(tk, []);
      map.get(tk).push(text);
    }
  }
  return map;
}

function topTokensFromTexts(texts, topN=20){
  const freq = Object.create(null);
  for(const t of texts){
    const toks = normalizeToTokens(t);
    for(const tk of toks){
      if(tk.length<2) continue;
      // ignore pure numbers
      if(/^\d+$/.test(tk)) continue;
      freq[tk] = (freq[tk]||0) + 1;
    }
  }
  const entries = Object.entries(freq).sort((a,b)=> b[1]-a[1]);
  return entries.slice(0, topN).map(e=> e[0]);
}

function loadExistingAliases(){
  const p = path.join(DATA_DIR, 'task_aliases.json');
  const j = readJSON(p) || {};
  const { _meta, ...rest } = j;
  return { raw: j, map: rest };
}

function generateCandidates(taskExampleMap, existingAliases){
  const out = Object.create(null);
  for(const [task, texts] of taskExampleMap.entries()){
    const tokens = topTokensFromTexts(texts, 50);
    const candidates = new Set();
    for(const tk of tokens){
      const al = normalizeAliasForm(tk);
      if(!al) continue;
      // skip if equals task key
      if(al === task) continue;
      // skip if already present in existing aliases
      const existList = existingAliases[task] || [];
      if(existList.map(x=>String(x).toLowerCase()).includes(al)) continue;
      candidates.add(al);
    }
    if(candidates.size) out[task] = [...candidates].slice(0,12);
  }
  return out;
}

function mergeAutogenIntoAliases(autogen, existingRaw){
  // place suggestions under _autogen key to avoid stomping manual edits
  const dst = Object.assign({}, existingRaw);
  if(!dst._autogen) dst._autogen = {};
  for(const [k, arr] of Object.entries(autogen)){
    dst._autogen[k] = Array.from(new Set([ ...(dst._autogen[k]||[]), ...arr ]));
  }
  return dst;
}

async function main(){
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const items = collectHFItems();
  if(!items.length){ console.error('[gen-alias] no HF items found (all_dates_hf.json or daily/).'); process.exit(2); }
  const { categories, keys } = loadCategories();
  if(!keys.length){ console.error('[gen-alias] no task keys found in ai_categories.json'); process.exit(2); }
  const taskExampleMap = buildTaskExampleMap(items);
  const existing = loadExistingAliases();
  const autogen = generateCandidates(taskExampleMap, existing.map);
  const outPath = path.join(DATA_DIR, 'task_aliases.autogen.json');
  writeJSON(outPath, { generated_at: new Date().toISOString(), suggestions: autogen });
  console.log('[gen-alias] wrote autogen suggestions to', path.relative(ROOT, outPath));
  const totalTasks = Object.keys(autogen).length; const totalCandidates = Object.values(autogen).reduce((s,a)=> s + (a?.length||0), 0);
  console.log('[gen-alias] suggestions for', totalTasks, 'tasks, total candidates=', totalCandidates);

  if(APPLY){
    const aliasPath = path.join(DATA_DIR, 'task_aliases.json');
    const bak = aliasPath + '.bak.' + Date.now();
    try{ fs.copyFileSync(aliasPath, bak); console.log('[gen-alias] backup existing task_aliases.json ->', path.relative(ROOT, bak)); }catch(e){ console.warn('[gen-alias] backup failed (file may not exist)', e.message); }
    const merged = mergeAutogenIntoAliases(autogen, existing.raw || {});
    writeJSON(aliasPath, merged);
    console.log('[gen-alias] merged autogen suggestions into', path.relative(ROOT, aliasPath), 'under _autogen');
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
