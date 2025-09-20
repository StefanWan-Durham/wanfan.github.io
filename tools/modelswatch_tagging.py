#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Token-efficient taxonomy tagging for Model Watch datasets.

- Reads: data/ai/modelswatch/{daily/*.json, daily_github.json, daily_hf.json, top_*.json}
- Authority: data/ai/ai_categories.json (task keys + labels)
- Output: In-place enrichment: add `task_keys` (list of task keys) and `tags_taxonomy` (localized labels) per item
- Strategy:
  1) Deterministic, zero-token mapping first:
     - Exact key/label matches to taxonomy (all languages)
     - Heuristic regex-based synonyms/abbreviations (curated, conservative)
  2) Only when no matches: optional DeepSeek LLM classification (single-turn)
     - Caches input hash -> task_keys in tools/.cache/modelswatch_tagging.jsonl to avoid repeated calls
     - Optional: confidence threshold; default conservative mode returns [] if ambiguous

Run examples (Windows PowerShell):
  # Dry-run, no LLM, report changes
  python tools/modelswatch_tagging.py --dry-run

  # Enrich all JSONs in place, use LLM fallback with env var DEEPSEEK_API_KEY
  $env:DEEPSEEK_API_KEY="sk-..."; python tools/modelswatch_tagging.py --use-llm

  # Only process specific files
  python tools/modelswatch_tagging.py data/ai/modelswatch/daily_github.json

"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional

ROOT = Path(__file__).resolve().parents[1]
TAX_PATH = ROOT / 'data' / 'ai' / 'ai_categories.json'
DATA_DIR = ROOT / 'data' / 'ai' / 'modelswatch'
CACHE_DIR = ROOT / 'tools' / '.cache'
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_PATH = CACHE_DIR / 'modelswatch_tagging.jsonl'

# --------------- Utils ---------------

def read_json(p: Path) -> Any:
    with p.open('r', encoding='utf-8') as f:
        return json.load(f)

def write_json(p: Path, obj: Any) -> None:
    tmp = p.with_suffix(p.suffix + '.tmp')
    with tmp.open('w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    tmp.replace(p)

# --------------- Taxonomy load ---------------

def load_taxonomy() -> Tuple[Dict[str, Dict[str, str]], Dict[str, str]]:
    # Returns: labels_by_key, key_by_label_lower
    data = read_json(TAX_PATH)
    labels_by_key: Dict[str, Dict[str, str]] = {}
    key_by_label_lower: Dict[str, str] = {}
    for cat in data.get('categories', []):
        for sub in cat.get('subcategories', []):
            for t in sub.get('tasks', []):
                key = t.get('key')
                if not key:
                    continue
                labels = { L: (t.get(L) or '').strip() for L in ('zh','en','es') }
                labels_by_key[key] = labels
                for L in ('zh','en','es'):
                    v = labels[L]
                    if v:
                        key_by_label_lower[v.lower()] = key
    return labels_by_key, key_by_label_lower

# --------------- Deterministic matchers ---------------

# Conservative synonyms per task key
SYNONYMS: Dict[str, List[str]] = {
    # Vision
    'image_classification': ['image classification','图像分类','imagenet','classifier'],
    'object_detection': ['object detection','目标检测','yolo','rcnn','retinanet'],
    'semantic_segmentation': ['semantic segmentation','语义分割','deeplab'],
    'instance_segmentation': ['instance segmentation','实例分割','mask r-cnn','mask-rcnn','maskrcnn'],
    'text_to_image': ['text-to-image','文本生成图像','文生图','stable diffusion','sdxl','diffusion'],
    'text_to_video': ['text-to-video','文本生成视频','文生视频','video diffusion'],
    'super_resolution': ['super-resolution','超分辨','超分','esrgan','real-esrgan'],
    'vqa': ['vqa','视觉问答','visual question answering'],
    'visual_grounding': ['visual grounding','视觉定位','grounding'],
    # LLM & NLP
    'rlhf': ['rlhf','human feedback'],
    'rag': ['rag','retrieval-augmented generation','检索增强生成'],
    'code_generation': ['code generation','代码生成','coder','codegen'],
    'structured_reasoning': ['structured reasoning','tree of thoughts','chain of thought','cot'],
    'tool_use': ['tool use','function calling','tool calling','agents'],
    'lora_adapter': ['lora','qlora','adalora','peft','low-rank'],
    # Multimodal & Speech
    'asr': ['asr','automatic speech recognition','语音识别'],
    'tts': ['tts','text-to-speech','语音合成'],
    # Graph/Reco/Retrieval
    'general_recommendation': ['recommendation system','推荐系统','recommender'],
    'vector_retrieval': ['vector retrieval','向量检索','similarity search','faiss','hnsw','ann'],
    # Optimization/System/Security
    'model_quantization': ['quantization','量化','int8','int4','gptq','awq'],
    'inference_acceleration': ['inference acceleration','推理加速','vllm','tensorrt-llm','onnxruntime','openvino'],
}

ALLOWED_SHORTS = {'ASR','TTS','SLU','RAG','GNN','XAI','NERF','AVSR','LTR','LORA'}

def compile_patterns(labels_by_key: Dict[str, Dict[str,str]]) -> Dict[str, List[re.Pattern]]:
    pats: Dict[str, List[re.Pattern]] = {}
    for key, labels in labels_by_key.items():
        lst: List[re.Pattern] = []
        for L, v in labels.items():
            if not v:
                continue
            if re.search(r'[A-Za-z]', v):
                lst.append(re.compile(rf"\b{re.escape(v.lower())}\b", re.I))
            else:
                lst.append(re.compile(re.escape(v.lower()), re.I))
        for alias in SYNONYMS.get(key, []):
            alias_l = alias.lower()
            is_latin = bool(re.search(r'[A-Za-z]', alias_l))
            token_len = len(re.sub(r'[^A-Za-z0-9]', '', alias_l))
            if token_len < 4 and alias_l.upper() not in ALLOWED_SHORTS:
                continue
            pat = re.compile(rf"\b{re.escape(alias_l)}\b", re.I) if is_latin else re.compile(re.escape(alias_l), re.I)
            lst.append(pat)
        caps = key.upper()
        if caps in ALLOWED_SHORTS:
            lst.append(re.compile(rf"\b{re.escape(caps)}\b", re.I))
        pats[key] = lst
    return pats

# --------------- LLM integration (optional) ---------------

def deepseek_classify(prompt: str, max_tokens: int = 256) -> Optional[List[str]]:
    api_key = os.getenv('DEEPSEEK_API_KEY')
    if not api_key:
        return None
    try:
        import requests  # type: ignore
    except Exception:
        # Graceful fallback: requests not installed; skip LLM classification
        return None
    url = 'https://api.deepseek.com/chat/completions'
    headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
    payload = {
        'model': 'deepseek-chat',
        'messages': [
            { 'role': 'system', 'content': 'You are a precise classifier. Only output valid task keys in JSON array.' },
            { 'role': 'user', 'content': prompt }
        ],
        'temperature': 0,
        'max_tokens': max_tokens
    }
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=30)
        r.raise_for_status()
        out = r.json()
        txt = out['choices'][0]['message']['content']
        # Expect the output to be a JSON array like ["rag","code_generation"]
        m = re.search(r"\[(?:.|\n)*\]", txt)
        js = json.loads(m.group(0)) if m else json.loads(txt)
        if isinstance(js, list):
            return [str(x) for x in js]
    except Exception:
        return None
    return None

# --------------- Caching ---------------

def _hash_text(s: str) -> str:
    return hashlib.sha256(s.encode('utf-8')).hexdigest()[:16]

def cache_get(key: str) -> Optional[List[str]]:
    if not CACHE_PATH.exists():
        return None
    try:
        with CACHE_PATH.open('r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if obj.get('k') == key:
                    return obj.get('task_keys')
    except Exception:
        return None
    return None

def cache_put(key: str, task_keys: List[str]) -> None:
    try:
        with CACHE_PATH.open('a', encoding='utf-8') as f:
            f.write(json.dumps({'k': key, 'task_keys': task_keys}, ensure_ascii=False) + '\n')
    except Exception:
        pass

# --------------- Tagging logic ---------------

def build_item_text(it: Dict[str, Any]) -> str:
    fields = [it.get('id'), it.get('name'), it.get('url'), it.get('summary'), it.get('summary_en'), it.get('summary_zh'), it.get('summary_es')]
    tags = it.get('tags') or []
    return ' '.join([str(x) for x in fields if x] + [str(t) for t in tags]).strip()


def deterministic_match(it: Dict[str, Any], pats: Dict[str, List[re.Pattern]], key_by_label_lower: Dict[str, str]) -> List[str]:
    text = build_item_text(it).lower()
    keys: List[str] = []
    seen = set()
    # exact label mapping from existing tags first
    for t in it.get('tags') or []:
        k = key_by_label_lower.get(str(t).strip().lower())
        if k and k not in seen:
            seen.add(k); keys.append(k)
    # run curated regexes
    for key, lst in pats.items():
        if key in seen:
            continue
        if any(p.search(text) for p in lst):
            seen.add(key); keys.append(key)
    return keys


def classify_with_llm_if_needed(it: Dict[str, Any], labels_by_key: Dict[str, Dict[str,str]], use_llm: bool) -> List[str]:
    if not use_llm:
        return []
    # prepare prompt with available task keys only (short list)
    task_keys = list(labels_by_key.keys())
    text = build_item_text(it)
    prompt = (
        "You will assign ZERO OR MORE task keys (from the provided list) to the project below.\n"
        "Return ONLY a JSON array of task keys. If unsure, return an empty array.\n\n"
        f"Task keys: {json.dumps(task_keys[:400])}\n\n"
        f"Project:\n{text}\n"
    )
    h = _hash_text(prompt)
    got = cache_get(h)
    if got is not None:
        return got
    pred = deepseek_classify(prompt)
    if pred is None:
        pred = []
    # validate
    pred = [k for k in pred if k in labels_by_key]
    cache_put(h, pred)
    return pred


def enrich_file(path: Path, labels_by_key: Dict[str, Dict[str,str]], key_by_label_lower: Dict[str,str], pats: Dict[str, List[re.Pattern]], use_llm: bool, dry_run: bool) -> Tuple[int,int]:
    obj = read_json(path)
    changed = 0
    total = 0

    def process_items(items: List[Dict[str, Any]], container: Any) -> Tuple[int,int]:
        ch = 0
        tot = 0
        for it in items:
            if not isinstance(it, dict):
                continue
            tot += 1
            existing = it.get('task_keys') or []
            if existing:
                continue
            keys = deterministic_match(it, pats, key_by_label_lower)
            if not keys:
                keys = classify_with_llm_if_needed(it, labels_by_key, use_llm)
            if keys:
                it['task_keys'] = keys
                ch += 1
        return ch, tot

    # Case 1: object with items
    if isinstance(obj, dict) and isinstance(obj.get('items'), list):
        ch, tot = process_items(obj['items'], obj)
        changed += ch; total += tot
        if changed and not dry_run:
            write_json(path, obj)
        return changed, total

    # Case 2: list root - only process if looks like list of item dicts
    if isinstance(obj, list):
        # Quickly detect dates.json or non-item lists (list of strings)
        if all(isinstance(x, str) for x in obj):
            return 0, 0
        # Otherwise, require at least one dict with an item-ish shape
        looks_item = any(isinstance(x, dict) and (x.get('id') or x.get('name') or x.get('url')) for x in obj)
        if not looks_item:
            return 0, 0
        ch, tot = process_items(obj, obj)
        changed += ch; total += tot
        if changed and not dry_run:
            write_json(path, obj)
        return changed, total

    # Unknown shape: skip
    return 0, 0


def collect_files(selected: List[str]) -> List[Path]:
    if selected:
        return [ (ROOT / p).resolve() for p in selected ]
    files: List[Path] = []
    if DATA_DIR.exists():
        # Include corpus files to ensure base items get task_keys (improves coverage stats)
        for base_name in ('corpus.hf.json','corpus.github.json'):
            p = DATA_DIR / base_name
            if p.exists():
                files.append(p)
        # daily combined archives
        dd = DATA_DIR / 'daily'
        if dd.exists():
            for p in dd.glob('*.json'):
                # Skip dates.json (array of strings, not items)
                if p.name.lower() == 'dates.json':
                    continue
                files.append(p)
        for name in ('daily_github.json','daily_hf.json','top_github.json','top_hf.json'):
            p = DATA_DIR / name
            if p.exists():
                files.append(p)
    return files


def main(argv=None):
    ap = argparse.ArgumentParser(description='Enrich Model Watch JSON with taxonomy task_keys')
    ap.add_argument('files', nargs='*', help='Specific JSON files to process (optional)')
    ap.add_argument('--dry-run', action='store_true', help='Do not write files; just report')
    ap.add_argument('--use-llm', action='store_true', help='Allow DeepSeek LLM fallback when deterministic methods find nothing')
    args = ap.parse_args(argv)

    labels_by_key, key_by_label_lower = load_taxonomy()
    pats = compile_patterns(labels_by_key)

    files = collect_files(args.files)
    if not files:
        print('No files to process.')
        return 0

    total_changed = 0
    total_items = 0
    for p in files:
        ch, tot = enrich_file(p, labels_by_key, key_by_label_lower, pats, args.use_llm, args.dry_run)
        total_changed += ch
        total_items += tot
        print(f"{p.relative_to(ROOT)}: updated {ch}/{tot}")

    print(f"Done. Updated {total_changed} items across {len(files)} files.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
