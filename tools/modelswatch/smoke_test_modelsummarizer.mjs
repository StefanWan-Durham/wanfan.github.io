#!/usr/bin/env node
/**
 * smoke_test_modelsummarizer.mjs
 * Lightweight test to assert cache reuse semantics for generate_snapshot_summaries.mjs.
 * Strategy:
 * 1. Create a temp test directory under data/ai/modelswatch/tmp-smoke with a fake snapshot date (YYYY-MM-DD) = today.
 * 2. Seed minimal hf.json & gh.json plus corpus.hf.json/corpus.github.json entries for a single model.
 * 3. Seed summary_cache.json with a hash for that model including tri-lingual summaries.
 * 4. Run generate_snapshot_summaries.mjs with environment pointing to modified DATA_DIR via process chdir.
 * 5. Capture stdout; assert that generated count is 0 (reuse path). Exit 0 on success, 1 on failure.
 *
 * NOTE: This does not call the LLM; absence of API key is fine because generation should be skipped entirely if cache hits.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

// Derive project root robustly on Windows: use fileURLToPath then normalize drive prefix.
import { fileURLToPath } from 'url';
const here = fileURLToPath(new URL('.', import.meta.url));
let ROOT = path.resolve(here, '../../');
// Normalize accidental leading slashes (e.g., /D:/ -> D:/)
if(/^\\?[A-Za-z]:\\/.test(ROOT.replace(/\//g,'\\'))===false && /^\/[A-Za-z]:\//.test(ROOT)){
  ROOT = ROOT.replace(/^\//,'');
}
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');

function todayKey(){ const d=new Date(); const tz = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d); return tz; }
const day = todayKey();
const snapDir = path.join(DATA_DIR, 'snapshots', day);

// Ensure directories
fs.mkdirSync(snapDir, { recursive: true });

// Minimal corpus + snapshot entries
const modelId = 'test-model-xyz';
const corpusHF = { items: [{ id: modelId, name: 'Test Model XYZ', source:'hf', description:'A test model for smoke.', tags:['chat'], stats:{}, updated_at: '2025-01-01T00:00:00Z' }] };
const corpusGH = { items: [] };
fs.writeFileSync(path.join(DATA_DIR, 'corpus.hf.json'), JSON.stringify(corpusHF, null, 2));
fs.writeFileSync(path.join(DATA_DIR, 'corpus.github.json'), JSON.stringify(corpusGH, null, 2));

// Snapshots referencing the model with stats
fs.writeFileSync(path.join(snapDir, 'hf.json'), JSON.stringify({ [modelId]: { downloads: 123, likes: 4 } }, null, 2));
fs.writeFileSync(path.join(snapDir, 'gh.json'), JSON.stringify({}, null, 2));

// Pre-compute hash exactly as in generate_snapshot_summaries hashItem
import crypto from 'crypto';
function hashItem(it){
  const stats = it.stats||{};
  const fields = [it.id||'', it.name||'', it.source||'', (it.description||'').slice(0,4000), (it.summary||'').slice(0,4000), (it.tags||[]).sort().join(','), stats.stars||stats.downloads||stats.likes||'', stats.downloads||'', stats.likes||'', it.updated_at||''];
  const h = crypto.createHash('sha256').update(fields.join('|')).digest('hex');
  return 'sha256:'+h;
}
const corpusItem = corpusHF.items[0];
const hash = hashItem(corpusItem);
const cachePath = path.join(DATA_DIR, 'summary_cache.json');
const cacheObj = { schema_version:1, generated_at:new Date().toISOString(), models:{ [`hf:${modelId}`]: { hash, updated_at: corpusItem.updated_at, summary_en:'EN cached', summary_zh:'ZH 缓存', summary_es:'ES en caché', summary:'ZH 缓存', last_generated: new Date().toISOString() } } };
fs.writeFileSync(cachePath, JSON.stringify(cacheObj, null, 2));

// Run the generator script (module import) capturing stdout
const script = path.join(ROOT, 'tools/modelswatch/generate_snapshot_summaries.mjs');
// Execute script directly (it has no shebang). Node should print the summary line.
const result = spawnSync(process.execPath, [script], { encoding: 'utf-8' });
if(result.error){ console.error('[smoke] spawn error', result.error); process.exit(1); }
const out = (result.stdout||'') + (result.stderr||'');
process.stdout.write(out);
// Expect log pattern reuse>0 generated=0
const reuseMatch = out.match(/reuse=(\d+)/);
const genMatch = out.match(/generated=(\d+)/);
if(!reuseMatch || !genMatch){
  console.error('[smoke] Could not parse generator output. Raw output:\n'+out+"\n[smoke] HINT: Did generate_snapshot_summaries.mjs exit before logging summary line?");
  process.exit(1);
}
const reuse = Number(reuseMatch[1]);
const generated = Number(genMatch[1]);
if(reuse >= 1 && generated === 0){
  console.log('[smoke] PASS cache reuse works');
  process.exit(0);
} else {
  console.error(`[smoke] FAIL expected reuse>=1 & generated=0, got reuse=${reuse} generated=${generated}`);
  process.exit(1);
}
