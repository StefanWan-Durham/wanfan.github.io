#!/usr/bin/env node
/**
 * reset_modelswatch.mjs
 * Clean (optionally selective) purge of historical ModelWatch artifacts so a fresh run rebuilds from scratch.
 * SAFETY: Requires either --yes flag or env RESET_MODELWATCH_CONFIRM=1.
 *
 * Default scope (if --all):
 *   data/ai/modelswatch/snapshots/*
 *   data/ai/modelswatch/daily_*.json
 *   data/ai/modelswatch/models_hotlist.json
 *   data/ai/modelswatch/projects_hotlist.json
 *   data/ai/modelswatch/weekly_summaries.json
 *   data/ai/modelswatch/summary_cache.json
 *   data/ai/modelswatch/tri_cache.json
 *   data/ai/modelswatch/summaries_diagnostics.json
 *   data/ai/modelswatch/weekly_summaries_diagnostics.json
 *   data/ai/modelswatch/summaries_coverage.json
 *   data/ai/modelswatch/coverage_summary.json
 *   data/ai/modelswatch/coverage_gaps.json
 *   data/ai/modelswatch/classification_stats.json
 *   data/ai/modelswatch/latest_snapshot.json
 *
 * Optional flags:
 *   --keep-snapshots      Retain snapshots directory
 *   --keep-caches         Retain summary_cache.json & tri_cache.json
 *   --keep-hotlists       Retain models_hotlist.json & projects_hotlist.json
 *   --yes                 Bypass interactive safety (or set RESET_MODELWATCH_CONFIRM=1)
 *
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');

function rm(p){
  try {
    if(fs.existsSync(p)){
      const stat = fs.statSync(p);
      if(stat.isDirectory()){
        fs.rmSync(p, { recursive:true, force:true });
      } else {
        fs.unlinkSync(p);
      }
      console.log('[reset] removed', path.relative(ROOT, p));
    }
  } catch(e){
    console.warn('[reset] failed remove', p, e.message);
  }
}

function parseArgs(){
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a=>a.startsWith('--')));
  return {
    yes: flags.has('--yes') || /^(1|true|yes)$/i.test(process.env.RESET_MODELWATCH_CONFIRM||''),
    keepSnapshots: flags.has('--keep-snapshots'),
    keepCaches: flags.has('--keep-caches'),
    keepHotlists: flags.has('--keep-hotlists')
  };
}

function main(){
  const f = parseArgs();
  if(!f.yes){
    console.error('[reset] refusal: add --yes or set RESET_MODELWATCH_CONFIRM=1');
    process.exit(2);
  }
  console.log('[reset] starting purge (selective flags applied)');
  const targets = [];
  if(!f.keepSnapshots) targets.push(path.join(DATA_DIR,'snapshots'));
  // pattern deletes
  const maybe = fs.readdirSync(DATA_DIR).map(fn=> path.join(DATA_DIR, fn));
  for(const p of maybe){
    const base = path.basename(p);
    if(/^daily_.*\.json$/.test(base)) targets.push(p);
  }
  if(!f.keepHotlists){
    targets.push(path.join(DATA_DIR,'models_hotlist.json'));
    targets.push(path.join(DATA_DIR,'projects_hotlist.json'));
  }
  if(!f.keepCaches){
    targets.push(path.join(DATA_DIR,'summary_cache.json'));
    targets.push(path.join(DATA_DIR,'tri_cache.json'));
  }
  targets.push(path.join(DATA_DIR,'summaries_diagnostics.json'));
  targets.push(path.join(DATA_DIR,'summaries_coverage.json'));
  targets.push(path.join(DATA_DIR,'coverage_summary.json'));
  targets.push(path.join(DATA_DIR,'coverage_gaps.json'));
  targets.push(path.join(DATA_DIR,'classification_stats.json'));
  targets.push(path.join(DATA_DIR,'latest_snapshot.json'));

  // de-dup
  const uniq = Array.from(new Set(targets));
  for(const t of uniq){ rm(t); }
  console.log('[reset] done. Purged', uniq.length, 'paths');
}

main();
