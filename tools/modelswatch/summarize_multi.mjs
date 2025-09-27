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
const FORCE_PYTHON_FALLBACK = /^(1|true|yes|on)$/i.test(process.env.FORCE_PYTHON_FALLBACK||'');
const USE_PYTHON_SUMMARIZER = /^(1|true|yes|on)$/i.test(process.env.USE_PYTHON_SUMMARIZER||'');
const MAX_NETWORK_ERROR_STREAK = Number(process.env.SUMMARY_MAX_NETERR_STREAK || 25);
const HARD_ABORT_AFTER_STREAK = Number(process.env.SUMMARY_HARD_ABORT_STREAK || 8); // after this, skip further HTTP for the rest of the run
let networkErrorStreak = 0;
const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });

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
// Python fallback diagnostics
summarizeDiagnostics.python_fallback_invoked = 0;
summarizeDiagnostics.python_fallback_success = 0;
summarizeDiagnostics.python_fallback_errors = 0;

export async function summarizeTriJSON(prompt, opts={}){
  const BILINGUAL = /^(1|true|yes|on)$/i.test(process.env.BILINGUAL_MODE||'');
  if(USE_PYTHON_SUMMARIZER){
    if(DEBUG) console.log('[summarize_multi] USE_PYTHON_SUMMARIZER=on -> delegating to tri_summarizer.py');
    try {
      const { spawnSync } = await import('child_process');
      const code = `import sys,os,json;sys.path.insert(0, os.getcwd());from tools.tri_summarizer import tri_summary;print(json.dumps(tri_summary(${JSON.stringify(prompt)}), ensure_ascii=False))`;
      const r = spawnSync('python', ['-c', code], { encoding:'utf-8' });
      if(r.status===0){
        try { const parsed = JSON.parse(r.stdout); return { en: parsed.en||'', zh: parsed.zh||'', es: BILINGUAL ? (parsed.en||'') : (parsed.es||'') }; } catch(e){ if(DEBUG) console.log('[summarize_multi] python summarizer parse error', e.message); }
      } else {
        if(DEBUG) console.log('[summarize_multi] python summarizer failed', r.status, r.stderr?.slice(0,180));
      }
    } catch(e){ if(DEBUG) console.log('[summarize_multi] python summarizer exception', e.message); }
    return { en:'', zh:'', es:'' };
  }
  if(!API_KEY){
    if(DEBUG) console.log('[summarize_multi] No API key; skip generation');
    summarizeDiagnostics.empty++;
    return { en:'', zh:'', es:'' };
  }
  const temperature = opts.temperature ?? 0.4;
  // If we have exceeded a hard abort streak previously, go straight to python fallback (or empty)
  if(networkErrorStreak >= HARD_ABORT_AFTER_STREAK && !FORCE_PYTHON_FALLBACK){
    if(DEBUG) console.log('[summarize_multi] hard-abort active (streak', networkErrorStreak, ') -> skip HTTP, go fallback');
  }
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: BILINGUAL ? 'You are a precise summarizer. Output only valid JSON with keys summary_en, summary_zh.' : 'You are a precise summarizer. Output only valid JSON with keys summary_en, summary_zh, summary_es.' },
      { role: 'user', content: BILINGUAL ? `Given an open-source AI project description, produce bilingual factual summaries (English + Chinese).\nReturn JSON keys: summary_en, summary_zh.\nConstraints (guideline):\n- English: ~70-120 words.\n- Chinese: up to 300 汉字 (aim for a complete, factual paragraph).\nFocus: purpose, core capabilities, notable strengths, typical use cases. Avoid marketing or hype.\nOutput ONLY JSON.\nFACTS:\n${prompt}` : `Given an open-source AI project description, produce tri-lingual factual summaries.\nReturn JSON keys: summary_en, summary_zh, summary_es.\nConstraints (guideline):\n- English: ~70-120 words.\n- Chinese: up to 300 汉字 (aim for a complete, factual paragraph).\n- Spanish: ~70-120 words.\nFocus: purpose, core capabilities, notable strengths, typical use cases. Avoid marketing or hype.\nOutput ONLY JSON.\nFACTS:\n${prompt}` }
    ],
    temperature,
    // Increase token budget to reduce Chinese truncation risk
    max_tokens: 1600
  });
  async function attempt(){
    if(networkErrorStreak >= MAX_NETWORK_ERROR_STREAK){
      if(DEBUG) console.log('[summarize_multi] abort further attempts due to network error streak', networkErrorStreak);
      return { en:'', zh:'', es:'' };
    }
    if(networkErrorStreak >= HARD_ABORT_AFTER_STREAK && !FORCE_PYTHON_FALLBACK){
      // soft skip (do not even open socket) – rely on fallback later
      return { en:'', zh:'', es:'' };
    }
    return await new Promise(resolve=>{
      summarizeDiagnostics.attempts++;
      const url = `${BASE_URL}/chat/completions`;
      if(DEBUG) console.log('[summarize_multi] POST', url);
      summarizeDiagnostics.endpoints_tried.push('/chat/completions');
      const started = Date.now();
      const bodyBuf = Buffer.from(body);
      const req = https.request(url,{method:'POST',agent,headers:{
        'Content-Type':'application/json',
        'Accept':'application/json',
        'Content-Length': bodyBuf.length,
        'User-Agent':'modelswatch-summarizer/1.0',
        'Authorization':`Bearer ${API_KEY}`
      }}, res => {
        let data='';
        res.on('data', d=> data+=d);
        res.on('end', ()=>{
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
              if(parsed){
                  en = parsed.summary_en||''; zh = parsed.summary_zh||''; es = BILINGUAL ? (parsed.summary_en||'') : (parsed.summary_es||'');
              } else {
                summarizeDiagnostics.parse_fail++;
              }
            } else {
              summarizeDiagnostics.empty++;
            }
            if(en||zh||es) summarizeDiagnostics.success++; else summarizeDiagnostics.empty++;
            resolve({ en, zh, es });
          } catch(e){
            summarizeDiagnostics.parse_fail++;
            resolve({ en:'', zh:'', es:''});
          }
        });
      });
      req.on('error', e=> { summarizeDiagnostics.network_error++; networkErrorStreak++; summarizeDiagnostics.last_error = (e.code? e.code+': ':'') + e.message; if(DEBUG) console.log('[summarize_multi] network error', e.code, e.message); resolve({ en:'', zh:'', es:''}); });
      req.setTimeout(CONN_TIMEOUT, ()=> { req.destroy(); summarizeDiagnostics.network_error++; networkErrorStreak++; summarizeDiagnostics.last_error='timeout'; if(DEBUG) console.log('[summarize_multi] timeout'); resolve({ en:'', zh:'', es:''}); });
      req.write(bodyBuf); req.end();
    });
  }
  let out = await attempt();
  if(!FORCE_PYTHON_FALLBACK && !(out.en||out.zh||out.es) && summarizeDiagnostics.network_error>0 && summarizeDiagnostics.retries < 2 && networkErrorStreak < MAX_NETWORK_ERROR_STREAK){
    // Backoff retries (2 attempts total if network errors)
    for(let r=0; r<2 && !(out.en||out.zh||out.es); r++){
      await new Promise(res=> setTimeout(res, 500*(r+1)));
      summarizeDiagnostics.retries++;
      out = await attempt();
    }
  }
  if(FORCE_PYTHON_FALLBACK || !(out.en||out.zh||(BILINGUAL? false: out.es))){
    // PYTHON FALLBACK (Option B): invoke ai_llm.chat_once once, then heuristic split to tri-lingual via quick translation mini-prompts.
    if(DEBUG) console.log('[summarize_multi] invoking python fallback');
    summarizeDiagnostics.python_fallback_invoked++;
    try {
      const { spawnSync } = await import('child_process');
      // Ask Python LLM to produce a neutral English summary first (we'll translate below to avoid multi JSON complexity in cross-language fallback)
      const pyPrompt = `Summarize the following open-source AI project in 90 concise English words. Focus on purpose, core capabilities, strengths, and typical use cases. Avoid marketing.\n---\n${prompt}`.replace(/`/g,'');
      // Import path fixed: ai_llm.py lives under tools/, so use tools.ai_llm
      const pyCode = `import sys,os;sys.path.insert(0, os.getcwd());from tools.ai_llm import chat_once;import json;\ntext=chat_once(${JSON.stringify(pyPrompt)}, system='You are a precise summarizer.', temperature=0.3, max_tokens=512)\nprint(text.strip())`;
      const r = spawnSync('python',['-c',pyCode], { encoding:'utf-8' });
      if(r.status===0){
        const baseEn = (r.stdout||'').trim().replace(/\s+/g,' ').slice(0,900);
        if(baseEn){
          // Quick inline translation using same python adapter (sequential small calls)
          const cache = new Map();
          function callTrans(tag, instruction){
            if(cache.has(tag)) return cache.get(tag);
            const tPrompt = `${instruction}\n---\n${baseEn}`;
            const tCode = `import sys,os;sys.path.insert(0, os.getcwd());from tools.ai_llm import chat_once;print(chat_once(${JSON.stringify(tPrompt)}, system='You are a concise translator.', temperature=0.2, max_tokens=512).strip())`;
            const tr = spawnSync('python',['-c',tCode], { encoding:'utf-8' });
            if(tr.status===0){ const val=(tr.stdout||'').trim(); cache.set(tag,val); return val; }
            return '';
          }
          const zh = callTrans('zh','将以下英文精确翻译为不超过300汉字的中文摘要，保持技术名词准确，不加扩展解释，只保留核心事实：');
          let es = '';
          if(!BILINGUAL){
            es = callTrans('es','Traduce el siguiente resumen al español en 80-95 palabras, manteniendo términos técnicos y tono factual:');
          }
          out = { en: baseEn, zh: zh||'', es: BILINGUAL ? baseEn : (es||'') };
          if(out.en||out.zh||out.es){
            summarizeDiagnostics.success++;
            summarizeDiagnostics.python_fallback_success++;
            if(DEBUG) console.log('[summarize_multi] python fallback success lengths', { en: out.en.length, zh: out.zh.length, es: out.es.length });
          }
        }
          if(DEBUG) console.log('[summarize_multi] python fallback produced empty stdout');
      } else {
        if(DEBUG) console.log('[summarize_multi] python fallback failed status', r.status, 'stderr', r.stderr?.slice(0,200));
        summarizeDiagnostics.last_error = 'python_fallback_failed';
        summarizeDiagnostics.python_fallback_errors++;
      }
    } catch(e){
      if(DEBUG) console.log('[summarize_multi] python fallback exception', e.message);
      summarizeDiagnostics.last_error = 'python_fallback_exception:'+e.message;
      summarizeDiagnostics.python_fallback_errors++;
    }
  }
  if(out.en||out.zh||out.es) networkErrorStreak = 0; // reset streak on success
  return out;
}
