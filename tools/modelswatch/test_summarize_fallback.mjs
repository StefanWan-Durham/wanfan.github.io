#!/usr/bin/env node
import { summarizeTriJSON, summarizeDiagnostics } from './summarize_multi.mjs';

const prompt = process.argv.slice(2).join(' ') || 'An open-source toolkit that fine-tunes large language models for retrieval-augmented generation with adaptive vector compression and hybrid sparse-dense indexing.';

(async () => {
  const out = await summarizeTriJSON(prompt, { temperature: 0.3 });
  console.log('Summary Output:', out);
  console.log('Diagnostics:', summarizeDiagnostics);
})();
