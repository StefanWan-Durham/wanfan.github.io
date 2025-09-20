# 更新 corpus + snapshots + hotlists
node tools/modelswatch/weekly.mjs
# 生成当日灵感
node tools/modelswatch/daily.mjs
# 启动本地静态服务
npm run serve
# 浏览器访问
# http://localhost:8080/lab/modelswatch/modelswatch.htmlModel Watch Scripts - Logging
=============================

The scripts under this folder now use a lightweight logging utility (`log.js`).

Environment Variable:
  MODELSWATCH_DEBUG=1 (also accepts true/yes/on, case-insensitive)
    Enables verbose debug(...) logs. If unset, only info/warn/error appear.

API:
  import { debug, info, warn, error, summary } from './log.js';
  debug('details'); // gated
  info('high-level progress');
  warn('non-fatal issue');
  error('fatal issue');
  summary('object label', someObject); // pretty prints JSON when debug enabled

Example:
  MODELSWATCH_DEBUG=1 node tools/modelswatch/daily.mjs

In CI you can omit MODELSWATCH_DEBUG to keep logs concise.

Schema Migration (Phase 1)
--------------------------
Canonical cumulative fields for HF models are now:
  stats.downloads_total
  stats.likes_total

Legacy pseudo fields (removed from fetch layer):
  hf_downloads_7d, hf_likes
These previously held cumulative totals but were ambiguously named. They are no longer emitted. Front-end normalizes any historical JSON by mapping hf_downloads_7d -> downloads_total and hf_likes -> likes_total if the canonical fields are missing.

7-day delta fields (computed ONLY in hotlists after snapshots):
  downloads_7d, likes_7d (HF)
  stars_7d, forks_7d (GitHub)

Schema versioning:
  See schema.js (SCHEMA_VERSION=1). Hotlists and daily files embed { version } and front-end warns on mismatch.

Recommended weekly pipeline order (first run / maintenance):
  1. node tools/modelswatch/weekly.mjs  (refresh corpus & tops)
  2. node tools/modelswatch/build_snapshots.mjs
  3. node tools/modelswatch/update_model_hotlist.mjs
  4. node tools/modelswatch/update_project_hotlist.mjs
  (Optional) node tools/modelswatch/seed_hotlists.mjs for first-time seeding before updates.

Daily picks (LLM summaries + reasons):
  node tools/modelswatch/daily.mjs

