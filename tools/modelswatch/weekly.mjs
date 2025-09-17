#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGithubTop } from './fetch_github.js';
import { fetchHFTop } from './fetch_hf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const outDir = path.join(root, 'data/ai/modelswatch');

function writeJSON(p, obj){ writeFileSync(p, JSON.stringify(obj, null, 2)); }

async function main(){
  const now = new Date().toISOString();
  const gh = await fetchGithubTop();
  const hf = await fetchHFTop();
  writeJSON(path.join(outDir, 'top_github.json'), { updated_at: now, items: gh });
  writeJSON(path.join(outDir, 'top_hf.json'), { updated_at: now, items: hf });
  // Also refresh corpus files for daily picks
  writeJSON(path.join(outDir, 'corpus.github.json'), { updated_at: now, items: gh });
  writeJSON(path.join(outDir, 'corpus.hf.json'), { updated_at: now, items: hf });
}

main().catch(e=>{ console.error(e); process.exit(1); });
