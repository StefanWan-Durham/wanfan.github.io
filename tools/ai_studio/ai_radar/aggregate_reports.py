import json, os, re, sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

# Ensure project root on sys.path for importing tools.ai_llm and to find .env
ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Load .env if present (simple KEY=VAL parser)
def _load_env_dotenv(p: Path):
    if not p.exists():
        return
    try:
        for line in p.read_text(encoding='utf-8').splitlines():
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            if '=' in s:
                k, v = s.split('=', 1)
                k = k.strip(); v = v.strip().strip('"').strip("'")
                if k:
                    os.environ.setdefault(k, v)
    except Exception:
        pass

_load_env_dotenv(ROOT / '.env')

# If caller set a translation timeout, propagate to ai_llm default read-timeout BEFORE import
if os.getenv('RADAR_TRANSLATE_TIMEOUT') and not os.getenv('LLM_READ_TIMEOUT'):
    os.environ['LLM_READ_TIMEOUT'] = os.getenv('RADAR_TRANSLATE_TIMEOUT', '180')

try:
    # Optional LLM translator
    from tools.ai_llm import chat_once  # type: ignore
except Exception:
    chat_once = None

BASE_DIR = os.path.dirname(__file__)
OUT_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', '..', '..', 'data', 'ai', 'airadar'))
TMP_PATH = os.path.join(OUT_DIR, '_events_tmp.json')
LATEST_PATH = os.path.join(OUT_DIR, 'latest.json')
DATES_INDEX = os.path.join(OUT_DIR, 'dates.json')

WINDOW_HOURS = int(os.getenv('RADAR_WINDOW_HOURS', '48'))
MAX_ITEMS = int(os.getenv('RADAR_MAX_ITEMS', '80'))

now = datetime.now(timezone.utc)

with open(TMP_PATH, 'r', encoding='utf-8') as f:
    payload = json.load(f)

items = payload.get('items', [])

threshold = now - timedelta(hours=WINDOW_HOURS)

def within_window(iso):
    try:
        dt = datetime.fromisoformat(iso.replace('Z', '+00:00'))
        return dt >= threshold
    except Exception:
        return True

filtered = [it for it in items if within_window(it.get('published_at',''))]
filtered.sort(key=lambda x: x.get('published_at',''), reverse=True)

# --- Additional AI-topic filtering (post-fetch, pre-scoring) ---
AI_KEYWORDS = re.compile(r"\b(ai|artificial intelligence|machine learning|ml|deep learning|llm|gpt|chatgpt|diffusion|gen(erative)?|transformer|rag|retriev|agent|vision|lora|fine[- ]?tune|sora|gemini|copilot|cuda|nvidia|hugging face|openai|deepmind|multimodal|alignment)\b", re.I)

EXCLUDE_NOISE = re.compile(r"(招聘|体育|票务|打折|折扣|旅行|旅游|八卦|明星|影评|综艺)", re.I)

def _is_ai_story(it: dict) -> bool:
    title = (it.get('title') or '')
    ex = (it.get('raw_excerpt') or '')
    # Require keyword in title or excerpt
    if not (AI_KEYWORDS.search(title) or AI_KEYWORDS.search(ex)):
        return False
    # Exclude obvious non-tech noise words
    if EXCLUDE_NOISE.search(title) or EXCLUDE_NOISE.search(ex):
        return False
    # HN frontpage: keep stricter requirement already enforced by fetcher; here we just pass
    return True

def _clean_hn_excerpt(text: str) -> str:
    if not text:
        return ''
    s = re.sub(r'<[^>]+>', ' ', str(text))
    s = re.sub(r"Article URL:\s*\S+", '', s, flags=re.I)
    s = re.sub(r"Comments URL:\s*\S+", '', s, flags=re.I)
    s = re.sub(r"Points:\s*\d+", '', s, flags=re.I)
    s = re.sub(r"#\s*Comments:\s*\d+", '', s, flags=re.I)
    s = re.sub(r"\s{2,}", ' ', s).strip()
    return s

# Clean excerpts and filter to AI stories
for it in filtered:
    it['raw_excerpt'] = _clean_hn_excerpt(it.get('raw_excerpt') or '')
filtered = [it for it in filtered if _is_ai_story(it)]

# --- Optional i18n translation for Top K items to control cost ---
TOP_TRANSLATE = (os.getenv('RADAR_TRANSLATE_TOP', '') or '').strip().lower()
TRANSLATE_ALL = os.getenv('RADAR_TRANSLATE_ALL', '1').lower() in ('1','true','yes')
FAKE_TRANSLATE = os.getenv('RADAR_FAKE_TRANSLATE', '0').lower() in ('1','true','yes')
TRANSLATE_EXCERPTS = os.getenv('RADAR_TRANSLATE_EXCERPTS', '1').lower() in ('1','true','yes')
_HAS_ANY_LLM_KEY = any([
    bool(os.getenv('DEEPSEEK_API_KEY')),
    bool(os.getenv('OPENAI_API_KEY')),
    bool(os.getenv('OPENROUTER_API_KEY')),
    bool(os.getenv('TOGETHER_API_KEY')),
    bool(os.getenv('DASHSCOPE_API_KEY')),
])
DO_TRANSLATE = (
    os.getenv('RADAR_DO_TRANSLATE', '1').lower() in ('1','true','yes')
    and (FAKE_TRANSLATE or (bool(chat_once) and _HAS_ANY_LLM_KEY))
)

def _int_env(name: str, default: int) -> int:
    """Parse integer env vars robustly: tolerate inline comments and non-numeric tails."""
    raw = os.getenv(name, '')
    try:
        s = (raw or '').strip()
        # Keep only the first integer in the string, ignore inline comments
        m = re.search(r"\d+", s)
        return int(m.group(0)) if m else int(default)
    except Exception:
        return int(default)

def _looks_cjk(s: str) -> bool:
    try:
        return bool(re.search(r'[\u3400-\u9fff]', s or ''))
    except Exception:
        return False

def _translate_pair(text: str, src_lang: str, tgt_lang: str) -> str:
    if not DO_TRANSLATE:
        return ''
    t = (text or '').strip()
    if not t or src_lang == tgt_lang:
        return ''
    # Local fake mode for verification without API keys
    if FAKE_TRANSLATE:
        if (src_lang, tgt_lang) == ('en','zh'):
            return f"（测试译）{t}"
        if (src_lang, tgt_lang) == ('en','es'):
            return f"[ES test] {t}"
        if (src_lang, tgt_lang) == ('zh','en'):
            return f"[EN test] {t}"
        if (src_lang, tgt_lang) == ('zh','es'):
            return f"[ES test] {t}"
        if (src_lang, tgt_lang) == ('es','zh'):
            return f"（测试译）{t}"
        if (src_lang, tgt_lang) == ('es','en'):
            return f"[EN test] {t}"
        return f"[TEST {src_lang}->{tgt_lang}] {t}"
    # Truncate to keep calls cheap and avoid provider limits
    limit = 220 if len(t) > 220 and (src_lang != 'zh' or tgt_lang != 'en') else 500
    t = t[:limit]
    prompts = {
        ('en','zh'): '将以下英文文本译为「简体中文」，语言简洁自然，保留事实与数字。不要加引号、不要解释、不要双语，只输出译文：\n\n',
        ('en','es'): 'Traduce el siguiente texto del inglés al español (es-ES) en un estilo natural y fiel. Conserva hechos y números. No añadas comillas ni explicaciones; devuelve solo la traducción:\n\n',
        ('zh','en'): 'Translate the following Chinese text into concise, fluent English. Preserve facts and numbers. No quotes or explanations; return only the translation.\n\n',
        ('zh','es'): 'Traduce el siguiente texto chino al español (es-ES) de manera concisa y natural. Conserva hechos y números. No añadas comillas ni explicaciones; devuelve solo la traducción:\n\n',
    }
    key = (src_lang, tgt_lang)
    prefix = prompts.get(key)
    if not prefix:
        # Best-effort via English pivot
        if src_lang == 'zh' and tgt_lang == 'es':
            mid = _translate_pair(t, 'zh', 'en')
            return _translate_pair(mid, 'en', 'es') if mid else ''
        if src_lang == 'es' and tgt_lang == 'zh':
            mid = _translate_pair(t, 'es', 'en')
            return _translate_pair(mid, 'en', 'zh') if mid else ''
        return ''
    def _once() -> str:
        mt = _int_env('RADAR_TRANSLATE_MAX_TOKENS', 900)
        return (chat_once(prefix + t, system='You are a precise translator.', temperature=0.0, max_tokens=mt) or '').strip()
    try:
        out = _once()
        if not out:
            # one quick retry
            out = _once()
        return out
    except Exception as e:
        print(f"[ai-radar] translate error {src_lang}->{tgt_lang}: {e}")
        return ''

def _host_weight(host: str) -> float:
    h = (host or '').lower()
    weights = {
        'openai.com': 1.6, 'ai.googleblog.com': 1.5, 'huggingface.co': 1.4,
        'jiqizhixin.com': 1.25, 'qbitai.com': 1.2, 'technologyreview.com': 1.2,
        'techcrunch.com': 1.1, 'theverge.com': 1.05,
        'arxiv.org': 1.3, 'github.com': 1.25,
    }
    for k, v in weights.items():
        if k in h:
            return v
    return 1.0

def _hotness(it: dict) -> float:
    # Time decay (48h half-life)
    try:
        dt = datetime.fromisoformat((it.get('published_at','') or '').replace('Z','+00:00'))
    except Exception:
        dt = now
    age_h = max(0.0, (now - dt).total_seconds() / 3600.0)
    decay = 0.5 ** (age_h / 48.0)
    # Source weight
    host = ''
    try:
        from urllib.parse import urlparse
        host = (urlparse(it.get('url','')).hostname or '')
    except Exception:
        pass
    w = _host_weight(host)
    # Interaction (HN points, GH stars if present)
    blob = (it.get('raw_excerpt') or '')
    m = re.search(r'Points:\s*(\d+)', blob)
    points = int(m.group(1)) if m else 0
    score = decay * w * (1.0 + min(points, 500) / 120.0)
    return float(f"{score:.6f}")

# Compute hotness and attach
for it in filtered:
    it['hotness'] = _hotness(it)

# --- Build latest.json candidate set with 48h de-duplication vs recent daily archives ---
def _load_recent_archive_ids(n_days: int = 2):
    seen_ids, seen_urls = set(), set()
    try:
        if os.path.exists(DATES_INDEX):
            with open(DATES_INDEX, 'r', encoding='utf-8') as f:
                dates = json.load(f)
                if isinstance(dates, list):
                    dates = dates[:n_days]
                else:
                    dates = []
        else:
            dates = []
    except Exception:
        dates = []
    for d in dates:
        p = os.path.join(OUT_DIR, f"{d}.json")
        if not os.path.exists(p):
            continue
        try:
            data = json.load(open(p, 'r', encoding='utf-8'))
            for it in data.get('items', []):
                if it.get('id'):
                    seen_ids.add(it['id'])
                if it.get('url'):
                    seen_urls.add(it['url'])
        except Exception:
            pass
    return seen_ids, seen_urls

_seen_ids, _seen_urls = _load_recent_archive_ids(2)

def _is_new_item(it: dict) -> bool:
    i = it.get('id')
    u = it.get('url')
    return (i not in _seen_ids) and (u not in _seen_urls)

# Split candidates into new vs previously shown, then order by recency within each bucket
new_items = [it for it in filtered if _is_new_item(it)]
shown_items = [it for it in filtered if not _is_new_item(it)]
new_items.sort(key=lambda x: x.get('published_at',''), reverse=True)
shown_items.sort(key=lambda x: x.get('published_at',''), reverse=True)
final_items = (new_items + shown_items)[:MAX_ITEMS]

# Translate top K by hotness if needed
if filtered and DO_TRANSLATE:
    # Decide translate scope: all or top by hotness, but ALWAYS include zh-base items for zh->en reliability
    if TRANSLATE_ALL or TOP_TRANSLATE in ('all','0','-1',''):
        targets = list(filtered)
    else:
        try:
            k = int(TOP_TRANSLATE)
        except Exception:
            k = 12
        topk = sorted(filtered, key=lambda x: x.get('hotness', 0), reverse=True)[:max(1,k)]
        zh_base = [it for it in filtered if _looks_cjk((it.get('title') or '')) or _looks_cjk((it.get('raw_excerpt') or ''))]
        # de-dup while preserving order preference: zh_base first to guarantee coverage
        seen = set()
        targets = []
        for it in zh_base + topk:
            key = it.get('id') or it.get('url') or it.get('title')
            if key in seen:
                continue
            seen.add(key)
            targets.append(it)
    print(f"[ai-radar] translation enabled; targets={len(targets)}/{len(filtered)} (all={TRANSLATE_ALL or TOP_TRANSLATE in ('all','0','-1','')})")

    zh_ok = es_ok = en_ok = 0
    for it in targets:
        title = (it.get('title') or '').strip()
        ex = (it.get('raw_excerpt') or '').strip()
        ti = it.setdefault('title_i18n', {})
        ei = it.setdefault('excerpt_i18n', {})
        # Normalize suspicious prefilled values: if 'en' looks CJK or equals zh title, clear it to allow translation
        try:
            if ti.get('en') and (_looks_cjk(ti['en']) or ti['en'].strip() == (ti.get('zh') or '').strip()):
                ti.pop('en', None)
            if ei.get('en') and (_looks_cjk(ei['en']) or ei['en'].strip() == (ei.get('zh') or '').strip()):
                ei.pop('en', None)
        except Exception:
            pass
        # Detect source language (CJK heuristic on title or excerpt)
        src_is_zh = _looks_cjk(title) or _looks_cjk(ex)
        if src_is_zh:
            # Ensure zh
            ti.setdefault('zh', title)
            ei.setdefault('zh', ex)
            # Translate to en
            if not ti.get('en') or _looks_cjk(ti.get('en','')) or ti.get('en','').strip()==title.strip():
                en_t = _translate_pair(title, 'zh', 'en')
                if en_t and not _looks_cjk(en_t) and en_t.lower() != title.lower():
                    ti['en'] = en_t; en_ok += 1
            if TRANSLATE_EXCERPTS and ex and not ei.get('en'):
                en_e = _translate_pair(ex, 'zh', 'en')
                if en_e and not _looks_cjk(en_e) and en_e.lower() != ex.lower():
                    ei['en'] = en_e
            # Translate to es (via zh->es direct or pivot)
            if not ti.get('es'):
                es_t = _translate_pair(title, 'zh', 'es')
                if es_t and not _looks_cjk(es_t) and es_t.lower() != title.lower():
                    ti['es'] = es_t; es_ok += 1
            if TRANSLATE_EXCERPTS and ex and not ei.get('es'):
                es_e = _translate_pair(ex, 'zh', 'es')
                if es_e and not _looks_cjk(es_e) and es_e.lower() != ex.lower():
                    ei['es'] = es_e
        else:
            # Source is English (or non-CJK) → ensure en
            ti.setdefault('en', title)
            ei.setdefault('en', ex)
            # Translate to zh
            if not ti.get('zh') or (_looks_cjk(title) and ti.get('zh','').strip()==title.strip()):
                zh_t = _translate_pair(title, 'en', 'zh')
                if zh_t and _looks_cjk(zh_t) and zh_t != title:
                    ti['zh'] = zh_t; zh_ok += 1
            if TRANSLATE_EXCERPTS and ex and not ei.get('zh'):
                zh_e = _translate_pair(ex, 'en', 'zh')
                if zh_e and _looks_cjk(zh_e) and zh_e != ex:
                    ei['zh'] = zh_e
            # Translate to es
            if not ti.get('es'):
                es_t = _translate_pair(title, 'en', 'es')
                if es_t and not _looks_cjk(es_t) and es_t.lower() != title.lower():
                    ti['es'] = es_t; es_ok += 1
            if TRANSLATE_EXCERPTS and ex and not ei.get('es'):
                es_e = _translate_pair(ex, 'en', 'es')
                if es_e and not _looks_cjk(es_e) and es_e.lower() != ex.lower():
                    ei['es'] = es_e
    print(f"[ai-radar] translation results: zh_titles={zh_ok}, es_titles={es_ok}, en_titles={en_ok}")
elif filtered and not DO_TRANSLATE:
    reason = 'no LLM key or adapter unavailable'
    if os.getenv('RADAR_DO_TRANSLATE','1').lower() not in ('1','true','yes'):
        reason = 'RADAR_DO_TRANSLATE disabled'
    print(f"[ai-radar] translation disabled: {reason}")

# Ensure tri-language alignment without faking translations: only set base language
for it in filtered:
    ti = it.setdefault('title_i18n', {})
    ei = it.setdefault('excerpt_i18n', {})
    base_title = (it.get('title') or '').strip()
    base_excerpt = (it.get('raw_excerpt') or '').strip()
    src_is_zh = _looks_cjk(base_title) or _looks_cjk(base_excerpt)
    if src_is_zh:
        if not ti.get('zh'):
            ti['zh'] = base_title
        if not ei.get('zh'):
            ei['zh'] = base_excerpt
        # Do not backfill en/es here; leave empty if translation failed
    else:
        if not ti.get('en'):
            ti['en'] = base_title
        if not ei.get('en'):
            ei['en'] = base_excerpt
        # Do not backfill zh/es here; leave empty if translation failed

out = {
    'generated_at': now.isoformat().replace('+00:00','Z'),
    'window_hours': WINDOW_HOURS,
    'count': len(final_items),
    'items': final_items
}

with open(LATEST_PATH, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f"[ai-radar] latest.json generated: {out['count']} items -> {LATEST_PATH}")

# Helper to compute Beijing date string for an ISO8601 timestamp
def _bj_date_str(iso: str) -> str:
    try:
        dt = datetime.fromisoformat((iso or '').replace('Z', '+00:00'))
    except Exception:
        dt = now
    bj = dt + timedelta(hours=8)
    return bj.strftime('%Y-%m-%d')

# Partition and write daily archives by Beijing date (no cross-day duplication)
by_date = {}
for it in filtered:
    d = _bj_date_str(it.get('published_at', ''))
    by_date.setdefault(d, []).append(it)

# Sort items per date
for d, arr in by_date.items():
    arr.sort(key=lambda x: x.get('published_at',''), reverse=True)

# Write each daily file and maintain dates index
dates = []
if os.path.exists(DATES_INDEX):
    try:
        with open(DATES_INDEX, 'r', encoding='utf-8') as f:
            dates = json.load(f)
            if not isinstance(dates, list):
                dates = []
    except Exception:
        dates = []

for d, arr in by_date.items():
    # Append-only: merge with existing daily file if present, dedupe by id/url, preserve existing order
    daily_path = os.path.join(OUT_DIR, f'{d}.json')
    existing_items = []
    if os.path.exists(daily_path):
        try:
            prev = json.load(open(daily_path, 'r', encoding='utf-8'))
            if isinstance(prev, dict) and isinstance(prev.get('items'), list):
                existing_items = prev.get('items') or []
        except Exception:
            existing_items = []
    # Build sets for fast dedup
    seen_ids = {it.get('id') for it in existing_items if it.get('id')}
    seen_urls = {it.get('url') for it in existing_items if it.get('url')}
    # Keep only truly new items for that Beijing date
    new_unique = []
    for it in arr:
        i = it.get('id'); u = it.get('url')
        if (i and i in seen_ids) or (u and u in seen_urls):
            continue
        seen_ids.add(i)
        seen_urls.add(u)
        new_unique.append(it)
    # Append new items to the end (do not reorder existing ones)
    combined = existing_items + new_unique
    daily_out = {
        'generated_at': now.isoformat().replace('+00:00','Z'),
        'window_hours': WINDOW_HOURS,
        'count': len(combined),
        'items': combined
    }
    with open(daily_path, 'w', encoding='utf-8') as f:
        json.dump(daily_out, f, ensure_ascii=False, indent=2)
    print(f"[ai-radar] daily archive updated (append-only): {daily_path} (+{len(new_unique)} new, total {daily_out['count']})")
    if d in dates:
        dates.remove(d)
    dates.insert(0, d)

# Keep dates sorted (newest first)
dates = sorted(list(dict.fromkeys(dates)), reverse=True)
with open(DATES_INDEX, 'w', encoding='utf-8') as f:
    json.dump(dates, f, ensure_ascii=False, indent=2)
print(f"[ai-radar] dates index updated: {len(dates)} days -> {DATES_INDEX}")
