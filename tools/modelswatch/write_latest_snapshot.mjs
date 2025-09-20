#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(ROOT, 'data/ai/modelswatch');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const OUT_FILE = path.join(DATA_DIR, 'latest_snapshot.json');

function listSnapshotDates(){
  try {
    const entries = fs.readdirSync(SNAP_DIR, { withFileTypes: true });
    return entries.filter(e=>e.isDirectory() && /\d{4}-\d{2}-\d{2}/.test(e.name)).map(e=>e.name).sort().reverse();
  } catch { return []; }
}

function pickLatest(dates){
  if(!dates.length) return null;
  // Ensure directories actually contain at least one summaries sidecar
  for(const d of dates){
    const hf = path.join(SNAP_DIR, d, 'hf_summaries.json');
    const gh = path.join(SNAP_DIR, d, 'gh_summaries.json');
    if(fs.existsSync(hf) || fs.existsSync(gh)) return d;
  }
  return dates[0];
}

function main(){
  const dates = listSnapshotDates();
  const latest = pickLatest(dates);
  const obj = { latest, generated_at: new Date().toISOString(), candidates: dates.slice(0,10) };
  fs.writeFileSync(OUT_FILE, JSON.stringify(obj, null, 2));
  console.log(`[latest-snapshot] latest=${latest||'none'} -> ${OUT_FILE}`);
}

main();
