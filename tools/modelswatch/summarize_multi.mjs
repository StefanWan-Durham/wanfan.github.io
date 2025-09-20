// Shared multi-language summarization utilities for DeepSeek
import https from 'https';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const CONN_TIMEOUT = Number(process.env.LLM_CONN_TIMEOUT || 10000);

export async function summarizeTriJSON(prompt, opts={}){
  if(!API_KEY) return { en:'', zh:'', es:'' };
  const temperature = opts.temperature ?? 0.4;
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are a precise summarizer. Output only valid JSON with keys summary_en, summary_zh, summary_es.' },
      { role: 'user', content: `Given an open-source AI project description, produce tri-lingual factual summaries.\nReturn JSON keys: summary_en, summary_zh, summary_es.\nConstraints:\n- English: 70-90 words.\n- Chinese: 120-160 汉字。\n- Spanish: 70-90 words.\nFocus: purpose, core capabilities, notable strengths, typical use cases. Avoid marketing or hype.\nOutput ONLY JSON.\nFACTS:\n${prompt}` }
    ],
    temperature,
    max_tokens: 800
  });
  const url = `${BASE_URL}/v1/chat/completions`;
  return new Promise(resolve=>{
    const req = https.request(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${API_KEY}`}},res=>{
      let data=''; res.on('data',d=>data+=d); res.on('end',()=>{ try{ const j=JSON.parse(data); const txt=j.choices?.[0]?.message?.content?.trim()||''; let en='',zh='',es=''; if(txt){ try{ const parsed = JSON.parse(txt.replace(/```json|```/g,'')); en=parsed.summary_en||''; zh=parsed.summary_zh||''; es=parsed.summary_es||''; }catch{} } resolve({ en, zh, es }); }catch{ resolve({ en:'', zh:'', es:''}); } });
    });
    req.on('error',()=>resolve({ en:'', zh:'', es:''}));
    req.setTimeout(CONN_TIMEOUT,()=>{req.destroy(); resolve({ en:'', zh:'', es:''});});
    req.write(body); req.end();
  });
}
