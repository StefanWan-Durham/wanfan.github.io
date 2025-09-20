#!/usr/bin/env node
/**
 * deepseek_ping.mjs
 * Quick connectivity & endpoint diagnostic for DeepSeek OpenAI-compatible API.
 * Prints status, latency, body excerpt for /v1/chat/completions. Does NOT consume many tokens (uses a tiny prompt + max_tokens=1).
 */
import https from 'https';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
let RAW_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
RAW_BASE = RAW_BASE.replace(/\/$/, '');
if(!/\/v1$/.test(RAW_BASE)) RAW_BASE = RAW_BASE + '/v1';
const URL = `${RAW_BASE}/chat/completions`;

if(!API_KEY){
  console.log('NO_KEY');
  process.exit(0);
}

const payload = JSON.stringify({
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  messages: [ { role: 'user', content: 'ping' } ],
  max_tokens: 1,
  temperature: 0
});

const started = Date.now();
const req = https.request(URL, { method:'POST', headers:{ 'Content-Type':'application/json','Accept':'application/json','Authorization':`Bearer ${API_KEY}`,'User-Agent':'deepseek-ping/1.0'} }, res => {
  let data='';
  res.on('data', d=> data+=d);
  res.on('end', ()=>{
    const ms = Date.now()-started;
    let excerpt = data.slice(0,200).replace(/\s+/g,' ').trim();
    console.log(JSON.stringify({ url: URL, status: res.statusCode, latency_ms: ms, body_excerpt: excerpt }, null, 2));
  });
});
req.on('error', e=>{
  const ms = Date.now()-started;
  console.log(JSON.stringify({ url: URL, error: e.message, latency_ms: ms }, null, 2));
});
req.setTimeout(Number(process.env.LLM_CONN_TIMEOUT||10000), ()=>{ req.destroy(); const ms=Date.now()-started; console.log(JSON.stringify({ url: URL, timeout: true, latency_ms: ms }, null, 2)); });
req.write(payload); req.end();
