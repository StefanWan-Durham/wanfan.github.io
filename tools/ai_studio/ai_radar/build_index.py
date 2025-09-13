import json, os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[3]
OUT_DIR = BASE_DIR / 'data' / 'ai' / 'airadar'
DATES_INDEX = OUT_DIR / 'dates.json'
INDEX_PATH = OUT_DIR / 'index.json'

MAX_DAYS = int(os.getenv('RADAR_INDEX_DAYS', '120'))
MAX_ITEMS = int(os.getenv('RADAR_INDEX_MAX_ITEMS', '8000'))

def pick(obj: dict, keys: list[str]) -> dict:
    return {k: obj.get(k) for k in keys if k in obj}

def main():
    if not DATES_INDEX.exists():
        print('[ai-radar] no dates.json; skip building index')
        return
    try:
        dates = json.loads(DATES_INDEX.read_text(encoding='utf-8'))
        if not isinstance(dates, list):
            dates = []
    except Exception:
        dates = []
    dates = dates[:MAX_DAYS]
    total = 0
    idx = []
    for d in dates:
        p = OUT_DIR / f'{d}.json'
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
            items = data.get('items', [])
        except Exception:
            items = []
        for it in items:
            rec = {
                'id': it.get('id') or '',
                'date': d,
                'url': it.get('url') or '',
                'ts': it.get('published_at') or '',
                'source_host': '',
                'title_i18n': it.get('title_i18n') or {},
                'excerpt_i18n': it.get('excerpt_i18n') or {},
            }
            # derive host
            try:
                from urllib.parse import urlparse
                rec['source_host'] = (urlparse(rec['url']).hostname or '').replace('www.','')
            except Exception:
                rec['source_host'] = ''
            idx.append(rec)
            total += 1
            if total >= MAX_ITEMS:
                break
        if total >= MAX_ITEMS:
            break
    INDEX_PATH.write_text(json.dumps({'count': len(idx), 'items': idx}, ensure_ascii=False), encoding='utf-8')
    print(f"[ai-radar] built index.json: {len(idx)} items -> {INDEX_PATH}")

if __name__ == '__main__':
    main()
