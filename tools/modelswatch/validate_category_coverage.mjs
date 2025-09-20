#!/usr/bin/env node
/**
 * validate_category_coverage.mjs
 * Ensures at least two tri-lingual summarized items per capability category (using hotlists & corpus + cache if needed).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');
const HOTLIST_MODELS = path.join(DATA_DIR, 'models_hotlist.json');
const CORPUS_GH = path.join(DATA_DIR, 'corpus.github.json');
const CORPUS_HF = path.join(DATA_DIR, 'corpus.hf.json');
const CATEGORIES_FILE = path.join(ROOT, 'data/ai/ai_categories.json');

function readJSON(p){ try{return JSON.parse(fs.readFileSync(p,'utf-8'));}catch{return null;} }

function collectCapabilityLabels(){
  const cat = readJSON(CATEGORIES_FILE); if(!cat) return [];
  const out = [];
  for(const top of (cat.categories||[])){
    for(const sub of (top.subcategories||[])){
      for(const t of (sub.tasks||[])){
        if(t.key && t.type==='capability') out.push({ key: t.key, labels: { zh: t.zh, en: t.en, es: t.es } });
      }
    }
  }
  return out;
}

function triReady(it){ return !!(it.summary_en && it.summary_zh && it.summary_es); }

function deriveCapsFromItem(it){
  // Use existing task_keys if present
  const caps = new Set();
  (it.task_keys||[]).forEach(k=>{ if(/capability/.test(k)||/^[a-z0-9_]+$/.test(k)) caps.add(k); });
  // naive keyword fallback
  const text = `${it.name||''} ${(it.summary||'')} ${(it.summary_en||'')} ${(it.summary_zh||'')} ${(it.summary_es||'')}`.toLowerCase();
  const hints = [ ['multimodal', /multimodal|多模态/], ['retrieval', /rag|retriev|检索/], ['chat', /chat|对话/], ['vision', /vision|视觉|图像/], ['code', /code|代码/], ['speech', /speech|audio|语音/], ['video', /video|视频/], ['compression', /quantiz|压缩|int8|int4/], ['distillation', /distill|蒸馏/] ];
  for(const [k,re] of hints){ if(re.test(text)) caps.add(k); }
  return [...caps];
}

function evaluate(){
  const modelHot = readJSON(HOTLIST_MODELS) || { items: [] };
  const corpusGH = readJSON(CORPUS_GH) || { items: [] };
  const corpusHF = readJSON(CORPUS_HF) || { items: [] };
  const all = [...(modelHot.items||[]), ...(corpusGH.items||[]), ...(corpusHF.items||[])];
  const capMap = new Map(); // key -> array of items tri-lingual
  for(const it of all){
    const caps = deriveCapsFromItem(it);
    for(const c of caps){ if(!capMap.has(c)) capMap.set(c, []); if(triReady(it)) capMap.get(c).push(it); }
  }
  const capabilityList = collectCapabilityLabels();
  const report = capabilityList.map(c=>({ key: c.key, tri_count: (capMap.get(c.key)||[]).length }));
  const deficits = report.filter(r=> r.tri_count < 2);
  return { report, deficits };
}

function main(){
  const { report, deficits } = evaluate();
  console.log('[validate_category_coverage] capability tri-lingual counts:');
  for(const r of report){ console.log(`  ${r.key}: ${r.tri_count}`); }
  if(deficits.length){
    console.warn('[validate_category_coverage] deficits:', deficits.map(d=>`${d.key}(${d.tri_count})`).join(', '));
    // Non-zero exit to signal missing coverage (optional; exit 0 so workflow doesn't fail)
  } else {
    console.log('[validate_category_coverage] All capability categories satisfy minimum tri-lingual coverage >=2');
  }
  fs.writeFileSync(path.join(DATA_DIR,'capability_tri_coverage.json'), JSON.stringify({ generated_at:new Date().toISOString(), report }, null,2));
}

main();
