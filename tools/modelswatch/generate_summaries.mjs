#!/usr/bin/env node
/**
 * generate_summaries.mjs
 * Produce tri-lingual weekly summaries based on models_hotlist + coverage stats.
 * - Graceful fallback if no API key or request fails.
 * - Writes data/ai/modelswatch/weekly_summaries.json (overwrites unless --append-week differs).
 */
import fs from 'fs';
import path from 'path';
import https from 'https';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');
const HOTLIST_FILE = path.join(DATA_DIR, 'models_hotlist.json');
const COVERAGE_FILE = path.join(DATA_DIR, 'coverage_summary.json');
const OUT_FILE = path.join(DATA_DIR, 'weekly_summaries.json');
const SCHEMA_VERSION = 1;

const FORCE = process.argv.includes('--force');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const CONN_TIMEOUT = Number(process.env.LLM_CONN_TIMEOUT || 10000);
const READ_TIMEOUT = Number(process.env.LLM_READ_TIMEOUT || 20000);

function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function writeJSON(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function isoWeek(date=new Date()){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

function buildStats(){
  const hotlist = readJSON(HOTLIST_FILE) || { by_category:{} };
  const coverage = readJSON(COVERAGE_FILE) || {};
  const byCat = hotlist.by_category || {};
  const taskDist = Object.entries(byCat).map(([k, arr])=> ({ task:k, count:arr.length }))
    .sort((a,b)=> b.count - a.count);
  const totalModels = taskDist.reduce((a,b)=>a+b.count,0);
  const distinctTasks = taskDist.length;
  const emerging = Array.isArray(coverage.zeroTasks) ? [] : []; // placeholder; emerging detection would need prior snapshot
  return { taskDist, totalModels, distinctTasks, emerging };
}

function truncate(s, max){ if(!s) return ''; if(s.length<=max) return s; return s.slice(0,max-1)+'…'; }

function buildContext(){
  const { taskDist, totalModels, distinctTasks } = buildStats();
  const top = taskDist.slice(0,10).map(t=> `${t.task}:${t.count}`).join(', ');
  return { taskDist, totalModels, distinctTasks, topLine: top };
}

async function callLLM(prompt, lang){
  if(!API_KEY){ return { text: fallbackText(lang, 'no_api_key') }; }
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are an analyst producing concise factual weekly summaries about open-source AI model trends.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 400
  });
  const url = `${BASE_URL}/v1/chat/completions`;
  return new Promise((resolve)=>{
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    }, res => {
      let data='';
      res.on('data', d=> data+=d);
      res.on('end', ()=>{
        try {
          const j = JSON.parse(data);
          const text = j.choices?.[0]?.message?.content?.trim() || fallbackText(lang,'empty');
          resolve({ text });
        } catch(e){
          console.warn('[summaries] parse error', e); resolve({ text: fallbackText(lang,'parse_error') });
        }
      });
    });
    req.on('error', e=>{ console.warn('[summaries] request error', e); resolve({ text: fallbackText(lang,'net_error') }); });
    req.setTimeout(CONN_TIMEOUT, ()=>{ console.warn('[summaries] conn timeout'); req.destroy(); resolve({ text: fallbackText(lang,'timeout') }); });
    req.write(body); req.end();
  });
}

function fallbackText(lang, reason){
  const base = {
    zh: '（本周摘要暂不可用）',
    en: '(Weekly summary unavailable)',
    es: '(Resumen semanal no disponible)'
  };
  return base[lang] + (reason?` [${reason}]`: '');
}

function buildPrompts(ctx){
  const baseFacts = `Total models classified this week: ${ctx.totalModels}. Distinct tasks: ${ctx.distinctTasks}. Top tasks by count: ${ctx.topLine}.`;
  return {
    zh: `请用不超过140个汉字客观总结本周开源AI模型趋势。避免夸张。事实: ${baseFacts}`,
    en: `In under 120 English words, summarize this week's open-source AI model activity factually. Avoid hype. Facts: ${baseFacts}`,
    es: `En menos de 120 palabras en español, resume la actividad semanal de modelos de IA de código abierto. Evita exageraciones. Hechos: ${baseFacts}`
  };
}

async function main(){
  const period = isoWeek();
  const ctx = buildContext();
  const prompts = buildPrompts(ctx);
  console.log('[summaries] generating for', period);
  const langs = ['zh','en','es'];
  const results = {};
  for(const L of langs){
    const { text } = await callLLM(prompts[L], L);
    results[L] = truncate(text, 1200);
  }

  const out = {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    period,
    sections: {
      overview: { zh: results.zh, en: results.en, es: results.es }
    },
    meta: {
      task_distribution: ctx.taskDist,
      emerging: ctx.emerging || [],
      generated_with_model: API_KEY? MODEL : 'fallback',
      hotlist_version: (readJSON(HOTLIST_FILE)?.version)||0
    }
  };
  writeJSON(OUT_FILE, out);
  console.log('[summaries] wrote', OUT_FILE);
}

main().catch(e=>{ console.error(e); process.exit(1); });
