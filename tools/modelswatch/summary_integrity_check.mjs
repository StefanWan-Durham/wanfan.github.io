#!/usr/bin/env node
/**
 * summary_integrity_check.mjs
 * Validate today's hf_summaries.json & gh_summaries.json for tri-lingual completeness.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const BASE = path.join(ROOT, 'data/ai/modelswatch');

function todayKey(){
  const d=new Date();
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }

const day = todayKey();
const dir = path.join(BASE,'snapshots',day);
const files = ['hf_summaries.json','gh_summaries.json'];
let issues = 0;
for(const f of files){
  const p = path.join(dir,f);
  if(!fs.existsSync(p)){ console.log(`::warning ::Missing summaries file ${f}`); issues++; continue; }
  const j = readJSON(p) || {};
  const broken = (j.items||[]).filter(it=> !(it.summary_en && it.summary_zh && it.summary_es));
  if(broken.length){
    console.log(`::warning ::${f} incomplete items=${broken.length}`);
    issues++;
  } else {
    console.log(`[summary_integrity] ${f} OK (${(j.items||[]).length} items)`);
  }
}
if(!issues){
  console.log('[summary_integrity] All tri-lingual summaries complete.');
}
