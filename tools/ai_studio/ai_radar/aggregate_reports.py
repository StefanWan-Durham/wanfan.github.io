import json, os
from datetime import datetime, timedelta, timezone

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

out = {
    'generated_at': now.isoformat().replace('+00:00','Z'),
    'window_hours': WINDOW_HOURS,
    'count': min(len(filtered), MAX_ITEMS),
    'items': filtered[:MAX_ITEMS]
}

with open(LATEST_PATH, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f"[ai-radar] latest.json generated: {out['count']} items -> {LATEST_PATH}")

# Also write daily archive by Beijing date (UTC+8)
bj_now = now + timedelta(hours=8)
date_str = bj_now.strftime('%Y-%m-%d')
daily_path = os.path.join(OUT_DIR, f'{date_str}.json')
with open(daily_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print(f"[ai-radar] daily archive generated: {daily_path}")

# Maintain dates index (most-recent first, unique)
dates = []
if os.path.exists(DATES_INDEX):
    try:
        with open(DATES_INDEX, 'r', encoding='utf-8') as f:
            dates = json.load(f)
            if not isinstance(dates, list):
                dates = []
    except Exception:
        dates = []
if date_str in dates:
    dates.remove(date_str)
dates.insert(0, date_str)
with open(DATES_INDEX, 'w', encoding='utf-8') as f:
    json.dump(dates, f, ensure_ascii=False, indent=2)
print(f"[ai-radar] dates index updated: {len(dates)} days -> {DATES_INDEX}")
