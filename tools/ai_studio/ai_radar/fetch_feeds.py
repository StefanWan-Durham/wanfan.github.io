import feedparser, hashlib, json, os, re
from datetime import datetime, timezone
from dateutil import parser as dtp
from utils import canonical_url

BASE_DIR = os.path.dirname(__file__)
FEED_FILES = [os.path.join(BASE_DIR, 'feeds', 'core.txt')]
# Optionally include extra feeds if present
EXTRA_FILE = os.path.join(BASE_DIR, 'feeds', 'extra.txt')
if os.path.exists(EXTRA_FILE):
    FEED_FILES.append(EXTRA_FILE)
OUT_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', '..', '..', 'data', 'ai', 'airadar'))
TMP_PATH = os.path.join(OUT_DIR, '_events_tmp.json')

os.makedirs(OUT_DIR, exist_ok=True)

# load feeds
feeds = []
for fp in FEED_FILES:
    with open(fp, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            feeds.append(line)

items = []
now_iso = datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

AI_KEYWORDS = re.compile(r"\b(ai|artificial intelligence|machine learning|ml|deep learning|llm|gpt|chatgpt|diffusion|gen(erative)?|transformer|rag|retriev|agent|vision|lora|fine[- ]?tune|sora|gemini|copilot)\b", re.I)

def is_ai_related(title: str, summary: str, site: str, feed_url: str) -> bool:
    """Heuristic AI filter: accept if keyword appears in title or summary; always accept for whitelisted AI feeds; reject obvious non-tech generalities from HN frontpage."""
    t = (title or '').strip()
    s = (summary or '').strip()
    src = (site or '') + ' ' + (feed_url or '')
    host = ''
    try:
        from urllib.parse import urlparse
        host = (urlparse(feed_url or site).hostname or '').lower()
    except Exception:
        pass
    # Always-accept list (domain contains these)
    ALWAYS = (
        'openai.com','ai.googleblog.com','blogs.nvidia.com','aws.amazon.com','microsoft.com','machinelearning.apple.com','huggingface.co',
        'jiqizhixin.com','qbitai.com','technologyreview.com','techcrunch.com','theverge.com','wired.com','arstechnica.com','infoq.com','infoq.cn'
    )
    if any(h in (host or '') for h in ALWAYS):
        return True
    # HN frontpage tends to include non-AI topics → require keyword
    if 'hnrss.org' in src and 'frontpage' in (feed_url or ''):
        return bool(AI_KEYWORDS.search(t) or AI_KEYWORDS.search(s))
    # Default: keyword in title or summary
    return bool(AI_KEYWORDS.search(t) or AI_KEYWORDS.search(s))

def clean_hn_boilerplate(text: str) -> str:
    if not text:
        return ''
    s = re.sub(r'<[^>]+>', ' ', str(text))
    s = re.sub(r"Article URL:\s*\S+", '', s, flags=re.I)
    s = re.sub(r"Comments URL:\s*\S+", '', s, flags=re.I)
    s = re.sub(r"Points:\s*\d+", '', s, flags=re.I)
    s = re.sub(r"#\s*Comments:\s*\d+", '', s, flags=re.I)
    s = re.sub(r"\s{2,}", ' ', s).strip()
    return s

for url in feeds:
    try:
        d = feedparser.parse(url)
    except Exception:
        continue
    site = (getattr(d.feed, 'link', None) or url)
    for e in d.entries:
        link = canonical_url(getattr(e, 'link', site))
        # Drop arXiv and GitHub items early
        if re.search(r"(^|\.)arxiv\.org", link, re.I) or re.search(r"(^|\.)github\.com", link, re.I):
            continue
        title = getattr(e, 'title', '').strip()
        published = getattr(e, 'published', '') or getattr(e, 'updated', '')
        try:
            ts = dtp.parse(published)
        except Exception:
            ts = datetime.now(timezone.utc)
        # normalize to UTC ISO8601 Z
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        ts_utc = ts.astimezone(timezone.utc)
        ts_iso = ts_utc.isoformat().replace('+00:00','Z')
        pid = hashlib.sha256(f"{link}|{title}|{ts.isoformat()}".encode('utf-8')).hexdigest()[:16]
        raw_summary = (getattr(e, 'summary', '') or '')
        clean_summary = clean_hn_boilerplate(raw_summary)[:800]
        # Also exclude if source feed is arXiv or GitHub
        if re.search(r"(^|\.)arxiv\.org", url, re.I) or re.search(r"(^|\.)github\.com", url, re.I):
            continue
        if not is_ai_related(title, clean_summary, site, url):
            continue
        # basic tag inference
        tags = []
        low = f"{title} {clean_summary}".lower()
        if re.search(r"policy|regulat|eu ai act|govern|safety|compliance", low):
            tags.append('Policy')
        if re.search(r"funding|raise|seed|series [abc]|acquire|acquisition|grants?", low):
            tags.append('Funding')
        if re.search(r"arxiv|paper|preprint|dataset|benchmark|research|study", low):
            tags.append('Research')
        if re.search(r"tool|library|sdk|framework|plugin", low):
            tags.append('Tools')
        if re.search(r"adopt|industry|product|release|integration", low):
            tags.append('Industry')
        items.append({
            'id': pid,
            'source': {'site': site, 'feed': url},
            'url': link,
            'title': title,
            'raw_excerpt': clean_summary,
            'tags': tags,
            'published_at': ts_iso,
            'fetched_at': now_iso,
            # i18n to be filled in aggregation (leave empty to avoid blocking zh->en etc.)
            'title_i18n': {},
            'excerpt_i18n': {},
        })

# dedupe by (url, title)
seen, unique = set(), []
for it in sorted(items, key=lambda x: x['published_at'], reverse=True):
    sig = (it['url'], (it['title'] or '').lower())
    if sig in seen:
        continue
    seen.add(sig)
    unique.append(it)

with open(TMP_PATH, 'w', encoding='utf-8') as f:
    json.dump({'generated_at': now_iso, 'items': unique}, f, ensure_ascii=False, indent=2)

print(f"[ai-radar] written {len(unique)} events -> {TMP_PATH}")
