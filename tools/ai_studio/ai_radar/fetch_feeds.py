import feedparser, hashlib, json, os
from datetime import datetime, timezone
from dateutil import parser as dtp
from utils import canonical_url

BASE_DIR = os.path.dirname(__file__)
FEED_FILES = [os.path.join(BASE_DIR, 'feeds', 'core.txt')]
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

for url in feeds:
    try:
        d = feedparser.parse(url)
    except Exception:
        continue
    site = (getattr(d.feed, 'link', None) or url)
    for e in d.entries:
        link = canonical_url(getattr(e, 'link', site))
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
        items.append({
            'id': pid,
            'source': {'site': site, 'feed': url},
            'url': link,
            'title': title,
            'raw_excerpt': (getattr(e, 'summary', '') or '')[:800],
            'published_at': ts_iso,
            'fetched_at': now_iso,
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
