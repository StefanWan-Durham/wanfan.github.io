// Shared multi-language summarization utilities for DeepSeek
import https from 'https';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
let RAW_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
RAW_BASE = RAW_BASE.replace(/\/$/, '');
// Ensure exactly one /v1 segment (DeepSeek OpenAI-compatible endpoint requirement)
if(!/\/v1$/.test(RAW_BASE)) RAW_BASE = RAW_BASE + '/v1';
const BASE_URL = RAW_BASE; // already includes /v1
const CONN_TIMEOUT = Number(process.env.LLM_CONN_TIMEOUT || 10000);
const DEBUG = /^(1|true|yes|on)$/i.test(process.env.MODELSWATCH_DEBUG||'');

// Diagnostics counters (exported for writer)
export const summarizeDiagnostics = {
  api_key_present: !!API_KEY,
  attempts: 0,
  success: 0,
  empty: 0,
  parse_fail: 0,
  network_error: 0,
  status_errors: {}, // statusCode -> count
  endpoint_fallbacks: 0,
  endpoints_tried: [],
  retries: 0,
  last_error: '',
  last_status: 0,
  last_body_excerpt: '',
  timings: [] // ms per attempt
};

export async function summarizeTriJSON(prompt, opts={}){
  if(!API_KEY){
    if(DEBUG) console.log('[summarize_multi] No API key; skip generation');
    summarizeDiagnostics.empty++;
    return { en:'', zh:'', es:'' };
  }
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
  async function attempt(){
    return await new Promise(resolve=>{
      summarizeDiagnostics.attempts++;
      const url = `${BASE_URL}/chat/completions`;
      if(DEBUG) console.log('[summarize_multi] POST', url);
      summarizeDiagnostics.endpoints_tried.push('/chat/completions');
      const started = Date.now();
      const req = https.request(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':'modelswatch-summarizer/1.0','Authorization':`Bearer ${API_KEY}`}},res=>{
        let data=''; res.on('data',d=>data+=d); res.on('end',()=>{
          summarizeDiagnostics.timings.push(Date.now()-started);
          if(res.statusCode && res.statusCode>=400){
            summarizeDiagnostics.status_errors[res.statusCode] = (summarizeDiagnostics.status_errors[res.statusCode]||0)+1;
            if(DEBUG) console.log('[summarize_multi] status', res.statusCode, 'body length', data.length);
          }
          summarizeDiagnostics.last_status = res.statusCode||0;
          summarizeDiagnostics.last_body_excerpt = (data||'').slice(0,180);
          try {
            const j = JSON.parse(data||'{}');
            const txt = j.choices?.[0]?.message?.content?.trim() || '';
            let en='', zh='', es='';
            if(txt){
              const cleaned = txt.replace(/```json|```/g,'').trim();
              function tryParse(str){ try { return JSON.parse(str); } catch { return null; } }
              let parsed = tryParse(cleaned);
              if(!parsed){
                const m = cleaned.match(/\{[\s\S]*?\}/);
                if(m) parsed = tryParse(m[0]);
              }
              if(parsed){ en=parsed.summary_en||''; zh=parsed.summary_zh||''; es=parsed.summary_es||''; }
              else summarizeDiagnostics.parse_fail++;
            } else {
              summarizeDiagnostics.empty++;
            }
            if(en||zh||es) summarizeDiagnostics.success++; else summarizeDiagnostics.empty++;
            resolve({ en, zh, es });
          } catch {
            summarizeDiagnostics.parse_fail++;
            resolve({ en:'', zh:'', es:''});
          }
        });
      });
      req.on('error',e=>{ summarizeDiagnostics.network_error++; summarizeDiagnostics.last_error = e.message; if(DEBUG) console.log('[summarize_multi] network error', e.message); resolve({ en:'', zh:'', es:''}); });
      req.setTimeout(CONN_TIMEOUT,()=>{ req.destroy(); summarizeDiagnostics.network_error++; summarizeDiagnostics.last_error = 'timeout'; resolve({ en:'', zh:'', es:''}); });
      req.write(body); req.end();
    });
  }
  let out = await attempt();
  if(!(out.en||out.zh||out.es) && summarizeDiagnostics.network_error>0 && summarizeDiagnostics.retries < 2){
    // Backoff retries (2 attempts total if network errors)
    for(let r=0; r<2 && !(out.en||out.zh||out.es); r++){
      await new Promise(res=> setTimeout(res, 500*(r+1)));
      summarizeDiagnostics.retries++;
      out = await attempt();
    }
  }
  return out;
}
