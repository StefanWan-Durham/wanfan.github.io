# Model Watch 模型实验场 & 工程热榜流水线说明

> 本文档系统性描述当前模型/工程热榜的数据来源、执行顺序、分类与打标签逻辑、评分策略、三语摘要、占位符与质量监控等，实现维护与二次扩展的技术基线。

更新时间：2025-09-20

---
## 1. 目标概述
- 自动采集 Hugging Face 模型与 GitHub 工程仓库的核心指标与近期增量。
- 构建两个视图：
  1. 模型热榜（按任务 task 分类）。
  2. 工程热榜（按工程能力/生态类别分类）。
- 增量三语（中/英/西）摘要生成，哈希缓存避免重复 LLM 调用。
- 自动补全分类标签（task_keys / category_key）；不足条数时插入占位符保证 UI 稳定。
- 输出覆盖率、完整性与健康度监控文件，提升可观测性与可回溯性。

---
## 2. 关键文件与目录
根：`data/ai/modelswatch/`

| 文件/目录 | 说明 |
|-----------|------|
| `corpus.hf.json` | Hugging Face 模型语料（items[]） |
| `corpus.github.json` | GitHub 项目语料 |
| `snapshots/YYYY-MM-DD/` | 每日快照：`hf.json` / `gh.json`（轻量统计映射）及 `hf_summaries.json` / `gh_summaries.json`（三语摘要增强） |
| `models_hotlist.json` | 模型热榜（by_category.task_key → 条目数组） |
| `projects_hotlist.json` | 工程热榜（by_category.category_key → 条目数组） |
| `weekly_summaries.json` | 周度聚合与任务分布 |
| `summary_cache.json` | 三语摘要缓存（hash → summaries） |
| `coverage_gaps.json` | 分类/任务桶是否低于最小展示数统计 |
| `classification_stats.json` | task_keys 覆盖统计（有无打标签） |
| `top_hf.json` / `top_github.json` | 最近抓取热门参考列表 |
| `task_aliases.json` | 任务别名（可选） |
| `project_categories.json` | 工程分类配置 |

上层：`data/ai/ai_categories.json`（任务分类树&多语言标签）。

缓存：`tools/.cache/modelswatch_tagging.jsonl`：LLM 分类缓存。

---
## 3. 工作流触发
- 周：`.github/workflows/modelswatch-weekly.yml`
- 日：`.github/workflows/modelswatch-daily.yml`

周流程相对全面（分类 + 热榜 + 覆盖 + 周摘要）；日流程偏增量与每日 picks。

---
## 4. 快照构建与合并
1. 抓取模型/项目基础数据 → 更新 `corpus.*.json`。
2. 生成每日快照：`snapshots/<day>/hf.json` & `gh.json`（只存 ID → 基础数值）。
3. 后续脚本（摘要、热榜）利用 corpus enrich（名称 / summary / tags）与快照（数值增量）。

日期键：`Asia/Shanghai` 时区，格式 `YYYY-MM-DD`。

---
## 5. 分类 / 打标签（模型侧任务）
脚本：`tools/modelswatch_tagging.py`

流程：
1. 载入 taxonomy：`ai_categories.json` → 生成 `labels_by_key` & `key_by_label_lower`。
2. 构建正则/同义词：
   - 任务官方 label（中/英/西）
   - 手工同义词（SYNONYMS）
   - Key 拆分（下划线/横杠）→ 组合 + acronym（≥3）
   - 中文特殊清洗（去括号内说明）
   - Diffusion 特例：txt2img / txt2video
3. deterministic 匹配：
   - 优先 tags 精确 label → 追加任务 key。
   - 再跑模式匹配（tokens / alias / 子串）。
4. 若仍为空 且 `--use-llm` 且存在 `DEEPSEEK_API_KEY`：
   - 构建 prompt（包含受限任务 key 列表 + item 文本拼接）。
   - 缓存 key = hash(prompt)。
   - 使用 DeepSeek Chat（解析 JSON 数组输出）。
5. 写回 `task_keys`。

稳健性：
- 缺少 `requests` 时优雅跳过 LLM（try/except）。
- 非 item 列表（如 dates.json 字符串数组）自动忽略。

> 工程项目分类不在此脚本内部完成，而是由热榜脚本内的启发式函数处理。

---
## 6. 工程项目分类（category_key）
脚本：`update_project_hotlist.mjs` 内部 `classifyRepo()`：
- 依据名称 / summary / tags 的正则匹配：framework_core / deployment_serving / optimization_compilers / data_tooling / agents_workflows / security_safety / mlops_monitoring / edge_embedded / ui_devex。
- 未命中回退首分类（后续可改为丢弃或新增 `unknown` 桶）。

---
## 7. 去重策略
- 在构造热榜前扫描已有 hotlist.by_category，收集 `existingIds`。
- 新一轮候选 pool 过滤掉已出现 id。
- 占位符 ID 统一 `__placeholder__:<task_or_cat>:<i>`，不与真实冲突。
- 模型热榜生成后尝试回填（backfill）已有条目缺失的 `task_keys`（基于新候选映射）。

---
## 8. 模型热榜分类匹配细节
脚本：`update_model_hotlist.mjs`
- 载入 `ai_categories.json` → 收集任务 key → 构造 aliasMap（手工别名 + 变体 + 多语言标签清洗 + 特例）。
- `categorizeModel()`：优先已有 `task_keys`；否则按 id/name/summary/description/tags 合并文本做多层包含 / 变体匹配（DEBUG 模式输出 `[HIT]` / `[MISS]`）。
- 过滤掉无分类候选，避免噪声污染热榜。

---
## 9. 工程热榜分类细节
脚本：`update_project_hotlist.mjs`
- 构造候选时已确定 `category_key`。
- 后续流程基本镜像模型热榜：计算 7 日增量、z-score、freshness、排序、LIMIT + MIN_SEED 追加、占位符补足。

---
## 10. 评分 (Scoring)
模型：
```
score_model = 0.6 * z(downloads_7d) + 0.3 * z(likes_7d) + 0.1 * freshness
freshness = exp(-Δdays / TAU)   # TAU 默认 30，可由 HOTLIST_FRESHNESS_TAU_DAYS 覆盖
```
工程：
```
score_engineering = 0.6 * z(stars_7d) + 0.2 * z(forks_7d) + 0.2 * freshness
```
Z 值：基于候选集合的均值/方差，方差近 0 时退化为 0 防止除零。

---
## 11. 追加与占位符策略
环境变量：
- 模型：`HOTLIST_LIMIT_PER_TASK`, `HOTLIST_MIN_SEED_PER_TASK`
- 工程：`HOTLIST_LIMIT_PER_CATEGORY`, `HOTLIST_MIN_SEED_PER_CATEGORY`

逻辑：
1. primary = pool 前 LIMIT 条。
2. 若 bucket < MIN_SEED：追加 extra（跳过已存在 id）。
3. 若 pool 为空仍不足：插入占位符（score=-1, flags.placeholder=true）。
4. UI 可过滤 / 灰显占位符。

---
## 12. 三语摘要生成
脚本：`generate_snapshot_summaries.mjs` + `summarize_multi.mjs`

流程：
1. 读取当天快照 + corpus items，筛出今日仍存在的条目（保证 stats 对应）。
2. 计算 item hash（字段拼接：id/name/source/desc/summary/tags/核心统计/更新时间）。
3. 若 cache 命中且三语齐全 → 复用；否则加入待生成列表。
4. 并发 (MAX_CONCURRENCY 默认 3) 调用 DeepSeek：输出 JSON `{summary_en, summary_zh, summary_es}`。
5. 失败或无 Key → 留空字段（完整性检查会告警）。
6. 写入：`hf_summaries.json` / `gh_summaries.json` + 更新 `summary_cache.json`。

特点：增量友好 / 易审计 / 可扩展语言。

---
## 13. 周度汇总
脚本：`generate_summaries.mjs`（在 weekly 流程调用）
- 汇总当周任务分布、生成 `weekly_summaries.json`。
- 若内容为空（生成失败或无有效数据）写入占位文本。

---
## 14. 质量与监控脚本
| 脚本 | 作用 | 关键输出 |
|------|------|----------|
| `summary_integrity_check.mjs` | 检查当天 tri-lingual completeness | GitHub Actions ::warning |
| `coverage_guard.mjs` | 检查各分类/任务是否 < MIN | `coverage_gaps.json` / 可选 fail |
| `classification_stats.mjs` | 统计 task_keys 覆盖率 | `classification_stats.json` |
| (可选) analyze_hotlist_coverage.mjs | 汇总热榜覆盖 | `coverage_summary.json` |

触发方式：weekly/daily workflow 末尾串行执行，保证生成产物后再检测。

---
## 15. 降级与稳健性
| 场景 | 当前行为 | 备注 |
|------|----------|------|
| 无 DeepSeek Key | 新摘要全部空 → integrity warning | 可后续改为跳过调用日志强调 |
| 无 requests | LLM 分类跳过（不崩溃） | 已包装 try/except |
| 缺失 coverage_summary.json | 工作流创建占位 JSON | 防止 git add 失败 |
| 分类命中率低 | 大量占位符出现 | 结合 classification_stats.json 诊断 |

---
## 16. 关键字段结构
模型热榜条目：
```jsonc
{
  "id": "org/model",
  "source": "hf",
  "name": "model",
  "url": "https://huggingface.co/org/model",
  "tags": ["..."],
  "stats": {
    "downloads_total": 0,
    "likes_total": 0,
    "downloads_7d": 0,
    "likes_7d": 0
  },
  "updated_at": "ISO",
  "added_at": "YYYY-MM-DD",
  "summary": "...",
  "flags": { "pinned": false, "hidden": false, "placeholder": true? },
  "score_model": 1.23,
  "task_keys": ["rag","text_to_image"]
}
```
工程热榜条目：
```jsonc
{
  "id": "owner/repo",
  "source": "github",
  "stats": {"stars_total":0,"forks_total":0,"stars_7d":0,"forks_7d":0},
  "score_engineering": 0.98,
  "category_key": "framework_core"
}
```

---
## 17. 健康度观测指标
| 指标 | 来源 | 价值 |
|------|------|------|
| pct_with_tasks | classification_stats.json | 分类覆盖趋势 |
| 占位符数量 | hotlists by_category | 数据稀疏 / 匹配质量 |
| tri-lingual incomplete 数 | summary_integrity warnings | 摘要生成异常定位 |
| generated vs reuse | snapshot-summaries 日志 | LLM 调用额度估算 |
| appended new entries | update_*_hotlist 日志 | 新鲜度 / 增长速度 |

---
## 18. 常见问题排查
| 症状 | 可能原因 | 处理 |
|------|----------|------|
| 全部摘要为空 | 无 API Key / 超时 | 配置 DEEPSEEK_API_KEY，检查 BASE_URL |
| pct_with_tasks=0 | tagging 未运行或崩溃 | 查看 `modelswatch_tagging.py` 输出 / requests 安装 |
| 大量占位符 | 匹配策略偏严 / 语料不足 | 增补 SYNONYMS / 启用 LLM / 调整池大小 |
| git add pathspec 失败 | 行续接错误 | 已修复，更新 workflow |

---
## 19. 可扩展方向
- Emerging (新星) 检测：高 z-score 新增实体单列。
- Unclassified bucket：保留未分类条目供人工回顾。
- Embedding + 最近邻匹配提高分类召回。
- 更精细的 freshness 衰减（非指数 → 分段线性）。
- 语言扩展：summary_de / summary_fr 增量兼容（扩展 summarize_multi.mjs）。
- 置信过滤：LLM 输出任务如不在 taxonomy 直接丢弃（已做）。

---
## 20. 执行链条总览
抓取 → 更新 corpus → 生成快照 → 分类打标签（deterministic + LLM 回退）→ 生成三语 snapshot summaries（hash 缓存）→ 构建模型 & 工程热榜（评分 + 占位符）→ 周度聚合 → 质量/完整性/覆盖度检测 → 提交仓库。

---
## 21. 维护建议
- 任务 / 工程分类修改后，建议触发一次全量回填脚本（可扩写：reclassify 模式）。
- 大规模 taxonomy 变更：清理 `summary_cache.json` 或按 hash 版本号策略迁移。
- 占位符长期存在的分类优先人工补样或放宽匹配策略。
- 定期（季度）评估 SYNONYMS 与实际热门关键词。

---
## 22. 版本与兼容
- SCHEMA_VERSION 来自 `schema.js`（未来若结构扩展可递增并在读取时迁移）。
- 缓存与热榜结构向后兼容：无关键字段时补默认值。

---
## 23. 快速核对清单（运维）
- [ ] DEEPSEEK_API_KEY 已配置；周任务中 generated > 0。
- [ ] classification_stats.pct_with_tasks > 70%（示例阈值，可调整）。
- [ ] coverage_gaps.json 中无 underfilled（或仅少量且预期）。
- [ ] 无连续两天摘要完整性告警。
- [ ] 占位符比例 < 10%。
- [ ] 热榜 appended 日志非 0（有新鲜流入）。

---
如需英文版、精简 README 版或新增“新星检测”实现，请提出下一步需求。