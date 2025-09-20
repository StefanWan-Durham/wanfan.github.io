# -*- coding: utf-8 -*-
"""Python-first tri-lingual summarizer using provider failover via ai_llm.chat_once.

Design:
 1. Request JSON with three language fields in one call if provider supports JSON mode.
 2. If JSON parse fails, fall back to sequential generation: EN -> ZH -> ES using translation prompts.
 3. Exposed function: tri_summary(prompt:str) -> dict(en, zh, es, meta)

Environment:
  - Respects provider keys set for ai_llm.py (OpenAI, OpenRouter, Together, DeepSeek, DashScope)
  - Optional: TRI_JSON_FIRST (default true) to attempt single JSON call
  - Optional: TRI_MODEL_TEMPERATURE (default 0.35)
"""
from __future__ import annotations
import json, os, time, sys
from typing import Dict, Any, List, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
# Ensure repository root (parent of this 'tools' dir) is on sys.path so 'tools.ai_llm' works when executing this file directly.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_THIS_DIR, '..'))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from tools.ai_llm import chat_once, LLMError  # type: ignore

def _build_json_instruction():
    bilingual = os.getenv('BILINGUAL_MODE','0').lower() in ('1','true','yes','on')
    if bilingual:
        return (
            "Return ONLY compact JSON with keys: summary_en, summary_zh. "
            "Constraints: summary_en 70-90 words; summary_zh 120-160 汉字. "
            "Factual, no marketing, cover purpose, core capabilities, strengths, typical use cases."
        )
    return (
        "Return ONLY compact JSON with keys: summary_en, summary_zh, summary_es. "
        "Constraints: summary_en 70-90 words; summary_zh 120-160 汉字; summary_es 70-90 words. "
        "Factual, no marketing, cover purpose, core capabilities, strengths, typical use cases."
    )
JSON_TEMPLATE_INSTRUCTION = _build_json_instruction()

TRANSLATE_ZH = (
    "将以下英文摘要翻译为 120-160 汉字的专业中文摘要，保持技术名词准确，语句精炼，不添加新信息："
)

TRANSLATE_ES = (
    "Traduce el siguiente resumen al español (70-90 palabras), mantener términos técnicos y tono factual sin añadir información nueva:"
)

def _now():
    return time.time()

def _call_json(prompt: str, temperature: float) -> Dict[str, Any]:
    bilingual = os.getenv('BILINGUAL_MODE','0').lower() in ('1','true','yes','on')
    example = '{"summary_en":"...","summary_zh":"..."}' if bilingual else '{"summary_en":"...","summary_zh":"...","summary_es":"..."}'
    base_prompt = (
        f"{JSON_TEMPLATE_INSTRUCTION}\n---\n{prompt}\n---\nExample JSON format: "
        f"{example}"
    )
    text = chat_once(base_prompt, system="You are a precise multilingual summarizer.", temperature=temperature, max_tokens=900, want_json=True)
    # Some providers return raw JSON text; others may embed code fences.
    cleaned = text.strip().strip('`')
    try:
        return json.loads(cleaned)
    except Exception:
        # try extract {...}
        import re
        m = re.search(r'\{[\s\S]*\}', cleaned)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
        raise


_CACHE: Dict[str, Dict[str, Any]] = {}
_PERSIST_CACHE: Dict[str, Dict[str, str]] = {}
_PERSIST_FILE = os.getenv('TRI_CACHE_FILE')  # e.g. data/ai/modelswatch/tri_cache.json
_PERSIST_ENABLED = bool(_PERSIST_FILE)
_PERSIST_DIR_CREATED = False
_DIAG = {
    "cache_hits": 0,
    "cache_misses": 0,
    "items": [],  # per prompt meta snapshot
    "started_at": None,
    "finished_at": None,
}

def _ensure_persist_loaded():
    global _PERSIST_CACHE, _PERSIST_DIR_CREATED
    if not _PERSIST_ENABLED:
        return
    if _PERSIST_CACHE:
        return
    try:
        if os.path.isfile(_PERSIST_FILE):
            with open(_PERSIST_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict) and 'items' in data:
                    _PERSIST_CACHE = data['items'] or {}
    except Exception:
        _PERSIST_CACHE = {}
    # ensure directory exists for later write
    try:
        d = os.path.dirname(_PERSIST_FILE)
        if d and not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        _PERSIST_DIR_CREATED = True
    except Exception:
        pass

def _persist_flush():
    if not _PERSIST_ENABLED:
        return
    if not _PERSIST_DIR_CREATED:
        return
    try:
        with open(_PERSIST_FILE, 'w', encoding='utf-8') as f:
            json.dump({ 'version': 1, 'items': _PERSIST_CACHE }, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def _hash_prompt(prompt: str) -> str:
    return hashlib.sha256(prompt.encode('utf-8')).hexdigest()[:16]

def _enforce_length(en: str, zh: str, es: str) -> Tuple[str, str, str, List[str]]:
    """Apply soft length enforcement and trimming rules.

    Rules:
      EN target 70-90 words (hard trim 100)
      ZH target 120-160 汉字 (hard trim 180)
      ES target 70-90 words (hard trim 100)
    If too short (<60% lower bound) add meta warning (not expanding here to keep deterministic cost low).
    """
    warnings: List[str] = []
    def _word_count(t: str) -> int:
        return len([w for w in t.strip().split() if w])
    def _char_cn(t: str) -> int:
        # crude: count non-whitespace CJK range chars
        return sum(1 for ch in t if '\u4e00' <= ch <= '\u9fff')

    # English
    wc_en = _word_count(en)
    if wc_en > 100:
        # trim at ~100 words
        parts = en.split()
        en = ' '.join(parts[:100])
        warnings.append(f"en_trimmed:{wc_en}->100")
    elif wc_en < 42:  # 60% of 70
        warnings.append(f"en_short:{wc_en}")

    # Chinese
    cn_len = _char_cn(zh)
    if cn_len > 180:
        # approximate trim retaining Chinese chars order
        cnt = 0
        new_chars = []
        for ch in zh:
            if '\u4e00' <= ch <= '\u9fff':
                cnt += 1
            if cnt > 180: break
            new_chars.append(ch)
        zh = ''.join(new_chars)
        warnings.append(f"zh_trimmed:{cn_len}->180")
    elif  cn_len < 72:  # 60% of 120
        warnings.append(f"zh_short:{cn_len}")

    # Spanish
    wc_es = _word_count(es)
    if wc_es > 100:
        parts = es.split()
        es = ' '.join(parts[:100])
        warnings.append(f"es_trimmed:{wc_es}->100")
    elif wc_es < 42:
        warnings.append(f"es_short:{wc_es}")

    return en, zh, es, warnings

def _rewrite(lang: str, content: str, original: str, target: str) -> str:
    """Rewrite trimmed content more semantically instead of hard cut.
    lang: 'en'|'zh'|'es'
    target: description of target length range.
    """
    if not original.strip():
        return content
    if lang == 'en':
        prompt = (f"Rewrite the following English summary into a coherent {target} factual paragraph without losing key points. Remove redundancy and keep neutral tone.\n---\n{original}")
        return chat_once(prompt, system="You are a precise summarizer.", temperature=0.25, max_tokens=650)
    if lang == 'zh':
        prompt = (f"将下面的英文/中文摘要重新压缩改写为{target}的中文摘要，保持关键信息、技术点与客观语气，不要机械截断：\n---\n{original}")
        return chat_once(prompt, system="You are a precise summarizer.", temperature=0.25, max_tokens=650)
    if lang == 'es':
        prompt = (f"Reescribe el siguiente resumen en un párrafo factual de {target}, manteniendo puntos clave y eliminando redundancias:\n---\n{original}")
        return chat_once(prompt, system="You are a precise summarizer.", temperature=0.25, max_tokens=650)
    return content

def _expand(lang: str, content: str, target: str) -> str:
    if not content.strip():
        return content
    if lang == 'en':
        prompt = (f"Expand the following English summary to {target} while remaining concise, factual, and avoiding hype. Add missing concrete capabilities or example use cases only if implied:\n---\n{content}")
        return chat_once(prompt, system="You are a precise summarizer.", temperature=0.3, max_tokens=650)
    if lang == 'zh':
        prompt = (f"将下面偏短的中文摘要自然扩展至{target}，保持技术名词准确，不引入无根据信息，可补充典型应用或特性：\n---\n{content}")
        return chat_once(prompt, system="You are a precise summarizer.", temperature=0.3, max_tokens=650)
    if lang == 'es':
        prompt = (f"Expande el siguiente resumen al español hasta {target}, manteniendo tono objetivo, añadiendo ejemplos o capacidades si son coherentes:\n---\n{content}")
        return chat_once(prompt, system="You are a precise summarizer.", temperature=0.3, max_tokens=650)
    return content

def tri_summary(prompt: str) -> Dict[str, Any]:
    t0 = _now()
    temperature = float(os.getenv("TRI_MODEL_TEMPERATURE", "0.35"))
    speed_mode = os.getenv('SPEED_MODE','0').lower() in ('1','true','yes','on')
    attempt_json_first = os.getenv("TRI_JSON_FIRST", "1").lower() in ("1","true","yes","on")
    bilingual = os.getenv('BILINGUAL_MODE','0').lower() in ('1','true','yes','on')
    if speed_mode:
        # In speed mode, we may disable JSON-first if explicitly requested via TRI_JSON_FIRST=0
        # else keep behavior but disable rewrite/expand later.
        pass
    meta = {"json_first": attempt_json_first, "path": "", "errors": []}

    en = zh = es = ""

    if attempt_json_first:
        try:
            meta["path"] = "json_single"
            parsed = _call_json(prompt, temperature)
            en = (parsed.get("summary_en") or "").strip()
            zh = (parsed.get("summary_zh") or "").strip()
            if bilingual:
                # In bilingual mode we intentionally skip Spanish; reuse EN later for es field
                es = ''
            else:
                es = (parsed.get("summary_es") or "").strip()
        except Exception as e:
            meta["errors"].append(f"json_first_failed:{type(e).__name__}:{str(e)[:160]}")
            en = zh = es = ""

    # Optional: if UNIFIED_JSON_NO_SEQ set and we got ANY content from JSON path, skip sequential to save tokens.
    unified_no_seq = os.getenv('UNIFIED_JSON_NO_SEQ','0').lower() in ('1','true','yes','on')
    # For bilingual mode, completion criteria changes: need only en & zh
    need_all = (not bilingual and not (en and zh and es)) or (bilingual and not (en and zh))
    if need_all and not (unified_no_seq and (en or zh or es)):
        # sequential fallback
        meta["path"] = meta.get("path","") + ("+seq" if meta.get("path") else "seq")
        try:
            en_prompt = (
                "Summarize the following open-source AI project in 80 English words. "
                "Cover purpose, core capabilities, notable strengths, and typical real-world use cases. "
                "Remove marketing fluff.\n---\n" + prompt
            )
            en = chat_once(en_prompt, system="You are a precise summarizer.", temperature=temperature, max_tokens=600)
        except Exception as e:
            meta["errors"].append(f"en_failed:{type(e).__name__}:{str(e)[:160]}")
            en = ""
        if en:
            try:
                zh = chat_once(f"{TRANSLATE_ZH}\n---\n{en}", system="You are a professional translator.", temperature=0.2, max_tokens=600)
            except Exception as e:
                meta["errors"].append(f"zh_failed:{type(e).__name__}:{str(e)[:160]}")
                zh = ""
            if not bilingual:
                try:
                    es = chat_once(f"{TRANSLATE_ES}\n---\n{en}", system="You are a professional translator.", temperature=0.25, max_tokens=600)
                except Exception as e:
                    meta["errors"].append(f"es_failed:{type(e).__name__}:{str(e)[:160]}")
                    es = ""

    raw_en, raw_zh, raw_es = en, zh, es
    # Enforce soft constraints
    en, zh, es, warn_list = _enforce_length(en.strip(), zh.strip(), es.strip())
    if warn_list:
        meta.setdefault("warnings", []).extend(warn_list)

    enable_rewrite = os.getenv("TRI_ENABLE_REWRITE", "1").lower() in ("1","true","yes","on") and not speed_mode
    enable_expand = os.getenv("TRI_ENABLE_EXPAND", "0").lower() in ("1","true","yes","on") and not speed_mode
    rewrote = []
    expanded = []
    # Rewrite for trimmed
    if enable_rewrite:
        if any(w.startswith('en_trimmed') for w in warn_list) and raw_en:
            try:
                en = _rewrite('en', en, raw_en, '80-90 words')
                rewrote.append('en')
            except Exception as e:
                meta.setdefault('errors', []).append(f'en_rewrite_failed:{type(e).__name__}')
        if any(w.startswith('zh_trimmed') for w in warn_list) and raw_zh:
            try:
                zh = _rewrite('zh', zh, raw_zh, '约130-150汉字')
                rewrote.append('zh')
            except Exception as e:
                meta.setdefault('errors', []).append(f'zh_rewrite_failed:{type(e).__name__}')
        if any(w.startswith('es_trimmed') for w in warn_list) and raw_es:
            try:
                es = _rewrite('es', es, raw_es, '80-90 palabras')
                rewrote.append('es')
            except Exception as e:
                meta.setdefault('errors', []).append(f'es_rewrite_failed:{type(e).__name__}')
    # Expand for short
    if enable_expand:
        if any(w.startswith('en_short') for w in warn_list) and en:
            try:
                en = _expand('en', en, '70-90 words')
                expanded.append('en')
            except Exception as e:
                meta.setdefault('errors', []).append(f'en_expand_failed:{type(e).__name__}')
        if any(w.startswith('zh_short') for w in warn_list) and zh:
            try:
                zh = _expand('zh', zh, '120-160汉字')
                expanded.append('zh')
            except Exception as e:
                meta.setdefault('errors', []).append(f'zh_expand_failed:{type(e).__name__}')
        if any(w.startswith('es_short') for w in warn_list) and es:
            try:
                es = _expand('es', es, '70-90 palabras')
                expanded.append('es')
            except Exception as e:
                meta.setdefault('errors', []).append(f'es_expand_failed:{type(e).__name__}')
    if rewrote or expanded:
        # Re-run enforcement after modifications
        en, zh, es, warn_list2 = _enforce_length(en.strip(), zh.strip(), es.strip())
        if warn_list2:
            meta.setdefault('warnings', []).extend(warn_list2)
    if rewrote:
        meta['rewritten'] = rewrote
    if expanded:
        meta['expanded'] = expanded
    meta["elapsed_sec"] = round(_now()-t0,3)
    if bilingual:
        # Provide es as a direct alias to en for downstream compatibility (UI can treat Spanish as English fallback)
        if not es:
            es = en
    meta["ok"] = bool(en or zh or es)
    return {"en": en, "zh": zh, "es": es, "meta": meta}

def tri_summary_cached(prompt: str) -> Dict[str, Any]:
    """Wrapper adding in-memory cache (lifecycle of process)."""
    _ensure_persist_loaded()
    h = _hash_prompt(prompt)
    if h in _CACHE:
        _DIAG["cache_hits"] += 1
        cached = _CACHE[h]
        # shallow copy to avoid mutation propagation
        cpy = {k: cached[k] for k in ("en","zh","es","meta")}
        cpy["meta"] = dict(cached["meta"], cache_hit=True)
        return cpy
    # check persistent cache
    if _PERSIST_ENABLED and h in _PERSIST_CACHE:
        _DIAG["cache_hits"] += 1
        entry = _PERSIST_CACHE[h]
        res = { 'en': entry.get('en',''), 'zh': entry.get('zh',''), 'es': entry.get('es',''), 'meta': { 'ok': True, 'path': 'persist', 'hash': h, 'cache_hit': True } }
        _CACHE[h] = res
        return res
    _DIAG["cache_misses"] += 1
    res = tri_summary(prompt)
    _CACHE[h] = res
    res["meta"]["cache_hit"] = False
    res["meta"]["hash"] = h
    if _PERSIST_ENABLED and res['en']:
        # store minimal persist entry (only if we have at least English)
        _PERSIST_CACHE[h] = { 'en': res['en'], 'zh': res['zh'], 'es': res['es'] }
    return res

def tri_summary_batch(prompts: List[str]) -> Dict[str, Any]:
    """Process a list of prompts, returning list of results + diagnostics.

    Structure:
      {
        "results": [ {en, zh, es, meta}, ...],
        "diagnostics": {
            cache_hits, cache_misses, total, ok_count, json_path_count, seq_path_count,
            warnings_total, errors_total, elapsed_sec
        }
      }
    """
    if _DIAG["started_at"] is None:
        _DIAG["started_at"] = time.time()
    batch_t0 = time.time()
    results = []
    ok_count = 0
    json_path = 0
    seq_path = 0
    warnings_total = 0
    errors_total = 0
    concurrency = int(os.getenv("TRI_BATCH_CONCURRENCY", "1") or "1")
    concurrency = max(1, concurrency)
    # Batch start header (stderr so JSON stdout stays clean)
    try:
        sys.stderr.write(f"[tri_summarizer][batch-start] size={len(prompts)} concurrency={concurrency}\n")
    except Exception:
        pass
    progress_interval = float(os.getenv('BATCH_PROGRESS_INTERVAL','0')) or 0.0
    next_progress = progress_interval if progress_interval>0 else None
    processed = 0
    group_size = int(os.getenv('TRI_GROUP_JSON_SIZE','1') or '1')
    bilingual = os.getenv('BILINGUAL_MODE','0').lower() in ('1','true','yes','on')
    use_group = group_size > 1

    # Pre-load cache hits quickly if using group mode (so we only aggregate the misses)
    if use_group:
        cache_hits_index = []
        misses_index = []
        for i,p in enumerate(prompts):
            h = _hash_prompt(p)
            _ensure_persist_loaded()
            cached = None
            if h in _CACHE:
                cached = _CACHE[h]
            elif _PERSIST_ENABLED and h in _PERSIST_CACHE:
                entry = _PERSIST_CACHE[h]
                cached = { 'en': entry.get('en',''), 'zh': entry.get('zh',''), 'es': entry.get('es',''), 'meta': { 'ok': True, 'path': 'persist', 'hash': h, 'cache_hit': True } }
                _CACHE[h] = cached
            if cached:
                results.append({k: cached[k] for k in ('en','zh','es','meta')})
                cache_hits_index.append(i)
                processed += 1
            else:
                # placeholder; will fill later
                results.append(None)  # type: ignore
                misses_index.append(i)
        if next_progress and processed >= next_progress:
            sys.stderr.write(f"[tri_summarizer][progress] {processed}/{len(prompts)} done (cache)\n")
            sys.stderr.flush()
            next_progress += progress_interval

        def _aggregate_call(chunk_indices: List[int]):
            # Build a single prompt instructing JSON array mapping index-> summaries
            sub_prompts = [(i, prompts[i]) for i in chunk_indices]
            # Construct instruction
            example_obj = '{"index":1,"summary_en":"...","summary_zh":"..."}' if bilingual else '{"index":1,"summary_en":"...","summary_zh":"...","summary_es":"..."}'
            join_text = []
            for idx, p in sub_prompts:
                join_text.append(f"ITEM {idx}:\n{p}\n---")
            joined = '\n'.join(join_text)
            group_instruction = (
                "You will receive multiple open-source AI project descriptions. For EACH item produce concise factual summaries. "
                + ("Return ONLY JSON array; each element has keys: index, summary_en, summary_zh." if bilingual else "Return ONLY JSON array; each element has keys: index, summary_en, summary_zh, summary_es.")
                + " summary_en 70-90 words; summary_zh 120-160 汉字; "
                + ("" if bilingual else "summary_es 70-90 words; ")
                + "NO marketing. Maintain order by index. If an item is unclear still output an empty string for missing summaries."
            )
            full_prompt = f"{group_instruction}\n---\n{joined}\nExample: [{example_obj}]"
            try:
                raw = chat_once(full_prompt, system="You are a precise multilingual summarizer.", temperature=float(os.getenv('TRI_MODEL_TEMPERATURE','0.35')), max_tokens= min(3000, 900*len(sub_prompts)), want_json=True)
            except Exception as e:
                raise
            txt = raw.strip().strip('`')
            try:
                data = json.loads(txt)
            except Exception:
                # try extract bracket content
                import re
                m = re.search(r'\[[\s\S]*\]', txt)
                if not m:
                    raise
                data = json.loads(m.group(0))
            if not isinstance(data, list):
                raise ValueError('aggregate JSON not list')
            # index->record map
            mapping = {}
            for obj in data:
                if isinstance(obj, dict) and 'index' in obj:
                    mapping[int(obj['index'])] = obj
            for idx,_prompt in sub_prompts:
                obj = mapping.get(idx, {})
                en = (obj.get('summary_en') or '').strip()
                zh = (obj.get('summary_zh') or '').strip()
                es = '' if bilingual else (obj.get('summary_es') or '').strip()
                if bilingual and not es:
                    es = en
                h = _hash_prompt(_prompt)
                meta = { 'ok': bool(en or zh or es), 'path': 'json_group', 'hash': h }
                r = { 'en': en, 'zh': zh, 'es': es, 'meta': meta }
                _CACHE[h] = r
                if _PERSIST_ENABLED and en:
                    _PERSIST_CACHE[h] = { 'en': en, 'zh': zh, 'es': es }
                results[idx] = r
        # Process misses in chunks
        for start in range(0, len(misses_index), group_size):
            chunk = misses_index[start:start+group_size]
            try:
                _aggregate_call(chunk)
            except Exception as e:
                # fallback per-item for this chunk
                for idx in chunk:
                    try:
                        r = tri_summary_cached(prompts[idx])
                    except Exception as e2:
                        r = { 'en':'','zh':'','es':'','meta': { 'ok': False, 'errors':[f'agg_item_fail:{type(e2).__name__}'], 'path':'group_fallback' } }
                    results[idx] = r
            processed = sum(1 for v in results if v is not None)
            if next_progress and processed >= next_progress:
                sys.stderr.write(f"[tri_summarizer][progress] {processed}/{len(prompts)} done\n")
                sys.stderr.flush()
                next_progress += progress_interval
    else:
        # Original path (no grouping)
        if concurrency == 1:
            iterable = enumerate(prompts)
            for idx, p in iterable:
                r = tri_summary_cached(p)
                results.append(r)
                processed += 1
                if next_progress and processed >= next_progress:
                    sys.stderr.write(f"[tri_summarizer][progress] {processed}/{len(prompts)} done\n")
                    sys.stderr.flush()
                    next_progress += progress_interval
        else:
            with ThreadPoolExecutor(max_workers=concurrency) as ex:
                future_map = {ex.submit(tri_summary_cached, p): i for i, p in enumerate(prompts)}
                temp_results = [None]*len(prompts)
                for fut in as_completed(future_map):
                    i = future_map[fut]
                    try:
                        temp_results[i] = fut.result()
                    except Exception as e:
                        temp_results[i] = {"en":"","zh":"","es":"","meta":{"ok":False,"errors":[f"batch_exc:{type(e).__name__}"],"path":"batch"}}
                    processed += 1
                    if next_progress and processed >= next_progress:
                        sys.stderr.write(f"[tri_summarizer][progress] {processed}/{len(prompts)} done\n")
                        sys.stderr.flush()
                        next_progress += progress_interval
                results.extend(temp_results)
    # aggregate meta
    for r in results:
        m = r["meta"]
        ok_count += 1 if m.get("ok") else 0
        if "json_single" in m.get("path",""):
            json_path += 1
        if "seq" in m.get("path",""):
            seq_path += 1
        warnings_total += len(m.get("warnings", []))
        errors_total += len(m.get("errors", []))
        _DIAG["items"].append({
            "hash": m.get("hash"),
            "ok": m.get("ok"),
            "path": m.get("path"),
            "elapsed_sec": m.get("elapsed_sec"),
            "warnings": m.get("warnings", []),
            "errors": m.get("errors", []),
            "rewritten": m.get("rewritten", []),
            "expanded": m.get("expanded", []),
        })
    elapsed = round(time.time()-batch_t0,3)
    _DIAG["finished_at"] = time.time()
    diagnostics = {
        "cache_hits": _DIAG["cache_hits"],
        "cache_misses": _DIAG["cache_misses"],
        "total": len(prompts),
        "ok_count": ok_count,
        "json_path_count": json_path,
        "seq_path_count": seq_path,
        "warnings_total": warnings_total,
        "errors_total": errors_total,
        "elapsed_sec": elapsed,
        "started_at": _DIAG["started_at"],
        "finished_at": _DIAG["finished_at"],
        "persist_enabled": _PERSIST_ENABLED,
        "persist_file": _PERSIST_FILE,
    }
    if os.getenv('TRI_CACHE_PERSIST','0').lower() in ('1','true','yes','on'):
        _persist_flush()
    return {"results": results, "diagnostics": diagnostics}

def export_batch_diagnostics(path: str) -> None:
    data = {"items": _DIAG["items"], "cache_hits": _DIAG["cache_hits"], "cache_misses": _DIAG["cache_misses"],
            "started_at": _DIAG["started_at"], "finished_at": _DIAG["finished_at"]}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == '--batch':
        # Support JSON array input for multi-line prompts; fallback to line-based for backward compatibility.
        data = sys.stdin.read()
        ds = data.strip()
        if ds.startswith('['):
            try:
                arr = json.loads(ds)
                if isinstance(arr,list):
                    prompts = [str(x) for x in arr]
                else:
                    prompts = []
            except Exception:
                prompts = [l.strip() for l in data.splitlines() if l.strip()]
        else:
            prompts = [l.strip() for l in data.splitlines() if l.strip()]
        bundle = tri_summary_batch(prompts)
        print(json.dumps(bundle, ensure_ascii=False, indent=2))
    else:
        p = sys.argv[1] if len(sys.argv)>1 else "An open-source framework for adaptive multimodal retrieval alignment and efficient fine-tuning across language-image pairs."
        r = tri_summary(p)
        print(json.dumps(r, ensure_ascii=False, indent=2))
