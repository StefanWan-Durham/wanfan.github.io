#!/usr/bin/env node
/*
  Simple trilingual translation helper.
  - Input: a JSON file with { zh: string } fields or an array of { zh: string, en?: string, es?: string }
  - Output: fill missing en/es using a local dictionary + minimal heuristics.
  NOTE: This is a lightweight scaffold designed to keep your repo self-contained.
  For production-quality, plug in your preferred translation API and keep post-editing.
*/
import fs from 'fs/promises';
import path from 'path';

const DICT = Object.freeze({
  // Common UI
  '学术快报': { en: 'ScholarPush', es: 'ImpulsoAcadémico' },
  '每日精选论文推荐': { en: 'Daily AI Paper Recommender', es: 'Recomendador Diario de Artículos IA' },
  '概览（5 分钟）': { en: 'Overview (5 min)', es: 'Resumen (5 min)' },
  '必读（15 分钟）': { en: 'Must Read (15 min)', es: 'Lectura obligatoria (15 min)' },
  '扩展阅读（10 分钟）': { en: 'Nice to Read (10 min)', es: 'Lectura ampliada (10 min)' },
  '主题深读': { en: 'Deep Dive', es: 'Análisis en profundidad' },
  '总条目': { en: 'Total items', es: 'Total' },
  '含代码': { en: 'With code', es: 'Con código' },
  '新基准/数据': { en: 'New benchmarks/data', es: 'Nuevos benchmarks/datos' },
  'Top 任务': { en: 'Top tasks', es: 'Tareas destacadas' },
});

function translateLine(zh) {
  if (!zh) return { en: '', es: '' };
  const hit = DICT[zh.trim()];
  if (hit) return { en: hit.en, es: hit.es };
  // Heuristic: copy as fallback if unknown (so you can post-edit later)
  return { en: zh, es: zh };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node tools/translate.mjs <input.json>');
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), file);
  const raw = await fs.readFile(abs, 'utf-8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { console.error('Invalid JSON'); process.exit(1); }

  function fill(obj){
    if (typeof obj === 'string') return obj;
    if (obj && typeof obj === 'object' && 'zh' in obj) {
      const { en, es } = translateLine(obj.zh);
      if (!obj.en) obj.en = en;
      if (!obj.es) obj.es = es;
      return obj;
    }
    return obj;
  }

  if (Array.isArray(data)) {
    data = data.map(x => fill(x));
  } else if (data && typeof data === 'object') {
    Object.keys(data).forEach(k => { data[k] = fill(data[k]); });
  }

  await fs.writeFile(abs, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log('Translated (filled where missing):', file);
}

main().catch(e => { console.error(e); process.exit(1); });
