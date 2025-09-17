#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGithubTop } from './fetch_github.js';
import { fetchHFTop } from './fetch_hf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const outDir = path.join(root, 'data/ai/modelswatch');

function writeJSON(p, obj){ writeFileSync(p, JSON.stringify(obj, null, 2)); }

// Optional DeepSeek summarization (Chinese) for weekly tops
const DS_KEY = process.env.DEEPSEEK_API_KEY || '';
const DS_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DS_MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS||'768');
const LLM_CONN_TIMEOUT = Number(process.env.LLM_CONN_TIMEOUT||'30');
const LLM_READ_TIMEOUT = Number(process.env.LLM_READ_TIMEOUT||'240');

function withTimeout(ms){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(new Error('timeout')), ms);
  return { signal: controller.signal, clear: ()=>clearTimeout(timer) };
}

async function dsSummarizeChinese(prompt){
  if(!DS_KEY) return '';
  const url = `${DS_BASE}/chat/completions`;
  const body = {
    model: DS_MODEL,
    messages: [
      { role: 'system', content: '你是资深AI编辑。请用中文为给定开源项目或模型撰写一段4-6句的精炼摘要，面向泛技术读者，避免营销语，突出用途、亮点与适用场景。限制在280字以内。' },
      { role: 'user', content: prompt }
    ],
    max_tokens: DS_MAX_TOKENS,
    temperature: 0.3
  };
  const { signal, clear } = withTimeout(LLM_READ_TIMEOUT*1000);
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DS_KEY}` }, body: JSON.stringify(body)
  , signal});
  clear();
  if(!res.ok) return '';
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function dsSummarizeSpanish(prompt){
  if(!DS_KEY) return '';
  const url = `${DS_BASE}/chat/completions`;
  const body = {
    model: DS_MODEL,
    messages: [
      { role: 'system', content: 'Eres un editor técnico experto. Escribe un resumen breve en español (4-6 oraciones, máximo 280 caracteres) sobre el proyecto o modelo de código abierto dado. Evita el marketing, destaca uso, puntos fuertes y casos de uso.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: DS_MAX_TOKENS,
    temperature: 0.3
  };
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DS_KEY}` }, body: JSON.stringify(body)
  });
  if(!res.ok) return '';
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function dsSummarizeEnglish(prompt){
  if(!DS_KEY) return '';
  const url = `${DS_BASE}/chat/completions`;
  const body = {
    model: DS_MODEL,
    messages: [
      { role: 'system', content: 'You are a senior AI editor. Write a concise English summary (4-6 sentences, max ~280 chars) for the given open-source project or model, highlighting use cases, strengths, and applicability. No marketing fluff.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: DS_MAX_TOKENS,
    temperature: 0.3
  };
  const { signal, clear } = withTimeout(LLM_READ_TIMEOUT*1000);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DS_KEY}` }, body: JSON.stringify(body), signal });
  clear();
  if(!res.ok) return '';
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

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
        const [en, zh, es] = await Promise.all([
          dsSummarizeEnglish(prompt),
          dsSummarizeChinese(prompt),
          dsSummarizeSpanish(prompt)
        ]);
        const neutral = en || it.summary || it.description || zh || es || '';
        const patch = { summary: neutral };
        if(en) patch.summary_en = en;
        if(zh) patch.summary_zh = zh;
        if(es) patch.summary_es = es;
        return { ...it, ...patch };
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
}

main().catch(e=>{ console.error(e); process.exit(1); });
