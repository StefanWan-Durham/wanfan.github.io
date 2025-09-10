# -*- coding: utf-8 -*-
import os, re, json, hashlib, subprocess, feedparser, requests, time
from urllib.parse import urlparse
from datetime import datetime, timezone
from datetime import timedelta
from dateutil import parser as dtp
from dateutil import tz as dttz
from zoneinfo import ZoneInfo
from markdown2 import markdown as md2html
from bs4 import BeautifulSoup as BS
from ai_llm import chat_once

# ===== 基础路径 =====
SITE_BASE = ""  # 如你用子路径，可以填 "/wanfan.github.io"
BLOG_DIR = "blog"
DATA_DIR = "data/ai/blog"
OG_DIR = "assets/og"
TPL_PATH = "tools/templates/blog_post_template.html"
os.makedirs(BLOG_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(OG_DIR, exist_ok=True)

# —— 超轻量摘要缓存（用于 4–6 句中文 digest，降低重复成本）——
_SUM_CACHE_DIR = os.path.join(DATA_DIR, "cache", "digest")
os.makedirs(_SUM_CACHE_DIR, exist_ok=True)

# ScholarPush prompt for academic flash cards
PROMPT_SCHOLAR = r"""
You are an academic news editor. Output STRICT JSON only.
Use ONLY the provided entries (title | url | ts | brief). No speculation, no marketing words, no chain-of-thought.
Numbers must be extracted from the briefs/linked metadata; if absent, use "N/A".

From today's entries, produce [[N]] academic flashes (papers preferred).
Each item must be self-contained and quickly scannable.

JSON schema:
{
    "generated_at": "ISO8601",
    "items": [
        {
            "headline": "≤24字；格式：[类别] + 要点（中文）",
        "one_liner": "≤60字；问题→方法→结果的单句",
            "task": "LLM/RAG/Agent/CV/ASR/NLP/MM/IR/Robotics/Infra/Theory/Other",
            "type": "paper/code/dataset/benchmark/blog/policy",
            "novelty": "method/data/metric/compute/engineering",
            "key_numbers": [
                {"dataset":"", "metric":"", "ours":"", "baseline":"", "impr_abs":"", "impr_rel":"%或N/A"}
            ],
            "reusability": ["可复用做法×1-3（如数据增强/损失/检索/蒸馏/缓存/对齐技巧）"],
            "limitations": ["边界/风险×0-2（如数据泄漏/评测偏差/算力门槛）"],
            "links": {"paper":"URL或N/A", "code":"URL或N/A", "project":"URL或N/A"},
            "tags": ["短标签×3-6，如 LLM,RAG,Agent,Eval"],
            "impact_score": 0,
        "reproducibility_score": 0,
    "quick_read": "用中文写4–6句：背景/方法/创新/证据/可借鉴/影响（若无具体数字可相对表述）",
        "who_should_try": "适用人群（可选）"
        }
    ],
    "refs": [{"title":"", "url":""}],
    "stats": {"by_task": {"LLM":0}, "with_code": 0, "new_benchmarks": 0},
    "must_reads": [0,1,2,3,4],
    "nice_to_read": [5,6,7,8,9,10,11,12],
    "deep_dive": {"title":"可选主题", "summary":"三句话要点（可选）", "refs": [0,3,5]}
}

Rules:
- 优先 arXiv/论文/基准发布；同一主题重复只选信息密度更高的一条。
- “headline”不要结尾标点；“one_liner”必须是完整一句话。
- 数字缺失时 key_numbers 填 "N/A"；不要编造。
- “links.paper”若能从条目中提取 arXiv/论文页就填，否则 N/A。
- items 按 impact_score 降序。

Entries:
[[ENTRIES]]
"""

# ===== 数据源（只读外部配置）=====
"""
强制只读 tools/sources.ai.json（或由 env SOURCES_JSON 指定的路径），不再使用内置默认列表。
如果该文件不存在或为空，将打印提示并返回空数据（不生成新的内容）。
"""

def _load_sources_json():
    path = os.getenv("SOURCES_JSON", "tools/sources.ai.json")
    try:
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        urls = []
        for item in (data or []):
            if isinstance(item, dict):
                url = (item.get("url") or "").strip()
            else:
                url = str(item).strip()
            if url and url not in urls:
                urls.append(url)
        return urls or None
    except Exception as ex:
        print(f"sources.ai.json load failed: {ex}")
        return None

SOURCES = []
_urls = _load_sources_json()
if _urls:
    print(f"Loaded {len(_urls)} sources from tools/sources.ai.json")
    SOURCES = _urls
else:
    print("No sources loaded (tools/sources.ai.json missing or empty)")

def fetch_arxiv_api(categories=("cs.AI","cs.CL","cs.LG","cs.CV"), per_cat=25, timeout=20):
    """Fallback: use arXiv Atom API when RSS returns nothing."""
    base = "http://export.arxiv.org/api/query"
    ua = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) arxiv-fetcher/1.0",
        "Accept": "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    items = []
    for cat in categories:
        params = {
            "search_query": f"cat:{cat}",
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "max_results": str(per_cat),
        }
        try:
            r = requests.get(base, params=params, headers=ua, timeout=timeout)
            r.raise_for_status()
            feed = feedparser.parse(r.text)
            for e in getattr(feed, 'entries', []) or []:
                title = (e.get("title") or "").strip()
                link = (e.get("id") or e.get("link") or "").strip()
                published = e.get("published") or e.get("updated") or ""
                ts = _parse_ts_utc_iso(published)
                summary = (e.get("summary") or "")
                # Keep a larger raw cap to avoid mid-sentence truncation; prompt will be capped later.
                _sum_cap = int(os.getenv("FETCH_SUMMARY_CHARS", "1800"))
                summary = _clean_arxiv_announce_prefix(re.sub("<.*?>", "", summary))[:_sum_cap]
                items.append({"title":title, "url":link, "ts":ts, "summary":summary})
        except Exception as ex:
            print(f"arXiv API failed for {cat}: {ex}")
            continue
    # 去重
    seen=set(); uniq=[]
    for it in items:
        h = hashlib.md5((it["title"]+it["url"]).encode("utf-8")).hexdigest()
        if h not in seen: seen.add(h); uniq.append(it)
    return uniq

def fetch_items(limit_per_feed=25):
    items = []
    per_feed_counts = []
    for url in SOURCES:
        cnt = 0
        try:
            feed = feedparser.parse(url)
            entries = getattr(feed, 'entries', []) or []
            # env override for per-feed limit
            _limit = int(os.getenv("PER_FEED_LIMIT", str(limit_per_feed)))
            # Keep a larger raw cap to avoid mid-sentence truncation; prompt will be capped later.
            _sum_cap = int(os.getenv("FETCH_SUMMARY_CHARS", "1800"))
            for e in entries[:_limit]:
                title = (e.get("title") or "").strip()
                link = e.get("link") or ""
                published = e.get("published") or e.get("updated") or ""
                ts = _parse_ts_utc_iso(published)
                summary = (e.get("summary") or "")
                # 去HTML & 降噪（更省tokens）+ 去 arXiv 前缀噪音
                summary = _clean_arxiv_announce_prefix(re.sub("<.*?>", "", summary))[:_sum_cap]
                items.append({"title":title, "url":link, "ts":ts, "summary":summary})
                cnt += 1
        except Exception as e:
            per_feed_counts.append((url, f"error: {e}"))
            continue
        per_feed_counts.append((url, cnt))
    # 可见性：打印各源抓取条数，便于诊断为何偏向某源
    try:
        print("Feed counts:")
        for u, c in per_feed_counts:
            print(" -", u, c)
    except Exception:
        pass
    # 可选的 arXiv API 回退：仅当显式开启 ARXIV_FALLBACK=1 且当前抓不到任何 arXiv 项
    if os.getenv("ARXIV_FALLBACK", "0") in ("1", "true", "yes"):
        if not any("arxiv.org" in (it.get("url","")) for it in items):
            api_items = fetch_arxiv_api(per_cat=limit_per_feed)
            if api_items:
                print(f"arXiv API fallback used: {len(api_items)} items")
                items.extend(api_items)
    # 去重
    seen=set(); uniq=[]
    for it in items:
        h = hashlib.md5((it["title"]+it["url"]).encode("utf-8")).hexdigest()
        if h not in seen: seen.add(h); uniq.append(it)
    return uniq

# ===== Topic preference (user-configurable via TOPIC_PREFER env) =====
def _get_topic_keywords():
    raw = os.getenv("TOPIC_PREFER", "")
    kws = [w.strip().lower() for w in raw.split(',') if w.strip()]
    return kws

def _topic_score(entry, kws):
    if not kws:
        return 0
    blob = ((entry.get("title") or '') + ' ' + (entry.get("summary") or '') + ' ' + (entry.get("url") or '')).lower()
    s = 0
    for k in kws:
        if not k: continue
        # simple contains; could be improved to word-boundary, but arXiv titles are English
        if k in blob:
            s += 3
    return s

def _filter_cap_entries(entries):
    """Reduce prompt size: keep recent items only, dedupe, and shorten summaries."""
    hours = int(os.getenv("RECENT_HOURS", "48"))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    fresh = []
    seen_sig = set()
    for it in entries:
        try:
            ts = dtp.parse(it.get("ts") or "").astimezone(timezone.utc)
        except Exception:
            ts = datetime.now(timezone.utc)
        if ts < cutoff:
            continue
        url = (it.get("url") or "").strip()
        host = urlparse(url).hostname or ""
        title_norm = re.sub(r"\s+", "", BS(it.get("title") or "", "html.parser").text.lower())
        sig = f"{host}|{title_norm[:60]}"
        if sig in seen_sig:
            continue
        seen_sig.add(sig)
        it = dict(it)
        # Per-entry prompt summary length: PROMPT_SUMMARY_CHARS > fallback from DEEPSEEK_MAX_INPUT (approx chars) > 280
        _prom_cap_env = os.getenv("PROMPT_SUMMARY_CHARS")
        if _prom_cap_env and _prom_cap_env.isdigit():
            _prom_cap = int(_prom_cap_env)
        else:
            _in_tok = os.getenv("DEEPSEEK_MAX_INPUT") or os.getenv("LLM_MAX_INPUT") or ""
            try:
                # rough char estimate from tokens (conservative)
                _prom_cap = max(200, min(800, int(int(_in_tok) / 4))) if _in_tok else 280
            except Exception:
                _prom_cap = 280
        it["summary"] = (re.sub(r"<.*?>", "", it.get("summary") or "")[:_prom_cap]).strip()
        fresh.append(it)

    max_n = int(os.getenv("MAX_ENTRIES", "40"))
    fresh = sorted(fresh, key=lambda x: x.get("ts", ""), reverse=True)[:max_n]
    return fresh

# ===== 选题与成文 =====
SYS = (
        "You are a senior AI editor. Write publishable, objective Chinese posts. "
        "No chain-of-thought; avoid hype/marketing words; replace speculation with attributed phrasing."
)
# Two-step, stricter JSON output with plan + locked refs (user-provided prompt)
PROMPT = r"""
You are a professional, detail-oriented AI news editor specializing in tech/AI领域 (可根据实际内容替换为具体领域，如"生物医药""前沿科技") daily updates. Your core task is to produce a concise, fact-driven DAILY Chinese blog post in STRICT JSON format—ensure all content is accurate, information-dense, and aligns with the given entries.

Complete the task in TWO STEPS **within one JSON object**:

1) "plan": First, screen and select 3–5 HIGH-VALUE key items from the given entries (prioritize items with clear data, novel insights, or industry relevance; avoid trivial/overlapping content). Based on these items, define three sub-fields:
    - "toc": A list of 3–6 Chinese section titles (each 8–15 characters; titles must directly reflect the core of the section, avoid vague expressions like "Industry Updates").
    - "refs": An ordered list of { "title": (full, accurate title of the entry), "url": (exact URL from the entry) }—EVERY URL must be sourced from the given entries, no missing or fabricated links.
    - "claims": A list of 6–10 factual, one-sentence bullets (each 20–40 Chinese characters). Each bullet must map to 1–2 ref indexes (e.g., "[1]", "[2][4]") to indicate its source; avoid ambiguous statements, ensure each claim is verifiable from the entries.

2) "draft": Write the full article body strictly following these constraints:
    - "title_zh": 18–28 Chinese characters (must summarize the blog’s core focus, e.g., "2024.05 AI领域3大突破：多模态效率提升40%+")；no punctuation (periods, commas, colons) at the end.
    - "description_zh": 60–120 Chinese characters (objectively summarize the blog’s key content: include 2–3 core items, 1–2 key data points; avoid empty generalizations like "this article covers latest trends").
    - "tags": 3–5 short, precise tags (each 2–8 Chinese/English characters; use English for technical terms like "LLM"/"RAG", Chinese for domains like "多模态"; avoid overly broad tags like "科技").
    - "sections": An array of { "heading": (exact match with plan.toc), "markdown": (section content) }—length must equal len(plan.toc). Each section must meet:
        * Word count: 200–320 Chinese characters (count only content, exclude heading; use concise expressions, no redundant filler).
        * Structure: Follow "问题（现有痛点/行业需求）→ 方法（entry中提出的解决方案/技术路径）→ 结果/意义（具体数据/实际价值）" (3–4 logical sentences, avoid disjointed content).
        * Data retention: Preserve all concrete numbers, units, and evaluation settings (e.g., "在CIFAR-10数据集上准确率达92.3%", "推理速度提升2.1倍")—do not omit or paraphrase data.
        * Citation: End each section with bracketed ref indexes (e.g., "[1][3]")—indexes must come from plan.refs, and ensure all content in the section is supported by the cited refs.
        * No extra information: Do NOT introduce facts, opinions, or examples not supported by plan.refs; do NOT use direct quotes longer than 25 Chinese characters (rewrite long quotes in your own words while retaining original meaning).
    - "en_teaser": 1–2 natural English sentences (summarize the blog’s key value, include 1 key data point; avoid literal translation of title_zh).
    - "es_teaser": 1–2 oraciones en español (mismo requisito que en_teaser: resuma el valor clave del blog, incluya 1 dato importante; evite traducción literal de title_zh).
    - Total Chinese body length: Approximately [[MAX_WORDS]] characters (allow ±15% deviation; calculate as sum of all sections’ markdown word counts).

Mandatory Rules (violations will make the output invalid):
1. Source restriction: Cite ONLY from plan.refs—no external sources, no speculation, no marketing-style language (e.g., "revolutionary", "best-in-class").
2. Accuracy first: If entries lack certain information (e.g., no evaluation data for a method), omit it instead of fabricating; if data is conflicting, prioritize the entry with clearer context.
3. Chinese prose quality: Use clear, natural, and formal Chinese (avoid colloquialisms, clichés like "与时俱进", or overly complex sentences); ensure logical coherence between sentences in each section.
4. JSON format: Output ONLY a valid JSON object (no extra text, comments, or line breaks outside JSON); ensure all keys are present and match the required names: plan, title_zh, description_zh, tags, toc, sections, refs, en_teaser, es_teaser.
5. Consistency check: Ensure "toc" exactly matches plan.toc, "refs" exactly matches plan.refs, and all section headings exactly match plan.toc.

Entries:
[[ENTRIES]]
"""

def _extract_json_from_text(text: str):
    t = (text or "").strip()
    # Try fenced code block first
    try:
        import re
        m = re.search(r"```(?:json)?\s*(.*?)```", t, re.DOTALL | re.IGNORECASE)
        if m:
            return json.loads(m.group(1).strip())
    except Exception:
        pass
    # Then try raw JSON slice
    try:
        first = t.find('{')
        last = t.rfind('}')
        if first != -1 and last != -1 and last > first:
            return json.loads(t[first:last+1])
    except Exception:
        pass
    # Finally try direct
    return json.loads(t)

# ===== Time helpers =====
_TZINFOS = {
    # Common US abbreviations observed in feeds
    'EST': dttz.tzoffset('EST', -5 * 3600),
    'EDT': dttz.tzoffset('EDT', -4 * 3600),
    'CST': dttz.tzoffset('CST', -6 * 3600),
    'CDT': dttz.tzoffset('CDT', -5 * 3600),
    'PST': dttz.tzoffset('PST', -8 * 3600),
    'PDT': dttz.tzoffset('PDT', -7 * 3600),
    'UTC': dttz.tzutc(),
    'GMT': dttz.tzutc(),
}

def _parse_ts_utc_iso(s: str) -> str:
    try:
        if not s:
            return datetime.now(timezone.utc).isoformat()
        dt = dtp.parse(str(s), tzinfos=_TZINFOS)
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()

def _today_cn_08_utc_iso(now_utc: datetime | None = None) -> str:
    """Return today's 08:00 at Asia/Shanghai converted to UTC ISO string.
    If current UTC time is before today's CN 08:00, still use today's 08:00 (no backdating)."""
    try:
        cn = ZoneInfo("Asia/Shanghai")
    except Exception:
        # Fallback: fixed offset +08:00
        cn = dttz.gettz("Asia/Shanghai")
    n_utc = now_utc or datetime.now(timezone.utc)
    n_cn = n_utc.astimezone(cn)
    eight_cn = n_cn.replace(hour=8, minute=0, second=0, microsecond=0)
    # Ensure we always output the 08:00 time of the same CN day as now
    return eight_cn.astimezone(timezone.utc).isoformat()
def _escape_newlines_in_quoted_strings(s: str) -> str:
    """将双引号括起来的字符串内部的裸换行/回车替换为 \\n，避免 JSONDecodeError。"""
    out = []
    in_str = False
    esc = False
    for ch in s:
        if in_str:
            if esc:
                out.append(ch)
                esc = False
            else:
                if ch == '\\':
                    out.append(ch)
                    esc = True
                elif ch == '"':
                    out.append(ch)
                    in_str = False
                elif ch == '\n' or ch == '\r':
                    out.append('\\n')
                else:
                    out.append(ch)
        else:
            if ch == '"':
                out.append(ch)
                in_str = True
            else:
                out.append(ch)
    return ''.join(out)

def _extract_json_relaxed(text: str):
    """Attempt to coerce almost-JSON (single quotes, trailing commas, code fences, ellipsis, naked newlines) into valid JSON."""
    t = (text or "").strip()
    # 1) 去掉 ```json 代码围栏
    try:
        m = re.search(r"```(?:json)?\s*(.*?)```", t, re.DOTALL | re.IGNORECASE)
        if m:
            t = m.group(1)
    except Exception:
        pass
    # 2) 截取最外层花括号
    try:
        first = t.find('{'); last = t.rfind('}')
        if first != -1 and last != -1 and last > first:
            t = t[first:last+1]
    except Exception:
        pass

    # 3) “几乎 JSON”的常见修复（在你原有基础上补强）
    # 统一破折号
    t = t.replace('–', '-').replace('—', '-')
    # 冒号后的“数值范围” 12-34 → 12（避免 0-100 等被拆解）
    t = re.sub(r'(:\s*)(\d+)\s*-\s*(\d+)(\s*[,}\]])', r'\1\2\4', t)
    # 冒号后的百分数 12% → "12%"
    t = re.sub(r'(:\s*)(-?\d+(?:\.\d+)?)\s*%(\s*[,}\]])', r'\1"\2%"\3', t)
    # 冒号后的 N/A / NA → "N/A"
    t = re.sub(r'(:\s*)(N/?A)(\s*[,}\]])', r'\1"\2"\3', t, flags=re.IGNORECASE)

    # 4) 你原有的修正
    t2 = re.sub(r"([:\[{,\s])'([^'\\]*)'", r'\1"\2"', t)   # 单引号 → 双引号
    t2 = re.sub(r",\s*([}\]])", r"\1", t2)                  # 去除 ] / } 前尾逗号
    t2 = re.sub(r"\bTrue\b", "true", t2)
    t2 = re.sub(r"\bFalse\b", "false", t2)
    t2 = re.sub(r"\bNone\b", "null", t2)

    # 5) 新增：清理不可见字符与省略号；并转义“引号内的裸换行”
    t2 = t2.replace('\ufeff', '')   # BOM
    t2 = t2.replace('\u00A0', ' ')  # 不换行空格
    t2 = t2.replace('\u2026', '')   # 省略号 …（直接去掉，避免插到结构位置）
    t2 = _escape_newlines_in_quoted_strings(t2)

    # 6) 宽松解析
    return json.loads(t2, strict=False)

def _match_bracket_block(s: str, start_idx: int, open_ch: str, close_ch: str) -> int:
    """从 start_idx（指向 open_ch）起，找到与之匹配的 close_ch 的索引；失败返回 -1。支持字符串/转义。"""
    in_str = False
    esc = False
    depth = 0
    for i in range(start_idx, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            else:
                if ch == '\\':
                    esc = True
                elif ch == '"':
                    in_str = False
            continue
        else:
            if ch == '"':
                in_str = True
            elif ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return i
    return -1


def _salvage_items_from_text(text: str, n_items: int = 8) -> list:
    """
    当整体 JSON 解析失败时，仅从文本中定位 items: [...]，
    逐个提取 {...} 条目并用 _extract_json_relaxed 解析，返回成功解析的 item 列表。
    """
    if not text:
        return []
    s = text

    # 1) 找到 "items" 及其后面的 '['
    m = re.search(r'"items"\s*:\s*\[', s)
    if not m:
        return []
    arr_lbrack = s.find('[', m.end() - 1)
    if arr_lbrack == -1:
        return []

    # 2) 定位与该 '[' 匹配的 ']'
    arr_rbrack = _match_bracket_block(s, arr_lbrack, '[', ']')
    if arr_rbrack == -1:
        return []

    body = s[arr_lbrack + 1:arr_rbrack]  # items 数组内部内容

    # 3) 在 body 里逐个提取 {...} 对象
    items = []
    i = 0
    in_str = False
    esc = False
    depth = 0
    obj_start = -1

    while i < len(body):
        ch = body[i]
        if in_str:
            if esc:
                esc = False
            else:
                if ch == '\\':
                    esc = True
                elif ch == '"':
                    in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == '{':
                if depth == 0:
                    obj_start = i
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0 and obj_start != -1:
                    obj_str = body[obj_start:i+1]
                    # 用你现有的宽松解析来修条目内部的小毛病
                    try:
                        item = _extract_json_relaxed(obj_str)
                        items.append(item)
                        if len(items) >= n_items:
                            break
                    except Exception:
                        # 单条坏掉就跳过，继续尝试下一条
                        pass
                    obj_start = -1
        i += 1

    return items



# ===== Output post-processing helpers =====
def _urls_from_entries(entries):
    return { (it.get("url") or "").strip() for it in entries if it.get("url") }

def _sanitize_output(j, entries):
    allowed = _urls_from_entries(entries)
    plan = j.get("plan", {}) if isinstance(j, dict) else {}
    # 1) refs whitelist from entries
    raw_refs = plan.get("refs") or j.get("refs") or []
    clean_refs = []
    for r in raw_refs:
        if not isinstance(r, dict):
            continue
        url = (r.get("url") or "").strip()
        if url and url in allowed:
            clean_refs.append({"title": (r.get("title") or "").strip(), "url": url})
    if not clean_refs:
        raise ValueError("No valid refs in output.")
    j["refs"] = clean_refs

    # 2) toc alignment
    toc = plan.get("toc") or j.get("toc") or []
    j["toc"] = toc[:6]

    # 3) sections count matches toc
    sec = j.get("sections") or []
    j["sections"] = sec[:len(j["toc"])]
    return j

    # —— 若按时间窗筛完为空，则回退到“去重后的最近 N 条（不看时间）” —— #
    if not fresh:
        dedup = []
        seen_sig = set()
        for it in sorted(entries, key=lambda x: x.get("ts",""), reverse=True):
            url = (it.get("url") or "").strip()
            host = urlparse(url).hostname or ""
            title_norm = re.sub(r"\s+", "", BS(it.get("title") or "", "html.parser").text.lower())
            sig = f"{host}|{title_norm[:60]}"
            if sig in seen_sig:
                continue
            seen_sig.add(sig)
            it = dict(it)
            it["summary"] = (re.sub(r"<.*?>", "", it.get("summary") or "")[:280]).strip()
            dedup.append(it)
            if len(dedup) >= max_n:
                break
        return dedup

def _cn_len(s: str) -> int:
    return sum(2 if '\u4e00' <= c <= '\u9fff' else 1 for c in (s or ""))

def _trim_title(s: str) -> str:
    t = (s or "").strip(" ，。！？?!.:；;\n\t")
    # enforce ~18-28 CJK char length (rough)
    L = _cn_len(t)
    if L < 18 or L > 28:
        # simple hard cut without re-asking model
        t = t[:20]
    return t

# === CJK detection and lightweight logger ===
_CJK_RE = re.compile(r'[\u3400-\u9fff]')

def _looks_cjk(s: str) -> bool:
    return bool(_CJK_RE.search(s or ""))

def _log(msg: str):
    try:
        print(msg)
    except Exception:
        pass

SENT_SPLIT = re.compile(r'(?<=[。！？!?；;\.])')
def _clean_arxiv_announce_prefix(text: str) -> str:
    """Remove arXiv and announcement boilerplate from abstracts in any language.
    Examples to strip at the beginning:
    - "arXiv:2509.04505v1 Announce Type: new Abstract:"
    - "arXiv:2509.04505v1 Announcement Type: New Results Abstract:"
    - "arXiv:2509.04505v1 公告类型：新论文 摘要："
    - Leading "Abstract:" or "摘要：" alone
    """
    try:
        s = str(text or '').strip()
        # arXiv id + (Announce|Announcement|公告类型) ... (Abstract:|摘要：)
        s = re.sub(r"^arXiv:\d{4}\.\d{4,5}v\d+\s+(?:Announce(?:ment)?\s+Type:\s*[^\n]*?|公告类型：[^\n]*?)\s*(?:Abstract:|摘要：)\s*",
                   "", s, flags=re.IGNORECASE | re.DOTALL)
        # If still starts with arXiv:ID and then Abstract/摘要
        s = re.sub(r"^arXiv:\d{4}\.\d{4,5}v\d+\s*(?:Abstract:|摘要：)\s*",
                   "", s, flags=re.IGNORECASE)
        # Leading plain Abstract/摘要 markers
        s = re.sub(r"^(?:Abstract:|摘要：)\s*", "", s, flags=re.IGNORECASE)
        return s.strip()
    except Exception:
        return text or ""

def _compress_sections(j: dict, max_words: int):
    """句子感知压缩：宁要完整句子，不要截半句"""
    secs = j.get("sections") or []
    n = max(1, len(secs))
    per = max(200, min(340, int(max_words * 1.05 / n)))

    for s in secs:
        raw = (s.get("markdown") or "").strip()
        # 保留末尾引用 [1][3] 不被切断
        tail_match = re.search(r'(?:\s*(?:\[\d+\])+)?\s*$', raw)
        refs_tail = tail_match.group(0) if tail_match else ""
        core = raw[:-len(refs_tail)] if refs_tail else raw

        # Preserve spaces for English text; collapse for Chinese
        has_cjk = re.search(r'[\u4e00-\u9fff]', core) is not None
        core = re.sub(r'\s+', '' if has_cjk else ' ', core)
        parts = [p for p in SENT_SPLIT.split(core) if p]
        acc = ''
        for p in parts:
            if _cn_len(acc + p) <= per:
                acc += p
            else:
                break
        if not acc and parts:
            acc = parts[0]
        if not acc.endswith(('。','！','？',';','；','!','?')):
            tmp = re.sub(r'[^。！？!?；;]+$', '', acc)
            acc = (tmp if tmp else acc) + '。'
        s['markdown'] = acc + refs_tail

def _cap_ref_indexes(sections, ref_count: int):
    pat = re.compile(r"\[(\d+)\]")
    for s in sections:
        txt = s.get("markdown", "")
        def repl(m):
            idx = int(m.group(1))
            idx = min(max(idx, 1), max(ref_count, 1))
            return f"[{idx}]"
        s["markdown"] = pat.sub(repl, txt)

# ===== Unified field helpers (Daily ↔ ScholarPush) =====
def _normalize_url(u: str) -> str:
    """归一化 URL：arXiv 变成 https://arxiv.org/abs/<id>；去掉 UTM；去掉尾斜杠。"""
    try:
        if not u:
            return ""
        u = u.strip()
        m = re.search(r"arxiv\.org/(?:abs|pdf|format|html)/(\d{4}\.\d{4,5})(?:v\d+)?", u, re.I)
        if m:
            return f"https://arxiv.org/abs/{m.group(1)}"
        from urllib.parse import urlparse as _urlparse, urlunparse, parse_qsl, urlencode
        p = _urlparse(u)
        q = [(k, v) for (k, v) in parse_qsl(p.query, keep_blank_values=True) if not k.lower().startswith("utm_")]
        return urlunparse((p.scheme, p.netloc, p.path.rstrip('/'), "", urlencode(q), ""))
    except Exception:
        return u

def _hostname(u: str) -> str:
    try:
        return urlparse(u or "").hostname or ""
    except Exception:
        return ""

def _make_entries_map(entries: list) -> dict:
    """url_norm -> {title_en, summary_en, ts, host}（来自抓取的 entries）
    Note: summary_en uses the raw fetched summary with arXiv boilerplate removed, not the prompt-capped version.
    """
    m = {}
    for it in entries:
        u = _normalize_url(it.get("url", ""))
        if not u:
            continue
        m[u] = {
            "title_en": BS(it.get("title", ""), "html.parser").text.strip(),
            "summary_en": _clean_arxiv_announce_prefix(BS(it.get("summary", ""), "html.parser").text.strip()),
            "ts": it.get("ts", ""),
            "host": _hostname(u),
        }
    return m

def _make_daily_summary_map(j: dict) -> dict:
    """把 Daily 里各段的中文摘要映射到引用的 url：url_norm -> zh_summary"""
    if not j:
        return {}
    refs = j.get("refs") or []
    idx2url = {}
    for i, r in enumerate(refs, 1):
        u = _normalize_url(r.get("url", ""))
        if u:
            idx2url[i] = u
    m = {}
    # Allow longer injected zh summaries via env
    try:
        zh_cap = int(os.getenv("SCHOLARPUSH_ZH_SUMMARY_CHARS", "520"))
    except Exception:
        zh_cap = 520
    for sec in (j.get("sections") or []):
        md = sec.get("markdown") or ""
        zh = _plain_summary_from_markdown(md, limit=zh_cap)
        for idx in sorted({int(x) for x in re.findall(r"\[(\d{1,2})\]", md)}):
            u = idx2url.get(idx)
            if not u:
                continue
            if (u not in m) or (len(zh) > len(m[u])):  # 取信息量更大的
                m[u] = zh
    return m

def _best_zh_summary(u_norm: str, it: dict, entries_map: dict, daily_map: dict) -> str:
    """Prefer a 4–6 sentence Chinese digest synthesized from the English abstract.
    Fallback to Daily zh or one_liner/quick_read. Keep sentence-aware clamping.
    """
    # 1) 基线中文（Daily/one_liner/quick_read）
    try:
        base = (daily_map.get(u_norm) or (it.get("one_liner") or it.get("quick_read") or "")).strip()
    except Exception:
        base = (it.get("one_liner") or it.get("quick_read") or "").strip()

    # 2) 英文摘要 → 中文 4–6 句 digest（带缓存）
    en_src = (entries_map.get(u_norm, {}).get("summary_en") or "").strip()
    title_en = (entries_map.get(u_norm, {}).get("title_en") or "").strip()
    zh_digest = ""
    if en_src:
        cached = _digest_cache_get(title_en, en_src)
        if cached:
            zh_digest = cached
        else:
            zh_digest = _synthesize_digest_zh(title_en, en_src) or ""
            if zh_digest:
                _digest_cache_put(title_en, en_src, zh_digest)

    # 3) 选择信息量更高者
    cand = zh_digest if len(zh_digest) > len(base) else base
    cand = _clean_arxiv_announce_prefix(cand)

    # 4) 句子感知截断，避免截半句
    try:
        cap = int(os.getenv("SCHOLARPUSH_ZH_SUMMARY_CHARS", "520") or "520")
    except Exception:
        cap = 520
    if cand and len(cand) > cap + 40:
        parts = [p for p in SENT_SPLIT.split(cand) if p]
        acc = ''
        for p in parts:
            nxt = acc + p
            if _cn_len(nxt) <= cap:
                acc = nxt
            else:
                break
        if not acc:
            window = cand[:cap+40]
            m = re.search(r'[。！？!?；;。]\s*[^。！？!?；;。]*$', window)
            if m:
                acc = window[:m.end()].strip()
            else:
                acc = cand[:cap].rstrip()
        if not acc.endswith(('。','！','？','!','?','；',';')):
            acc = acc.rstrip('，,、 ') + '。'
        cand = acc
    return cand

def _translate_zh_to_en(text: str) -> str:
    """Translate Chinese to fluent English using the configured LLM. On failure, return empty string (never source)."""
    src = (text or "").strip()
    if not src:
        return ""
    prompt = (
        "Translate the following Chinese paragraph into fluent, natural English.\n"
        "- Preserve all factual content, numbers, and units.\n"
        "- Do not add or remove information.\n"
        "- Output only the translation, no explanations.\n\n"
        f"Chinese:\n{src}"
    )
    for attempt in (1, 2):
        try:
            out = chat_once(prompt, system="You are a precise translator.", temperature=0.0, max_tokens=1200)
            out = (out or "").strip()
            if out and not _looks_cjk(out):
                return out
            if attempt == 1:
                _log("[translate] zh->en empty or CJK; retrying once")
                time.sleep(0.8)
                continue
            return ""
        except Exception as e:
            _log(f"[translate] zh->en exception: {e}")
            if attempt == 1:
                time.sleep(0.8)
                continue
            return ""

def _translate_en_to_zh(text: str) -> str:
    """Translate English to concise Chinese. On failure, return empty string (not source)."""
    src = (text or "").strip()
    if not src:
        return ""
    try:
        prompt = (
            "将以下英文段落译为流畅、客观的中文，保留关键事实、数字与单位；不要增删信息；只输出译文：\n\n"
            f"English:\n{src}"
        )
        out = chat_once(prompt, system="You are a precise translator.", temperature=0.0, max_tokens=1200)
        out = (out or "").strip()
        return out or ""
    except Exception as e:
        _log(f"[translate] en->zh exception: {e}")
        return ""

def _translate_zh_to_es(text: str) -> str:
    """Translate Chinese to fluent Spanish. On failure, return empty string (never source)."""
    src = (text or "").strip()
    if not src:
        return ""
    prompt = (
        "Traduce el siguiente párrafo chino al español de forma fluida y natural.\n"
        "- Conserva todos los hechos, números y unidades.\n"
        "- No añadas ni elimines información.\n"
        "- Devuelve solo la traducción, sin explicaciones.\n\n"
        f"Chino:\n{src}"
    )
    for attempt in (1, 2):
        try:
            out = chat_once(prompt, system="Eres un traductor preciso.", temperature=0.0, max_tokens=1200)
            out = (out or "").strip()
            if out and not _looks_cjk(out):
                return out
            if attempt == 1:
                _log("[translate] zh->es empty or CJK; retrying once")
                time.sleep(0.8)
                continue
            return ""
        except Exception as e:
            _log(f"[translate] zh->es exception: {e}")
            if attempt == 1:
                time.sleep(0.8)
                continue
            return ""

def _translate_en_to_es(text: str) -> str:
    """Translate English to fluent Spanish; returns empty string on failure."""
    src = (text or "").strip()
    if not src:
        return ""

# ===== 论文摘要 → 中文 4–6 句“研究脉络”综合 =====
def _digest_cache_get(title: str, abstract_en: str) -> str | None:
    try:
        raw = (title or "") + "\n" + (abstract_en or "")
        key = hashlib.md5(raw.encode("utf-8")).hexdigest()[:16]
        path = os.path.join(_SUM_CACHE_DIR, key + ".txt")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                txt = f.read().strip()
                return txt or None
    except Exception:
        return None
    return None

def _digest_cache_put(title: str, abstract_en: str, text_zh: str):
    try:
        raw = (title or "") + "\n" + (abstract_en or "")
        key = hashlib.md5(raw.encode("utf-8")).hexdigest()[:16]
        path = os.path.join(_SUM_CACHE_DIR, key + ".txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text_zh or "")
    except Exception:
        pass

def _synthesize_digest_zh(title: str, abstract_en: str, max_sents: tuple=(4,6)) -> str:
    """
    用中文写 4–6 句“研究脉络总结”：背景→方法→创新→证据/结果→可借鉴→影响/边界。
    输入只需题目与英文摘要；若摘要为空，返回空串。
    """
    title = (title or "").strip()
    abs_en = (abstract_en or "").strip()
    if not abs_en:
        return ""
    prompt = (
        "阅读以下论文题目与摘要，请用中文写一段 4–6 句的研究脉络总结，覆盖："
        "1) 背景/动机与现有缺口；2) 方法或数据/系统；3) 关键创新点（最多两条）；"
        "4) 主要证据或结果（若无具体数字可用相对表述，如‘优于主流基线’）；"
        "5) 值得借鉴的做法；6) 对领域的潜在影响或适用边界。"
        "要求：不逐句翻译，不套用论文原句；客观、信息密度高；禁止列表/小标题；"
        f"句子数限制在 {max_sents[0]}–{max_sents[1]} 句。\n\n"
        f"题目：{title}\n摘要（英文）：\n{abs_en}\n"
    )
    try:
        out = chat_once(
            prompt,
            system="You are a senior AI editor. Focus on accurate, compact Chinese synthesis.",
            temperature=0.2,
            max_tokens=520,
        )
        return (out or "").strip()
    except Exception:
        return ""
    try:
        prompt = (
            "Translate the following English paragraph into fluent Spanish. \n"
            "Preserve facts, numbers, and units. Output only the translation.\n\n"
            f"English:\n{src}"
        )
        out = chat_once(prompt, system="You are a precise translator.", temperature=0.0, max_tokens=1200)
        out = (out or "").strip()
        return "" if _looks_cjk(out) else out
    except Exception as e:
        _log(f"[translate] en->es exception: {e}")
        return ""

def _compact_key_numbers(kn_list: list) -> list:
    """把 key_numbers[] 压成 1~3 个徽章文本，如 'FID -0.8', 'UCF101 +2.1'。"""
    out = []
    for kn in (kn_list or []):
        metric = (kn.get("metric") or "").strip()
        ds = (kn.get("dataset") or "").strip()
        impr_r = (kn.get("impr_rel") or "").strip()
        impr_a = (kn.get("impr_abs") or "").strip()  # noqa: F841 (may be unused depending on data)
        ours = (kn.get("ours") or "").strip()
        base = (kn.get("baseline") or "").strip()
        cand = ""
        if metric and impr_r and impr_r != "N/A":
            cand = f"{metric} {impr_r}"
        elif ds and metric and ours:
            cand = f"{ds} {metric} {ours}"
        elif ds and ours and base:
            cand = f"{ds} {ours} vs {base}"
        if cand:
            out.append(cand)
        if len(out) >= 3:
            break
    return out

def _clean_badge_text(s: str) -> str:
    """Remove inline 'N/A' tokens and extra spaces from a badge text.
    Example: 'N/A N/A 16×' -> '16×'.
    """
    try:
        if not s:
            return ""
        parts = [p for p in re.split(r"\s+", str(s)) if p and p.upper() != "N/A"]
        return " ".join(parts).strip()
    except Exception:
        return s or ""

def _build_entry_title_map(entries: list) -> dict:
    """Map normalized plain titles (lowercased) to source URLs for fallback linking."""
    m = {}
    for e in (entries or []):
        t = BS(e.get("title", ""), "html.parser").text.strip().lower()
        u = (e.get("url") or "").strip()
        if t and u:
            m[t] = u
    return m

def _find_source_url_by_text(candidates: list, entries: list) -> str:
    """Find a plausible source URL by matching candidate texts to entries' titles or summaries.
    Returns first high-confidence match or empty string.
    """
    try:
        scored = []
        for e in (entries or []):
            title = BS(e.get("title", ""), "html.parser").text.strip().lower()
            summ  = BS(e.get("summary", ""), "html.parser").text.strip().lower()
            blob = f"{title} \n {summ}"
            url = (e.get("url") or "").strip()
            if not url:
                continue
            best = 0
            for ct in candidates:
                if not ct or len(ct) < 6:
                    continue
                if ct in blob or title in ct:
                    best = max(best, 3)
                else:
                    # simple token overlap on words/zh chunks
                    tokens = [w for w in re.split(r"[^\w\u4e00-\u9fff]+", ct) if len(w) >= 3]
                    hit = sum(1 for w in tokens if w in blob)
                    best = max(best, hit)
            if best >= 3:
                return url
            scored.append((best, url))
        # fall back to the highest overlap if decent
        scored.sort(reverse=True)
        if scored and scored[0][0] >= 2:
            return scored[0][1]
        return ""
    except Exception:
        return ""

def _openreview_pdf(u: str) -> str:
    """Best-effort PDF URL for OpenReview forum links."""
    try:
        if not u:
            return "N/A"
        if "openreview.net" not in u:
            return "N/A"
        # normalize to pdf?id=*
        m = re.search(r"id=([A-Za-z0-9_-]+)", u)
        if m:
            return f"https://openreview.net/pdf?id={m.group(1)}"
        return "N/A"
    except Exception:
        return "N/A"

def _classify_and_attach_link(links: dict, url: str):
    """Attach the given url into the most appropriate slot without overwriting non-N/A values."""
    if not url:
        return
    try:
        host = (_hostname(url) or "").lower()
        # arXiv
        if "arxiv.org" in host:
            if not links.get("paper") or links.get("paper") == "N/A":
                links["paper"] = url
            if not links.get("pdf") or links.get("pdf") == "N/A":
                links["pdf"] = _arxiv_pdf(url)
            return
        # OpenReview
        if "openreview.net" in host:
            if not links.get("paper") or links.get("paper") == "N/A":
                links["paper"] = url
            if not links.get("pdf") or links.get("pdf") == "N/A":
                pr = _openreview_pdf(url)
                if pr != "N/A":
                    links["pdf"] = pr
            return
        # GitHub
        if host == "github.com" or host.endswith(".github.io"):
            if not links.get("code") or links.get("code") == "N/A":
                links["code"] = url
            # also keep as project if project missing
            if not links.get("project") or links.get("project") == "N/A":
                links["project"] = url
            return
        # Hugging Face (treat as project/code landing)
        if host.endswith("huggingface.co"):
            if not links.get("project") or links.get("project") == "N/A":
                links["project"] = url
            if not links.get("code") or links.get("code") == "N/A":
                links["code"] = url
            return
        # Papers with Code — useful landing
        if host == "paperswithcode.com":
            if not links.get("project") or links.get("project") == "N/A":
                links["project"] = url
            return
        # Generic fallback -> project
        if not links.get("project") or links.get("project") == "N/A":
            links["project"] = url
    except Exception:
        return

def _maybe_attach_source_link(it: dict, title_map: dict, entries: list):
    """If no usable link is present, attach links by matching titles to entries; fill paper/code/project/pdf when possible."""
    try:
        links = it.setdefault("links", {})
        # If already has at least one usable link, still try to enrich missing ones
        # candidates: English/Chinese titles, headline, and brief text
        cand_titles = [
            (it.get("title_i18n") or {}).get("en") or "",
            (it.get("title_i18n") or {}).get("zh") or "",
            it.get("headline") or "",
        ]
        cand_titles = [BS(x, "html.parser").text.strip().lower() for x in cand_titles if x]

        # 1) Fast path: title containment against title_map (may yield one URL)
        candidate_urls = []
        for ct in cand_titles:
            for et, url in title_map.items():
                if ct and ((ct in et) or (et in ct)):
                    candidate_urls.append(url)
        # 2) Slow path: scan entries titles/summaries for overlap; try to get 1-2 best
        try:
            blob_hints = [ (it.get("one_liner") or "").lower(), (it.get("quick_read") or "").lower() ]
            url_guess = _find_source_url_by_text(cand_titles + blob_hints, entries)
            if url_guess:
                candidate_urls.append(url_guess)
        except Exception:
            pass
        # 3) Also, any direct GitHub/HF/arXiv links present in entries for same title
        try:
            for e in (entries or []):
                t = BS(e.get("title", ""), "html.parser").text.strip().lower()
                if any(ct and ((ct in t) or (t in ct)) for ct in cand_titles):
                    u = (e.get("url") or "").strip()
                    if u:
                        candidate_urls.append(u)
        except Exception:
            pass
        # Deduplicate while preserving order
        seen = set(); urls = []
        for u in candidate_urls:
            if not u:
                continue
            if u in seen:
                continue
            seen.add(u); urls.append(u)

        # Attach into appropriate slots; stop early if all four filled
        for u in urls:
            _classify_and_attach_link(links, u)
            if all(links.get(k) and links.get(k) != "N/A" for k in ("paper","pdf","code","project")):
                break
    except Exception:
        return

# ===== Local env loader (.env.local / .env) =====
def _load_env_files(paths=(".env.local", ".env", os.path.join("content","blog",".env"), os.path.join("content",".env"))):
    def parse_line(raw: str):
        # drop BOM and whitespace
        s = raw.lstrip("\ufeff").strip()
        if not s or s.startswith("#"):
            return None, None
        # strip inline comments (simple heuristic)
        if "#" in s:
            parts = s.split("#", 1)
            if parts[0].strip():
                s = parts[0].strip()
        # support leading 'export '
        if s.lower().startswith("export "):
            s = s[7:].strip()
        # support KEY=VAL or KEY: VAL
        if "=" in s:
            k, v = s.split("=", 1)
        elif ":" in s:
            k, v = s.split(":", 1)
        else:
            return None, None
        k = (k or "").strip()
        v = (v or "").strip().strip('"').strip("'")
        return (k, v) if k else (None, None)

    for p in paths:
        if not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    k, v = parse_line(line)
                    if k:
                        os.environ[k] = v
        except Exception as e:
            print("warn: failed loading", p, e)

def _debug_provider_keys_present():
    try:
        present = {
            "OPENAI": bool(os.getenv("OPENAI_API_KEY")),
            "OPENROUTER": bool(os.getenv("OPENROUTER_API_KEY")),
            "TOGETHER": bool(os.getenv("TOGETHER_API_KEY")),
            "DEEPSEEK": bool(os.getenv("DEEPSEEK_API_KEY")),
            "DASHSCOPE": bool(os.getenv("DASHSCOPE_API_KEY")),
        }
        print("Provider keys present:", ", ".join([k for k,v in present.items() if v]) or "none")
    except Exception:
        pass

def _fallback_draft(entries, max_words=900):
    # Simple stub draft if no LLM available: pick top 3–4 entries
    picks = sorted(entries or [], key=lambda x: x.get("ts",""), reverse=True)[:4]
    if not picks:
        # Minimal placeholder to avoid crashes when no entries available
        title_zh = "今日 AI 精选"
        description_zh = "近 48 小时抓取源暂无可用新条目，已自动降级为占位草稿。"
        j = {
            "plan": {"toc": ["快速浏览"], "refs": [], "claims": []},
            "title_zh": title_zh,
            "description_zh": description_zh,
            "tags": ["LLM","RAG","Agent"],
            "toc": ["快速浏览"],
            "sections": [
                {"heading": "快速浏览", "markdown": "近 48 小时内抓取源没有合规新条目或被网络限制；已自动扩大时间窗口并继续尝试。"}
            ],
            "refs": [],
            "en_teaser": "No fresh entries within the default window; generated a placeholder draft.",
            "es_teaser": "No hay entradas recientes; borrador de marcador generado.",
        }
        _compress_sections(j, max_words)
        _cap_ref_indexes(j["sections"], 0)
        j["title_zh"] = _trim_title(j["title_zh"])
        return j
    toc = []
    sections = []
    refs = []
    for i, it in enumerate(picks, 1):
        t = (it.get("title") or "").strip()
        u = (it.get("url") or "").strip()
        s = (it.get("summary") or "").strip()
        refs.append({"title": t, "url": u})
        heading = BS(t, "html.parser").text[:28]
        toc.append(heading)
        body = f"{BS(s, 'html.parser').text}\n\n来源：[{i}]"
        sections.append({"heading": heading, "markdown": body})
    title_zh = (picks[0].get("title") or "今日 AI 精选")[:20]
    description_zh = "基于公开来源的自动汇总草稿，用于本地测试。"
    tags = ["LLM","RAG","Agent"]
    j = {
        "plan": {"toc": toc, "refs": refs, "claims": []},
        "title_zh": title_zh,
        "description_zh": description_zh,
        "tags": tags,
        "toc": toc,
        "sections": sections,
        "refs": refs,
        "en_teaser": "Auto-generated local test draft.",
        "es_teaser": "Borrador de prueba local autogenerado.",
    }
    # keep lengths reasonable
    _compress_sections(j, max_words)
    _cap_ref_indexes(j["sections"], len(j["refs"]))
    j["title_zh"] = _trim_title(j["title_zh"])
    return j

def pick_and_write(entries, max_words=1100):
    # 按需优先/限定 arXiv 源（默认不变）。ARXIV_MODE: all|prefer|only
    mode = (os.getenv("ARXIV_MODE", "all") or "all").lower()
    def is_arxiv(u: str) -> bool:
        try:
            host = urlparse(u or "").hostname or ""
            return "arxiv.org" in host
        except Exception:
            return False
    arxiv_entries = [e for e in entries if is_arxiv(e.get("url", ""))]
    non_arxiv_entries = [e for e in entries if not is_arxiv(e.get("url", ""))]

    if mode == "only" and arxiv_entries:
        used = arxiv_entries
        extra_rule = "Always select from arXiv entries only."
    elif mode == "prefer" and arxiv_entries:
        used = arxiv_entries + non_arxiv_entries
        extra_rule = "Prefer arXiv/peer-reviewed papers over company blog posts unless the latter introduces new benchmarks or datasets."
    else:
        used = entries
        extra_rule = ""

    # Topic preference boost (RAG, LLM, Agent, FL, MCP, ICL, nuclear, etc.)
    prefer = _get_topic_keywords()
    if prefer:
        used = sorted(used, key=lambda e: _topic_score(e, prefer), reverse=True)
    used = _filter_cap_entries(used)
    if not used:
        print("[Daily] no entries after recency filter; widening window.")
        used = sorted(entries, key=lambda x: x.get("ts",""), reverse=True)[:max(8, int(os.getenv("MAX_ENTRIES","40")))]
    if not used:
        # Relax filter if too strict; fallback to original entries
        used = _filter_cap_entries(entries) or (entries[:8] if entries else [])
    joined = "\n".join([f"- {it['title']} | {it['url']} | {it['ts']}\n  {it['summary']}" for it in used])
    try:
        print(f"[Daily] used entries: {len(used)}, prompt chars: {len(joined):,}")
    except Exception:
        pass
    prompt = PROMPT.replace("[[ENTRIES]]", joined).replace("[[MAX_WORDS]]", str(max_words))
    rules_extra = []
    if extra_rule:
        rules_extra.append(extra_rule)
    if prefer:
        rules_extra.append("Prioritize entries matching these topics: " + ", ".join(prefer[:10]))
    if rules_extra:
        prompt = prompt.replace("Rules:", "Rules:\n- " + "\n- ".join(rules_extra))
    try:
        # LLM output cap from env: DEEPSEEK_MAX_OUTPUT > LLM_MAX_TOKENS > 4096
        _max_out = int(os.getenv("DEEPSEEK_MAX_OUTPUT", os.getenv("LLM_MAX_TOKENS", "4096")))
        out = chat_once(prompt, system=SYS, temperature=0.25, max_tokens=_max_out, want_json=True)
        try:
            j = _extract_json_from_text(out)
        except Exception:
            j = _extract_json_relaxed(out)
        # sanitize and align with plan
        j = _sanitize_output(j, used)
        # hard trims for title/sections length & cap ref indexes
        j["title_zh"] = _trim_title(j.get("title_zh", ""))
        _compress_sections(j, max_words)
        _cap_ref_indexes(j.get("sections", []), len(j.get("refs", [])))
        return j
    except Exception as e:
        print("LLM unavailable, using fallback draft:", e)
    return _fallback_draft(used, max_words=max_words)

# ===== ScholarPush generation & validation =====
def _validate_scholarpush(j: dict):
    assert isinstance(j, dict), "scholarpush root must be object"
    assert "items" in j and isinstance(j["items"], list) and j["items"], "items required"
    for it in j["items"]:
        for k in ["headline","one_liner","task","type","novelty","links","tags","impact_score","reproducibility_score"]:
            assert k in it, f"item missing {k}"
        assert isinstance(it["headline"], str) and len(it["headline"])>0
        assert isinstance(it["one_liner"], str) and len(it["one_liner"])>0
        assert 0 <= int(it["impact_score"]) <= 100
        assert 0 <= int(it["reproducibility_score"]) <= 100
        links = it["links"]; assert isinstance(links, dict)
        # 对 blog/news 统一放宽：保证键存在即可，值可以是 "N/A"
        for lk in ["paper","code","project","pdf"]:
            assert lk in links, f"links.{lk} required"
        assert isinstance(it.get("tags",[]), list)
    # light checks for new fields
    if "stats" in j:
        assert isinstance(j["stats"], dict)
    if "must_reads" in j:
        assert isinstance(j["must_reads"], list)
    if "nice_to_read" in j:
        assert isinstance(j["nice_to_read"], list)

def _arxiv_pdf(url: str) -> str:
    try:
        m = re.search(r"(\d{4}\.\d{4,5})(v\d+)?", url)
        if m:
            return f"https://arxiv.org/pdf/{m.group(1)}.pdf"
    except Exception:
        pass
    return "N/A"

def _build_stats(items: list) -> dict:
    by_task = {}
    with_code = 0
    new_bench = 0
    for it in items:
        t = (it.get("task") or "Other")
        by_task[t] = by_task.get(t,0)+1
        links = it.get("links",{})
        if links.get("code") and links.get("code") != "N/A":
            with_code += 1
        typ = (it.get("type") or "").lower()
        tags = [str(x).lower() for x in (it.get("tags") or [])]
        if "dataset" in typ or "benchmark" in typ or "benchmark" in tags:
            new_bench += 1
    return {"by_task": by_task, "with_code": with_code, "new_benchmarks": new_bench}

def _split_picks(items: list, top_n=5, next_n=8):
    items_sorted = sorted(items, key=lambda x: (int(x.get("impact_score",0)), int(x.get("reproducibility_score",0))), reverse=True)
    must_idx = list(range(0, min(top_n, len(items_sorted))))
    nice_idx = list(range(len(must_idx), min(len(must_idx)+next_n, len(items_sorted))))
    return must_idx, nice_idx

def _fallback_scholarpush(entries, n_items=8):
    import urllib.parse as U
    items=[]
    picks = sorted(entries, key=lambda x: x.get("ts",""), reverse=True)[:n_items]
    for it in picks:
        title = BS(it.get("title",""), "html.parser").text.strip()
        url = (it.get("url") or "")
        host = U.urlparse(url).netloc.split(":")[0]
        t_low = title.lower()
        if "rag" in t_low or "retriev" in t_low:
            task="RAG"
        elif any(k in t_low for k in ["agent","tool","planner"]):
            task="Agent"
        elif any(k in t_low for k in ["vision","image","cv.","segmentation","detection"]):
            task="CV"
        elif "speech" in t_low or "asr" in t_low:
            task="ASR"
        else:
            task="LLM"
        one = re.sub(r"\s+", " ", BS(it.get("summary",""), "html.parser").text).strip()
        # Preserve full text for UI clamping; keep a soft quick_read cap only
        quick = (one[:170] + "…") if len(one)>172 else one
        items.append({
            # Do not hard-truncate here; UI will clamp the display
            "headline": f"[{task}] {title}",
            "one_liner": one or "基于公开摘要的自动概览",
            "task": task,
            "type": "paper" if "arxiv.org" in url else "blog",
            "novelty": "method",
            "key_numbers": [],
            "reusability": [],
            "limitations": [],
            "links": {"paper": url if "arxiv.org" in url else "N/A","code":"N/A","project":"N/A","pdf": _arxiv_pdf(url)},
            "tags": [task, host],
            "impact_score": 50,
            "reproducibility_score": 30,
            "quick_read": quick,
        })
    refs = [{"title": BS(it.get("title",""),"html.parser").text.strip(), "url": it.get("url","" )} for it in picks]
    stats = _build_stats(items)
    must, nice = _split_picks(items)
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "items": items, "refs": refs, "stats": stats, "must_reads": must, "nice_to_read": nice}

def _coerce_score(v, default=50):
    try:
        if isinstance(v, (int, float)):
            return max(0, min(100, int(round(float(v)))))
        if isinstance(v, str):
            m = re.search(r'(\d{1,3})', v)
            if m:
                return max(0, min(100, int(m.group(1))))
    except Exception:
        pass
    return default

def make_scholarpush(entries, n_items=8, daily=None):
    # Topic preference ordering before filtering
    prefer = _get_topic_keywords()
    base_entries = list(entries or [])
    if prefer:
        base_entries = sorted(base_entries, key=lambda e: _topic_score(e, prefer), reverse=True)
    entries = _filter_cap_entries(base_entries)
    if not entries and base_entries:
        # Widen window: take recent by ts ignoring time cutoff
        entries = sorted(base_entries, key=lambda x: x.get("ts",""), reverse=True)[:max(8, int(os.getenv("MAX_ENTRIES","40")))]
    # Reduce prompt size to improve JSON reliability
    sp_ctx = int(os.getenv("SCHOLARPUSH_CTX", "28"))
    entries = entries[:max(8, sp_ctx)]
    joined = "\n".join([f"- {it['title']} | {it['url']} | {it['ts']}\n  {it['summary']}" for it in entries])
    try:
        print(f"[ScholarPush] entries: {len(entries)}, prompt chars: {len(joined):,}")
    except Exception:
        pass
    prompt = (PROMPT_SCHOLAR
              .replace("[[N]]", str(n_items))
              .replace("[[ENTRIES]]", joined))
    try:
        # LLM output cap from env: DEEPSEEK_MAX_OUTPUT > LLM_MAX_TOKENS (default 6144)
        _max_out = int(os.getenv("DEEPSEEK_MAX_OUTPUT", os.getenv("LLM_MAX_TOKENS", "6144")))
        out = chat_once(prompt, system="You are an academic news editor. STRICT JSON.", temperature=0.2, max_tokens=_max_out, want_json=True)
        # Parse model output with escalating strategies; if both fail, try a single repair round-trip
        try:
            j = _extract_json_from_text(out)
        except Exception:
            try:
                j = _extract_json_relaxed(out)
            except Exception:
                # Strict re-generation attempt (ask model to re-generate valid JSON directly)
                try:
                    strict_rules = (
                        "\n\nReturn rules (STRICT):\n"
                        "- Output ONLY a syntactically valid JSON object; no code fences, no comments, no explanations.\n"
                        "- All required keys must exist: generated_at, items (length [[N]]), refs, stats{by_task,with_code,new_benchmarks}, must_reads, nice_to_read.\n"
                        "- Each item must include links{paper,code,project,pdf} (use \"N/A\" if unknown).\n"
                        "- Do not include ellipses … or trailing commas; escape newlines in strings as \\n.\n"
                    )
                    prompt_strict = (PROMPT_SCHOLAR + strict_rules).replace("[[N]]", str(n_items)).replace("[[ENTRIES]]", joined)
                    out_strict = chat_once(prompt_strict, system="You are an academic news editor. Return only valid JSON.", temperature=0.0, max_tokens=_max_out, want_json=True)
                    try:
                        j = _extract_json_from_text(out_strict)
                    except Exception:
                        try:
                            j = _extract_json_relaxed(out_strict)
                        except Exception:
                            # One-shot repair attempt to coerce to valid JSON
                            try:
                                repair_prompt = (
                                    "修复以下内容为严格合法 JSON（仅输出 JSON，不要解释）。\n"
                                    "要求字段：generated_at, items[], refs[], stats{by_task,with_code,new_benchmarks}, must_reads[], nice_to_read[].\n"
                                    "如果缺字段请补齐为空结构；items 中 links{paper,code,project,pdf} 必须存在。\n\n原始内容：\n" + (out_strict or out)
                                )
                                _max_out_fix = int(os.getenv("DEEPSEEK_MAX_OUTPUT", os.getenv("LLM_MAX_TOKENS", "6144")))
                                out_fix = chat_once(repair_prompt, system="You are a strict JSON fixer.", temperature=0.0, max_tokens=_max_out_fix, want_json=True)
                                try:
                                    j = _extract_json_from_text(out_fix)
                                except Exception:
                                    j = _extract_json_relaxed(out_fix)
                            except Exception:
                                raise
                except Exception:
                    # If strict re-gen fails earlier (e.g., provider error), fall back to repair flow
                    try:
                        repair_prompt = (
                            "修复以下内容为严格合法 JSON（仅输出 JSON，不要解释）。\n"
                            "要求字段：generated_at, items[], refs[], stats{by_task,with_code,new_benchmarks}, must_reads[], nice_to_read[].\n"
                            "如果缺字段请补齐为空结构；items 中 links{paper,code,project,pdf} 必须存在。\n\n原始内容：\n" + out
                        )
                        _max_out_fix = int(os.getenv("DEEPSEEK_MAX_OUTPUT", os.getenv("LLM_MAX_TOKENS", "6144")))
                        out_fix = chat_once(repair_prompt, system="You are a strict JSON fixer.", temperature=0.0, max_tokens=_max_out_fix, want_json=True)
                        try:
                            j = _extract_json_from_text(out_fix)
                        except Exception:
                            j = _extract_json_relaxed(out_fix)
                    except Exception:
                        raise

        # refs 白名单过滤
        allowed = { (it.get("url") or "").strip() for it in entries }
        j["refs"] = [r for r in (j.get("refs") or []) if isinstance(r, dict) and (r.get("url") or "").strip() in allowed]

        # items 规范化
        # Always stamp at 08:00 China time for the day
        j["generated_at"] = _today_cn_08_utc_iso()

        cleaned=[]
        for it in (j.get("items") or [])[:n_items]:
            # Preserve full headline/one_liner; rely on UI clamp. Ensure they are strings.
            h = (it.get("headline") or "").strip()
            ol = (it.get("one_liner") or "").strip()
            it["headline"] = h
            it["one_liner"] = ol or h or ""
            it.setdefault("links", {})
            # 统一提供四个键，blog/news 默认为 N/A
            it["links"].setdefault("paper","N/A")
            it["links"].setdefault("code","N/A")
            it["links"].setdefault("project","N/A")
            it["links"].setdefault("pdf", _arxiv_pdf(it["links"].get("paper","")))
            it.setdefault("tags", [])
            it.setdefault("key_numbers", [])
            # quick_read optional
            qr = (it.get("quick_read") or it.get("one_liner") or "").strip()
            it["quick_read"] = (qr[:298] + "…") if len(qr) > 300 else qr
            cleaned.append(it)
        j["items"] = cleaned

        # derive stats/must_reads/nice_to_read if missing
        if not j.get("stats"):
            j["stats"] = _build_stats(j["items"]) if j.get("items") else {"by_task":{},"with_code":0,"new_benchmarks":0}
        if not j.get("must_reads") or not j.get("nice_to_read"):
            must, nice = _split_picks(j["items"])
            j["must_reads"] = must
            j["nice_to_read"] = nice
        # drop empty/useless deep_dive
        try:
            dd = (j.get("deep_dive") or {}) if isinstance(j.get("deep_dive"), dict) else {}
            t = str(dd.get("title") or '').strip()
            s = str(dd.get("summary") or '').strip()
            refs = [i for i in (dd.get("refs") or []) if isinstance(i,int) and i>=0 and i < len(j.get("items",[]))]
            # If no refs provided, auto-fill from must_reads (top 1–3) so Deep Dive shows actionable links
            if not refs:
                mr = [i for i in (j.get("must_reads") or []) if isinstance(i,int) and i>=0 and i < len(j.get("items",[]))]
                refs = mr[:3]
            if (not t or t.upper()=="N/A") and (not s or s.upper()=="N/A") and not refs:
                j.pop("deep_dive", None)
            else:
                j["deep_dive"] = {"title": t, "summary": s, "refs": refs}
        except Exception:
            j.pop("deep_dive", None)

        # Build title map for link fallback
        title_map = _build_entry_title_map(entries)
        # Normalize scores
        for it in j.get("items", []):
            it["impact_score"] = _coerce_score(it.get("impact_score", 50))
            it["reproducibility_score"] = _coerce_score(it.get("reproducibility_score", 50))

        # === 统一字段注入：把 entries/Daily 的信息折到卡片 ===
        try:
            # Use full base_entries to avoid prompt-capped summaries in EN
            entries_map = _make_entries_map(base_entries)
        except Exception:
            entries_map = {}
        try:
            daily_map = _make_daily_summary_map(daily) if daily else {}
        except Exception:
            daily_map = {}

        for it in j.get("items", []):
            # First, enrich/attach source links (paper/pdf/code/project)
            try:
                title_map = _build_entry_title_map(base_entries)
                _maybe_attach_source_link(it, title_map, base_entries)
            except Exception:
                pass
            paper = it.get("links", {}).get("paper", "") or ""
            u_norm = _normalize_url(paper)

            # 标题 i18n：中文来自 headline；英文来自 entries
            zh_title = (it.get("headline") or "").strip()
            en_title = (entries_map.get(u_norm, {}).get("title_en") or zh_title)
            it["title_i18n"] = {"zh": zh_title, "en": en_title}

            # 摘要 i18n（中文）：统一使用 _best_zh_summary 以获得更长且信息更全的提要
            zh_abs = _best_zh_summary(u_norm, it, entries_map, daily_map)

            # 英文：先中->英；失败或含 CJK → 直接用源英文摘要
            en_try = _translate_zh_to_en(zh_abs)
            en_src = (entries_map.get(u_norm, {}).get("summary_en") or "").strip()
            en_abs = en_try if (en_try and not _looks_cjk(en_try)) else en_src
            en_abs = _clean_arxiv_announce_prefix(en_abs)

            # 西语：先中->西；失败或含 CJK → 英->西；再失败 → 空
            es_try = _translate_zh_to_es(zh_abs)
            if (not es_try) or _looks_cjk(es_try):
                es_from_en = _translate_en_to_es(en_abs)
                es_abs = es_from_en if (es_from_en and not _looks_cjk(es_from_en)) else ""
            else:
                es_abs = es_try
            it["summary_i18n"] = {"zh": zh_abs, "en": en_abs, "es": es_abs}

            # host/ts/pdf/has_code/key_numbers_compact
            host = entries_map.get(u_norm, {}).get("host") or _hostname(paper)
            it["host"] = host
            if not it["links"].get("pdf") or it["links"]["pdf"] == "N/A":
                it["links"]["pdf"] = _arxiv_pdf(paper)
            it["ts"] = entries_map.get(u_norm, {}).get("ts") or j["generated_at"]
            it["has_code"] = bool(it["links"].get("code") and it["links"]["code"] != "N/A")
            if "key_numbers_compact" not in it:
                it["key_numbers_compact"] = _compact_key_numbers(it.get("key_numbers"))
            # Drop N/A badges; keep at most 3
            try:
                knc = [ (s or "").strip() for s in (it.get("key_numbers_compact") or []) if s and (s or "").strip().upper() != "N/A" ]
                it["key_numbers_compact"] = knc[:3]
            except Exception:
                it["key_numbers_compact"] = it.get("key_numbers_compact") or []
            # Also strip inline N/A tokens from badges like "N/A N/A 16x"
            try:
                it["key_numbers_compact"] = [ _clean_badge_text(s) for s in it.get("key_numbers_compact", []) if _clean_badge_text(s) ]
            except Exception:
                pass
            # Clean noisy arrays: drop 'N/A'/empty, cap lengths for UI
            def _clean_list(arr, limit=None):
                out = []
                for x in (arr or []):
                    s = (x or "").strip()
                    if not s or s.upper() == "N/A":
                        continue
                    out.append(s)
                    if limit and len(out) >= limit:
                        break
                return out
            it["reusability"] = _clean_list(it.get("reusability"), limit=3)
            it["limitations"] = _clean_list(it.get("limitations"), limit=2)
            it["tags"] = _clean_list(it.get("tags"))
            # links were enriched before; ensure pdf present for arXiv/OpenReview
            try:
                if (not it["links"].get("pdf")) or it["links"]["pdf"] == "N/A":
                    it["links"]["pdf"] = _arxiv_pdf(it["links"].get("paper",""))
            except Exception:
                pass

        _validate_scholarpush(j)
        if not j.get("items"):
            raise ValueError("no items after cleaning")
        return j
    except Exception as e:
        # —— 尝试 1：用你已实现的逐对象括号法抢救 —— #
        try:
            txt_for_salvage = (locals().get('out_strict') or locals().get('out_fix') or locals().get('out') or '')
            salvaged = _salvage_items_from_text(txt_for_salvage, n_items=n_items)
            if salvaged:
                print(f"make_scholarpush salvaged_items: {len(salvaged)}")
                j = {"generated_at": _today_cn_08_utc_iso(), "items": salvaged, "refs": []}
                cleaned = []
                for it in (j.get("items") or [])[:n_items]:
                    h  = (it.get("headline") or "").strip()
                    ol = (it.get("one_liner") or "").strip()
                    it["headline"]   = h
                    it["one_liner"]  = ol or h or ""
                    it.setdefault("links", {})
                    it["links"].setdefault("paper",  "N/A")
                    it["links"].setdefault("code",   "N/A")
                    it["links"].setdefault("project","N/A")
                    it["links"].setdefault("pdf", _arxiv_pdf(it["links"].get("paper","")))
                    it.setdefault("tags", [])
                    it.setdefault("key_numbers", [])
                    qr = (it.get("quick_read") or it.get("one_liner") or "").strip()
                    it["quick_read"] = (qr[:298] + "…") if len(qr) > 300 else qr
                    it["impact_score"] = _coerce_score(it.get("impact_score", 50))
                    it["reproducibility_score"] = _coerce_score(it.get("reproducibility_score", 50))
                    cleaned.append(it)
                j["items"] = cleaned
                if not j.get("stats"):
                    j["stats"] = _build_stats(j["items"]) if j.get("items") else {"by_task":{}, "with_code":0, "new_benchmarks":0}
                if not j.get("must_reads") or not j.get("nice_to_read"):
                    must, nice = _split_picks(j["items"])
                    j["must_reads"] = must
                    j["nice_to_read"] = nice
                # 统一字段注入（抢救路径也注入）
                try:
                    entries_map = _make_entries_map(base_entries)
                except Exception:
                    entries_map = {}
                try:
                    daily_map = _make_daily_summary_map(daily) if daily else {}
                except Exception:
                    daily_map = {}
                title_map = _build_entry_title_map(entries)
                for it in j.get("items", []):
                    # Enrich first
                    try:
                        title_map = _build_entry_title_map(base_entries)
                        _maybe_attach_source_link(it, title_map, base_entries)
                    except Exception:
                        pass
                    paper = it.get("links", {}).get("paper", "") or ""
                    u_norm = _normalize_url(paper)
                    zh_title = (it.get("headline") or "").strip()
                    en_title = (entries_map.get(u_norm, {}).get("title_en") or zh_title)
                    it["title_i18n"] = {"zh": zh_title, "en": en_title}
                    zh_abs = _best_zh_summary(u_norm, it, entries_map, daily_map)
                    en_try = _translate_zh_to_en(zh_abs)
                    en_src = (entries_map.get(u_norm, {}).get("summary_en") or "").strip()
                    en_abs = en_try if (en_try and not _looks_cjk(en_try)) else en_src
                    en_abs = _clean_arxiv_announce_prefix(en_abs)
                    es_try = _translate_zh_to_es(zh_abs)
                    if (not es_try) or _looks_cjk(es_try):
                        es_from_en = _translate_en_to_es(en_abs)
                        es_abs = es_from_en if (es_from_en and not _looks_cjk(es_from_en)) else ""
                    else:
                        es_abs = es_try
                    it["summary_i18n"] = {"zh": zh_abs, "en": en_abs, "es": es_abs}
                    host = entries_map.get(u_norm, {}).get("host") or _hostname(paper)
                    it["host"] = host
                    if not it["links"].get("pdf") or it["links"]["pdf"] == "N/A":
                        it["links"]["pdf"] = _arxiv_pdf(paper)
                    it["ts"] = entries_map.get(u_norm, {}).get("ts") or j["generated_at"]
                    it["has_code"] = bool(it["links"].get("code") and it["links"]["code"] != "N/A")
                    if "key_numbers_compact" not in it:
                        it["key_numbers_compact"] = _compact_key_numbers(it.get("key_numbers"))
                    try:
                        knc = [ (s or "").strip() for s in (it.get("key_numbers_compact") or []) if s and (s or "").strip().upper() != "N/A" ]
                        it["key_numbers_compact"] = knc[:3]
                    except Exception:
                        it["key_numbers_compact"] = it.get("key_numbers_compact") or []
                    try:
                        it["key_numbers_compact"] = [ _clean_badge_text(s) for s in it.get("key_numbers_compact", []) if _clean_badge_text(s) ]
                    except Exception:
                        pass
                    # Clean lists in salvage path
                    def _clean_list(arr, limit=None):
                        out = []
                        for x in (arr or []):
                            s = (x or "").strip()
                            if not s or s.upper() == "N/A":
                                continue
                            out.append(s)
                            if limit and len(out) >= limit:
                                break
                        return out
                    it["reusability"] = _clean_list(it.get("reusability"), limit=3)
                    it["limitations"] = _clean_list(it.get("limitations"), limit=2)
                    it["tags"] = _clean_list(it.get("tags"))
                    # already enriched
                _validate_scholarpush(j)
                return j
        except Exception as salvage_error:
            print("make_scholarpush salvage_failed:", salvage_error)

        # —— 尝试 2：字段级正则硬抠（避免首条目坏掉导致括号不闭合） —— #
        try:
            def _regex_salvage(txt: str, limit: int = 8) -> list:
                if not txt:
                    return []
                s = txt.replace('\u2026', '...').replace('\ufeff','').replace('\u00A0',' ')
                # 以每个条目的起始 { "headline": 作为粗粒度分隔，容忍前面乱七八糟的逗号/换行
                starts = [m.start() for m in re.finditer(r'\{\s*"headline"\s*:\s*"', s)]
                items = []
                for i, st in enumerate(starts):
                    # 估计片段边界：到下一条 headline 起点或到 items 大括号/文末
                    ed = starts[i+1] if i+1 < len(starts) else len(s)
                    seg = s[st:ed]

                    def grab_str(key):
                        m = re.search(rf'"{key}"\s*:\s*"([^"\r\n]*)"', seg)
                        return (m.group(1).strip() if m else "")

                    def grab_num(key):
                        m = re.search(rf'"{key}"\s*:\s*(-?\d+)', seg)
                        return _coerce_score(m.group(1)) if m else None

                    def grab_link(subkey):
                        # 优先从 links{} 里抠；若没有，容忍平铺
                        m = re.search(rf'"links"\s*:\s*\{{.*?"{subkey}"\s*:\s*"([^"]*)".*?\}}', seg, re.DOTALL)
                        if not m:
                            m = re.search(rf'"{subkey}"\s*:\s*"([^"]*)"', seg)
                        return (m.group(1).strip() if m else "")

                    def grab_tags():
                        m = re.search(r'"tags"\s*:\s*\[(.*?)\]', seg, re.DOTALL)
                        if not m:
                            return []
                        return [t.strip() for t in re.findall(r'"([^"]+)"', m.group(1))]

                    head = grab_str("headline")
                    one  = grab_str("one_liner") or head
                    task = grab_str("task") or "LLM"
                    typ  = grab_str("type") or "paper"
                    nov  = grab_str("novelty") or "method"

                    paper = grab_link("paper") or "N/A"
                    code  = grab_link("code")  or "N/A"
                    proj  = grab_link("project") or "N/A"
                    tags  = grab_tags()

                    imp = grab_num("impact_score");  imp = imp if imp is not None else 50
                    rep = grab_num("reproducibility_score"); rep = rep if rep is not None else 50

                    if not head:
                        continue  # 没 headline 的就不当成合法条目

                    item = {
                        "headline": head,
                        "one_liner": one,
                        "task": task,
                        "type": typ,
                        "novelty": nov,
                        "key_numbers": [],
                        "reusability": [],
                        "limitations": [],
                        "links": {
                            "paper": paper,
                            "code": code,
                            "project": proj,
                            "pdf": _arxiv_pdf(paper),
                        },
                        "tags": tags,
                        "impact_score": imp,
                        "reproducibility_score": rep,
                        "quick_read": (one[:178] + "…") if len(one) > 180 else one,
                    }
                    items.append(item)
                    if len(items) >= limit:
                        break
                return items

            txt2 = (locals().get('out_fix') or locals().get('out') or '')
            salvaged2 = _regex_salvage(txt2, limit=n_items)
            if salvaged2:
                print(f"make_scholarpush salvaged_items_v2: {len(salvaged2)}")
                j = {"generated_at": _today_cn_08_utc_iso(), "items": salvaged2, "refs": []}

                # 复用同一套清洗/打分/统计逻辑
                cleaned = []
                for it in (j.get("items") or [])[:n_items]:
                    h  = (it.get("headline") or "").strip()
                    ol = (it.get("one_liner") or "").strip()
                    it["headline"]   = h
                    it["one_liner"]  = ol or h or ""
                    it.setdefault("links", {})
                    it["links"].setdefault("paper",  "N/A")
                    it["links"].setdefault("code",   "N/A")
                    it["links"].setdefault("project","N/A")
                    it["links"].setdefault("pdf", _arxiv_pdf(it["links"].get("paper","")))
                    it.setdefault("tags", [])
                    it.setdefault("key_numbers", [])
                    qr = (it.get("quick_read") or it.get("one_liner") or "").strip()
                    it["quick_read"] = (qr[:298] + "…") if len(qr) > 300 else qr
                    it["impact_score"] = _coerce_score(it.get("impact_score", 50))
                    it["reproducibility_score"] = _coerce_score(it.get("reproducibility_score", 50))
                    cleaned.append(it)
                j["items"] = cleaned

                if not j.get("stats"):
                    j["stats"] = _build_stats(j["items"]) if j.get("items") else {"by_task":{}, "with_code":0, "new_benchmarks":0}
                if not j.get("must_reads") or not j.get("nice_to_read"):
                    must, nice = _split_picks(j["items"])
                    j["must_reads"] = must
                    j["nice_to_read"] = nice

                # 统一字段注入（正则抢救路径也注入）
                try:
                    entries_map = _make_entries_map(base_entries)
                except Exception:
                    entries_map = {}
                try:
                    daily_map = _make_daily_summary_map(daily) if daily else {}
                except Exception:
                    daily_map = {}
                title_map = _build_entry_title_map(base_entries)
                for it in j.get("items", []):
                    paper = it.get("links", {}).get("paper", "") or ""
                    u_norm = _normalize_url(paper)
                    zh_title = (it.get("headline") or "").strip()
                    en_title = (entries_map.get(u_norm, {}).get("title_en") or zh_title)
                    it["title_i18n"] = {"zh": zh_title, "en": en_title}
                    zh_abs = _best_zh_summary(u_norm, it, entries_map, daily_map)
                    en_try = _translate_zh_to_en(zh_abs)
                    en_src = (entries_map.get(u_norm, {}).get("summary_en") or "").strip()
                    en_abs = en_try if (en_try and not _looks_cjk(en_try)) else en_src
                    en_abs = _clean_arxiv_announce_prefix(en_abs)
                    es_try = _translate_zh_to_es(zh_abs)
                    if (not es_try) or _looks_cjk(es_try):
                        es_from_en = _translate_en_to_es(en_abs)
                        es_abs = es_from_en if (es_from_en and not _looks_cjk(es_from_en)) else ""
                    else:
                        es_abs = es_try
                    it["summary_i18n"] = {"zh": zh_abs, "en": en_abs, "es": es_abs}
                    host = entries_map.get(u_norm, {}).get("host") or _hostname(paper)
                    it["host"] = host
                    if not it["links"].get("pdf") or it["links"]["pdf"] == "N/A":
                        it["links"]["pdf"] = _arxiv_pdf(paper)
                    it["ts"] = entries_map.get(u_norm, {}).get("ts") or j["generated_at"]
                    it["has_code"] = bool(it["links"].get("code") and it["links"]["code"] != "N/A")
                    if "key_numbers_compact" not in it:
                        it["key_numbers_compact"] = _compact_key_numbers(it.get("key_numbers"))
                    try:
                        knc = [ (s or "").strip() for s in (it.get("key_numbers_compact") or []) if s and (s or "").strip().upper() != "N/A" ]
                        it["key_numbers_compact"] = knc[:3]
                    except Exception:
                        it["key_numbers_compact"] = it.get("key_numbers_compact") or []
                    try:
                        it["key_numbers_compact"] = [ _clean_badge_text(s) for s in it.get("key_numbers_compact", []) if _clean_badge_text(s) ]
                    except Exception:
                        pass
                    # Clean lists in regex-salvage path
                    def _clean_list(arr, limit=None):
                        out = []
                        for x in (arr or []):
                            s = (x or "").strip()
                            if not s or s.upper() == "N/A":
                                continue
                            out.append(s)
                            if limit and len(out) >= limit:
                                break
                        return out
                    it["reusability"] = _clean_list(it.get("reusability"), limit=3)
                    it["limitations"] = _clean_list(it.get("limitations"), limit=2)
                    it["tags"] = _clean_list(it.get("tags"))
                    _maybe_attach_source_link(it, title_map, entries)
                _validate_scholarpush(j)
                return j
        except Exception as salvage2_error:
            print("make_scholarpush salvage_v2_failed:", salvage2_error)

        # —— 两次抢救都失败：打印片段并回退 —— #
        try:
            raw = (locals().get('out') or '')
            if raw:
                head = raw[:280]; tail = raw[-280:] if len(raw) > 280 else ''
                print("make_scholarpush raw_out_snippet:", head, " … ", tail)
        except Exception:
            pass
        try:
            raw_fix = (locals().get('out_fix') or '')
            if raw_fix:
                head = raw_fix[:280]; tail = raw_fix[-280:] if len(raw_fix) > 280 else ''
                print("make_scholarpush out_fix_snippet:", head, " … ", tail)
        except Exception:
            pass

        print("make_scholarpush failed, fallback:", e)
        # Ensure we have some entries to fallback on
        fb_entries = entries if entries else (base_entries[:max(8, int(os.getenv("MAX_ENTRIES","40")))] if base_entries else [])
        j = _fallback_scholarpush(fb_entries, n_items=n_items)

        # 注入统一字段（与上面主路径一致）
        try:
            entries_map = _make_entries_map(base_entries)
        except Exception:
            entries_map = {}
        try:
            daily_map = _make_daily_summary_map(daily) if daily else {}
        except Exception:
            daily_map = {}
        title_map = _build_entry_title_map(base_entries)
        for it in j.get("items", []):
            paper = it.get("links", {}).get("paper", "") or ""
            u_norm = _normalize_url(paper)
            zh_title = (it.get("headline") or "").strip()
            en_title = (entries_map.get(u_norm, {}).get("title_en") or zh_title)
            it["title_i18n"] = {"zh": zh_title, "en": en_title}
            zh_abs = _best_zh_summary(u_norm, it, entries_map, daily_map)
            # English from zh; if fails or looks CJK, use source EN
            en_try = _translate_zh_to_en(zh_abs)
            en_src = (entries_map.get(u_norm, {}).get("summary_en") or "").strip()
            en_abs = en_try if (en_try and not _looks_cjk(en_try)) else en_src
            # Spanish from zh; if fails/CJK, try EN->ES; else empty
            es_try = _translate_zh_to_es(zh_abs)
            if (not es_try) or _looks_cjk(es_try):
                es_from_en = _translate_en_to_es(en_abs)
                es_abs = es_from_en if (es_from_en and not _looks_cjk(es_from_en)) else ""
            else:
                es_abs = es_try
            it["summary_i18n"] = {"zh": zh_abs, "en": en_abs, "es": es_abs}
            host = entries_map.get(u_norm, {}).get("host") or _hostname(paper)
            it["host"] = host
            if not it["links"].get("pdf") or it["links"]["pdf"] == "N/A":
                it["links"]["pdf"] = _arxiv_pdf(paper)
            it["ts"] = entries_map.get(u_norm, {}).get("ts") or j.get("generated_at")
            it["has_code"] = bool(it["links"].get("code") and it["links"]["code"] != "N/A")
            if "key_numbers_compact" not in it:
                it["key_numbers_compact"] = _compact_key_numbers(it.get("key_numbers"))
            try:
                knc = [ (s or "").strip() for s in (it.get("key_numbers_compact") or []) if s and (s or "").strip().upper() != "N/A" ]
                it["key_numbers_compact"] = knc[:3]
            except Exception:
                it["key_numbers_compact"] = it.get("key_numbers_compact") or []
            try:
                it["key_numbers_compact"] = [ _clean_badge_text(s) for s in it.get("key_numbers_compact", []) if _clean_badge_text(s) ]
            except Exception:
                pass
            # Clean lists in fallback
            def _clean_list(arr, limit=None):
                out = []
                for x in (arr or []):
                    s = (x or "").strip()
                    if not s or s.upper() == "N/A":
                        continue
                    out.append(s)
                    if limit and len(out) >= limit:
                        break
                return out
            it["reusability"] = _clean_list(it.get("reusability"), limit=3)
            it["limitations"] = _clean_list(it.get("limitations"), limit=2)
            it["tags"] = _clean_list(it.get("tags"))
            _maybe_attach_source_link(it, title_map, base_entries)
        return j



# ===== HTML 拼装 =====
def load_tpl():
    with open(TPL_PATH, "r", encoding="utf-8") as f:
        return f.read()

def to_slug(s):
    s = re.sub(r"[^\w\u4e00-\u9fff\- ]+", "", s)
    s = s.strip().replace(" ", "-")
    return s[:60]

def gen_toc_html(toc):
    items = []
    for i, t in enumerate(toc, 1):
        aid = f"sec-{i}"
        items.append(f'<li><a href="#{aid}">{BS(t, "html.parser").text}</a></li>')
    return "\n".join(items)

def _link_ref_indexes(html: str, ref_count: int) -> str:
    try:
        return re.sub(r"\[(\d{1,2})\]", lambda m: f"<sup><a href=\"#ref-{min(max(int(m.group(1)),1), ref_count)}\">[{m.group(1)}]</a></sup>" if ref_count>0 else m.group(0), html)
    except Exception:
        return html

def sections_to_html(sections, ref_count: int = 0):
    parts=[]
    for i, sec in enumerate(sections, 1):
        hid = f"sec-{i}"
        heading = BS(sec["heading"], "html.parser").text
        # markdown → HTML
        html = md2html(sec["markdown"], extras=["fenced-code-blocks","tables","strike"])
        html = _link_ref_indexes(html, ref_count)
        parts.append(f'<h2 id="{hid}">{heading}</h2>\n{html}')
    return "\n".join(parts)

# ===== OG 图（SVG→PNG）=====
def make_og(title, date_str, outfile_png):
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#0f172a"/>
  <text x="60" y="200" font-size="72" fill="#e2e8f0" font-family="system-ui,Segoe UI,Roboto,sans-serif">AI Daily · {date_str}</text>
  <foreignObject x="60" y="260" width="1080" height="320">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#94a3b8;font-size:44px;line-height:1.25;font-family:system-ui,Segoe UI,Roboto,sans-serif;">{BS(title,'html.parser').text}</div>
  </foreignObject>
</svg>"""
    tmp_svg = outfile_png.replace(".png",".svg")
    with open(tmp_svg,"w",encoding="utf-8") as f: f.write(svg)
    # 需要 librsvg2-bin: rsvg-convert (provided in CI). 在本地缺失时忽略错误。
    try:
        subprocess.run(["rsvg-convert","-w","1200","-h","630","-o",outfile_png,tmp_svg], check=True)
    except Exception as e:
        # 留下 SVG 即可，本地预览不会中断
        raise RuntimeError(f"rsvg-convert not available: {e}")

# ===== 索引 & RSS =====
def update_index(meta):
    idx_path = os.path.join(DATA_DIR, "index.json")
    idx = []
    if os.path.exists(idx_path):
        with open(idx_path,"r",encoding="utf-8") as f:
            try: idx = json.load(f)
            except: idx = []
    # 去重 by slug
    idx = [x for x in idx if x.get("slug") != meta["slug"]]
    idx.insert(0, meta)
    idx = idx[:90]  # 保留最近90篇
    with open(idx_path,"w",encoding="utf-8") as f: json.dump(idx,f,ensure_ascii=False,indent=2)
    return idx

def write_rss(index):
    # 极简 RSS；如要并入你原站点RSS，我们可再合并
    items=[]
    for it in index[:30]:
        items.append(f"""
  <item>
    <title>{it["title"]}</title>
    <link>{it["url"]}</link>
    <description><![CDATA[{it["description"]}]]></description>
    <pubDate>{it["published_rfc2822"]}</pubDate>
  </item>""")
    xml=f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>AI Daily · Fan Wan</title>
  <link>{SITE_BASE or ''}/data/ai/blog/rss.xml</link>
  <description>每日 AI 要闻与解读</description>
  {''.join(items)}
</channel></rss>"""
    with open(os.path.join(DATA_DIR,"rss.xml"),"w",encoding="utf-8") as f: f.write(xml)

# ===== Sections index (per-section searchable entries) =====
def _plain_summary_from_markdown(md: str, limit: int = 240) -> str:
    try:
        html = md2html(md or "", extras=["fenced-code-blocks","tables","strike"])  # type: ignore
        text = BS(html, "html.parser").get_text(" ", strip=True)
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"\[(\d{1,2})\]", "", text)  # drop [1] style refs
        return (text[:limit]).strip()
    except Exception:
        return (md or "")[:limit].strip()

def update_sections(meta: dict, j: dict):
    """Update data/ai/blog/sections.json with per-section entries for this daily post."""
    sec_path = os.path.join(DATA_DIR, "sections.json")
    arr = []
    if os.path.exists(sec_path):
        try:
            with open(sec_path, "r", encoding="utf-8") as f:
                arr = json.load(f)
        except Exception:
            arr = []

    slug = meta.get("slug")
    title = meta.get("title")
    pub_iso = meta.get("published")
    tags = meta.get("tags") or []
    og_image = meta.get("og_image")
    # drop any old sections belonging to the same daily
    arr = [x for x in arr if x.get("daily_slug") != slug]

    sections = j.get("sections") or []
    for i, sec in enumerate(sections, 1):
        heading = (sec.get("heading") or "").strip()
        md = sec.get("markdown") or ""
        # extract ref indexes present in this section
        ref_idx = sorted({ int(m.group(1)) for m in re.finditer(r"\[(\d{1,2})\]", md) })
        summary = _plain_summary_from_markdown(md, limit=240)
        url = f"{meta.get('url')}#sec-{i}"
        entry = {
            "id": f"{slug}#sec-{i}",
            "date": pub_iso,
            "daily_slug": slug,
            "daily_title": title,
            "section_index": i,
            "heading": heading,
            "summary": summary,
            "url": url,
            "tags": tags,
            "og_image": og_image,
            "refs": ref_idx,
        }
        arr.insert(0, entry)

    # keep at most recent N sections
    arr = arr[:600]
    with open(sec_path, "w", encoding="utf-8") as f:
        json.dump(arr, f, ensure_ascii=False, indent=2)

# ===== Buttondown（选填，创建草稿）=====
def push_buttondown(meta, html):
    api = os.getenv("BUTTONDOWN_API_KEY")
    if not api: return
    status = os.getenv("BUTTONDOWN_STATUS","draft")
    try:
        r = requests.post(
            "https://api.buttondown.email/v1/emails",
            headers={"Authorization": f"Token {api}"},
            json={
              "subject": meta["title"],
              "body": html,
              "status": status
            },
            timeout=60
        )
        r.raise_for_status()
    except Exception as e:
        print("Buttondown failed:", e)

def main():
    # 0) load local env for API keys (won't be committed if .gitignore ignores .env*)
    _load_env_files()
    _debug_provider_keys_present()
    # Daily permanently disabled: we will not write blog HTML/RSS/sections or emails.
    daily_enable = False
    # 1) 抓取
    entries = fetch_items(limit_per_feed=int(os.getenv("PER_FEED_LIMIT", "25")))
    min_items = int(os.getenv("MIN_ITEMS","6"))
    if len(entries) < min_items:
        print("Not enough entries today; skip.")
        return

    # 2) 选题 & 成文（仍生成 Daily JSON 仅用于 ScholarPush 的中文摘要，不落盘）
    max_words = int(os.getenv("MAX_WORDS","1100"))
    j = pick_and_write(entries, max_words=max_words)
    # Skipping HTML/RSS/sections/Buttondown regardless of env
    print("Daily outputs disabled; only generating ScholarPush JSON.")

    # —— 生成 ScholarPush 快报 JSON —— 
    try:
        # Cleanup previous Daily push artifacts to start fresh (requested)
        try:
            blog_dir = os.path.join("data","ai","blog")
            for fname in ("index.json","rss.xml","sections.json"):
                p = os.path.join(blog_dir, fname)
                if os.path.exists(p):
                    os.remove(p)
        except Exception:
            pass
        sp = make_scholarpush(
            entries,
            n_items=int(os.getenv("SCHOLARPUSH_ITEMS","8")),
            daily=j,
        )
        base_dir = os.path.join("data/ai/scholarpush")
        os.makedirs(base_dir, exist_ok=True)
        # write latest
        sp_path = os.path.join(base_dir, "index.json")
        with open(sp_path, "w", encoding="utf-8") as f:
            json.dump(sp, f, ensure_ascii=False, indent=2)
        # archive by date (CN day based on generated_at; ensure 08:00 CN)
        try:
            # Force generated_at aligned to CN 08:00 for consistency
            sp["generated_at"] = _today_cn_08_utc_iso()
            dt = sp.get("generated_at")
            # parse ISO robustly, then convert to Asia/Shanghai to get date
            dt_parsed = dtp.parse(dt)
            try:
                cn = ZoneInfo("Asia/Shanghai")
            except Exception:
                cn = dttz.gettz("Asia/Shanghai")
            d = dt_parsed.astimezone(cn).date()
            day_fname = f"{d.isoformat()}.json"
            day_path = os.path.join(base_dir, day_fname)
            with open(day_path, "w", encoding="utf-8") as f:
                json.dump(sp, f, ensure_ascii=False, indent=2)
            # update dates index by scanning existing archives (robust against prior overwrite)
            dates_path = os.path.join(base_dir, "dates.json")
            try:
                all_files = os.listdir(base_dir)
            except Exception:
                all_files = []
            # collect YYYY-MM-DD.json files
            date_list = []
            for fn in all_files:
                try:
                    if re.match(r"\d{4}-\d{2}-\d{2}\.json$", fn):
                        date_list.append(fn[:-5])
                except Exception:
                    continue
            # ensure today's date present
            iso_day = d.isoformat()
            if iso_day not in date_list:
                date_list.append(iso_day)
            date_list = sorted(set(date_list), reverse=True)
            with open(dates_path, "w", encoding="utf-8") as df:
                json.dump(date_list, df, ensure_ascii=False, indent=2)
            print("ScholarPush written:", sp_path, "and archived:", day_path)
        except Exception as arch_e:
            print("ScholarPush archive failed:", arch_e)
    except Exception as e:
        print("ScholarPush failed:", e)
    
    # No Buttondown/email or blog HTML writes

if __name__ == "__main__":
    main()
