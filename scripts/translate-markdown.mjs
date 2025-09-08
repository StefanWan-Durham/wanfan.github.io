#!/usr/bin/env node
/**
 * Translate Markdown posts from zh.md → en.md / es.md.
 * - Scans content/blog/<slug>/zh.md
 * - Generates en.md and es.md if missing (won't overwrite unless --force)
 * - Preserves YAML front matter (date, cover). Translates title/description via provider.
 * - Provider: local (default, copy), or OpenAI if OPENAI_API_KEY is set.
 * - Adds metadata: auto_translated: true, source_hash: <sha1>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const contentDir = path.join(root, 'content', 'blog');

// Load local .env if present (simple parser; keeps existing env values)
async function loadDotEnv() {
  try {
    const p = path.join(root, '.env');
    const raw = await fs.readFile(p, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const k = m[1];
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {}
}

await loadDotEnv();

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const ONLY = Array.from(args).find(a => !a.startsWith('--')) || '';

function hash(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function parseFrontMatter(src) {
  const normalized = src.replace(/\r\n?/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, src];
  const body = normalized.slice(m[0].length);
  const yaml = m[1];
  const meta = {};
  yaml.split(/\r?\n/).forEach(line => {
    const mm = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (mm) {
      const key = mm[1].trim();
      let val = mm[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  });
  return [meta, body];
}

function buildFrontMatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') continue;
    const needsQuote = /[:#\-?*&!|>'"%@`{}[\],]/.test(String(v));
    lines.push(`${k}: ${needsQuote ? JSON.stringify(v) : v}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function getProvider() {
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'local';
}

async function translateWithDeepSeek(text, target) {
  const key = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const url = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/?$/, '') + '/chat/completions';
  const sys = `You are a professional technical translator. Translate Chinese to ${target}.
Preserve Markdown structure exactly: headings, lists, code blocks, links, images, math ($...$), tables.
Do not translate code or URLs. Keep inline formatting. Do not add extra commentary.`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text }
      ]
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`DeepSeek translate failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  const out = json.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('DeepSeek returned empty');
  return out;
}

async function translateWithOpenAI(text, target) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const url = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const sys = `You are a professional technical translator. Translate Chinese to ${target}.
Preserve Markdown structure exactly: headings, lists, code blocks, links, images, math ($...$), tables.
Do not translate code or URLs. Keep inline formatting. Do not add extra commentary.`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text }
      ]
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`OpenAI translate failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  const out = json.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('OpenAI returned empty');
  return out;
}

async function translateText(text, target) {
  const provider = getProvider();
  if (provider === 'deepseek') {
    try { return await translateWithDeepSeek(text, target); } catch (e) {
      console.warn(`[translate] DeepSeek error (${target}):`, e.message);
    }
  } else if (provider === 'openai') {
    try { return await translateWithOpenAI(text, target); } catch (e) {
      console.warn(`[translate] OpenAI error (${target}):`, e.message);
    }
  }
  // Fallback: copy text for manual post-editing
  return text;
}

async function translateMeta(metaZh, target) {
  const out = { ...metaZh };
  if (metaZh.title) {
    out.title = await translateText(metaZh.title, target);
  }
  if (metaZh.description) {
    out.description = await translateText(metaZh.description, target);
  }
  return out;
}

async function processPostDir(dir) {
  const slug = path.basename(dir);
  const zhPath = path.join(dir, 'zh.md');
  let rawZh;
  try { rawZh = await fs.readFile(zhPath, 'utf8'); } catch { return; }
  const sourceHash = hash(rawZh);
  const [metaZh, bodyZh] = parseFrontMatter(rawZh);
  // Skip drafts
  if (/^(true|1)$/i.test(String(metaZh.draft || '').trim())) return;

  for (const L of ['en', 'es']) {
    const outPath = path.join(dir, `${L}.md`);
    let exists = false; let rawOut = '';
    try { rawOut = await fs.readFile(outPath, 'utf8'); exists = true; } catch {}
    if (exists && !FORCE) {
      // Respect manual edits; update only auto-generated files when source changed
      const [mOut] = parseFrontMatter(rawOut);
      if (!mOut.auto_translated) {
        // Manual translation detected; do not overwrite
        continue;
      }
      if (mOut.source_hash === sourceHash) {
        // Already up to date
        continue;
      }
      // else fall through to regenerate auto translation
    }
    // Build translated front matter
    const metaOut = await translateMeta(metaZh, L === 'en' ? 'English' : 'Spanish');
    metaOut.auto_translated = true;
    metaOut.source_hash = sourceHash;
    // Do not change date/cover if present
    metaOut.date = metaZh.date;
    metaOut.cover = metaZh.cover;
    const fm = buildFrontMatter(metaOut);
    // Translate body preserving markdown
    const bodyOut = await translateText(bodyZh, L === 'en' ? 'English' : 'Spanish');
    const final = fm + bodyOut.trimStart() + (bodyOut.endsWith('\n') ? '' : '\n');
    await fs.writeFile(outPath, final, 'utf8');
    console.log(`Wrote ${path.relative(root, outPath)}${exists ? ' (overwrote)' : ''}`);
  }
}

async function main() {
  const entries = await fs.readdir(contentDir).catch(() => []);
  for (const name of entries) {
    const p = path.join(contentDir, name);
    const st = await fs.stat(p).catch(() => null);
    if (!st?.isDirectory()) continue;
    if (ONLY && name !== ONLY) continue;
    await processPostDir(p);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
