import json, os
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(__file__)
OUT_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', '..', '..', 'data', 'ai', 'airadar'))
TMP_PATH = os.path.join(OUT_DIR, '_events_tmp.json')
LATEST_PATH = os.path.join(OUT_DIR, 'latest.json')

WINDOW_HOURS = int(os.getenv('RADAR_WINDOW_HOURS', '48'))
MAX_ITEMS = int(os.getenv('RADAR_MAX_ITEMS', '80'))

now = datetime.utcnow()

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

out = {
    'generated_at': now.isoformat() + 'Z',
    'window_hours': WINDOW_HOURS,
    'count': min(len(filtered), MAX_ITEMS),
    'items': filtered[:MAX_ITEMS]
}

with open(LATEST_PATH, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f"[ai-radar] latest.json generated: {out['count']} items -> {LATEST_PATH}")
