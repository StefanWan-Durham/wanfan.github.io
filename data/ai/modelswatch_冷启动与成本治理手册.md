# Model Watch 冷启动与成本治理操作手册

> 创建日期：2025-09-21  
> 适用范围：`modelswatch` 摘要与热榜流水线首次全量构建（冷启动）与后续稳态增量阶段的运维与成本控制。

---
## 1. 目标
- 冷启动阶段：不设限流，最大化一次性获取完整高质量三语摘要基线。
- 稳态阶段：通过限流参数控制新增 LLM 调用量，保障成本可预测。
- 提供重置（reset）后再冷启动再进入稳态的重复闭环。

---
## 2. 阶段划分
| 阶段 | 标志 | 行为 | 退出条件 |
|------|------|------|----------|
| 冷启动 | 无标记文件且 `COLD_START_DONE` 未显式 1 | 全量生成（忽略限流） | 运行成功并写入标记文件（自动或人工） |
| 稳态 | 标记文件存在 或 `COLD_START_DONE=1` | 启用限流策略 | 重置后删除标记重新进入冷启动 |

标记文件默认：`data/ai/modelswatch/cold_start_done.json`

---
## 3. 关键脚本与组件
| 名称 | 作用 |
|------|------|
| `generate_snapshot_summaries.mjs` | 组装候选、限流、冷启动判定、批量调用 Python |
| `summarize_multi.mjs` | JS → Python 适配层（保留旧接口兼容） |
| `tools/tri_summarizer.py` | Python 主体：JSON-first 批量三语摘要 + 缓存 + 可选 rewrite/expand |
| `reset_modelswatch.mjs` | 重置所有历史产物（snapshots / 缓存 / 热榜 / 诊断） |

---
## 4. 环境变量分组
### 冷启动 / 标记
| 变量 | 用途 |
|------|------|
| `COLD_START_MARK_FILE` | 标记文件路径（可自定义） |
| `AUTO_WRITE_COLD_START_MARK=1` | 冷启动成功后自动落盘标记 |
| `COLD_START_DONE=1` | 人工强制视为已完成冷启动 |

### 限流与优先级
| 变量 | 含义 |
|------|------|
| `SNAPSHOT_MAX_NEW` | 本轮最多允许新增生成的摘要条数 |
| `SNAPSHOT_MIN_PER_SOURCE` | 每个来源(hf/github)保证最少生成数 |
| `SNAPSHOT_PRIORITY_FIELDS` | 逗号分隔用于排序的字段（例：`tier,recency,mentions`） |
| `SNAPSHOT_LIMIT_MODE` | `priority`（按排序截断）或 `random`（随机抽样） |

### 批处理 / 质量
| 变量 | 说明 |
|------|------|
| `USE_PYTHON_SUMMARIZER=1` | 启用 Python 主路径 |
| `SNAPSHOT_USE_BATCH=1` | 开启批处理模式 |
| `TRI_JSON_FIRST=1` | 三语一次性返回优先 |
| `UNIFIED_JSON_NO_SEQ=1` | 禁止失败后逐语言顺序补偿（速度优先） |
| `TRI_BATCH_CONCURRENCY` | Fallback 顺序阶段并行度（默认 3~5） |
| `TRI_ENABLE_REWRITE` | 开启 rewrite 质量增强 |
| `TRI_ENABLE_EXPAND` | 开启扩展补充信息 |
| `SPEED_MODE=1` | 关闭 rewrite/expand，最低 tokens 模式 |
| `BATCH_PROGRESS_INTERVAL` | Python 批处理进度输出间隔（条数） |

### 重置
| 变量 | 用途 |
|------|------|
| `RESET_MODELWATCH_ALL=1` | 触发全量重置脚本 |
| `RESET_MODELWATCH_CONFIRM=YES` | 可选二次确认（按实现） |

---
## 5. 冷启动标准操作流程（SOP）
1. 在 workflow vars 设置：`RESET_MODELWATCH_ALL=1`（与确认变量），`AUTO_WRITE_COLD_START_MARK=1`。
2. 不配置任何 `SNAPSHOT_MAX_NEW / SNAPSHOT_MIN_PER_SOURCE / SNAPSHOT_PRIORITY_FIELDS` 变量。
3. 运行 workflow，观察日志：
   - Python 批处理首行应输出 batch-start header。
   - 中途出现进度行：`Processed X / Total Y`。
4. 结束后仓库应新增：`data/ai/modelswatch/cold_start_done.json`。
5. 验证：`summaries_diagnostics.json` 中 `cold_start_done=false`（首次运行），第二次再跑显示 `cold_start_done=true`。

---
## 6. 进入稳态
1. 移除 `RESET_MODELWATCH_ALL`；保留或删除 `AUTO_WRITE_COLD_START_MARK` 均可。
2. 新增限流变量（示例）：
   - `SNAPSHOT_MAX_NEW=60`
   - `SNAPSHOT_MIN_PER_SOURCE=1`
   - `SNAPSHOT_PRIORITY_FIELDS=tier,recency,mentions`
   - `SNAPSHOT_LIMIT_MODE=priority`
3. 再次运行：诊断文件中应出现 `skipped_due_to_limit > 0`（若 backlog 存在）。

---
## 7. 参数调优建议
| 现象 | 调优方向 |
|------|----------|
| backlog 始终很大 | 临时提高 `SNAPSHOT_MAX_NEW`（100~150） |
| 生成速度太慢 | 开启 `SPEED_MODE=1` 或设置 `UNIFIED_JSON_NO_SEQ=1` |
| 摘要质量欠佳 | 关闭 `SPEED_MODE`，启用 rewrite/expand |
| 高频任务占满额度 | 增强 `SNAPSHOT_PRIORITY_FIELDS` 加入多样性字段（如 recency） |
| 长尾条目迟迟不生成 | 临时切换 `SNAPSHOT_LIMIT_MODE=random` |

---
## 8. 诊断字段解读
| 字段 | 说明 | 用途 |
|------|------|------|
| `generated` | 新生成条目数 | 当期调用量估算 |
| `reused` | 缓存复用条目数 | 缓存命中率评估 |
| `original_to_generate` | 限流前理论待生成 | backlog 规模 |
| `skipped_due_to_limit` | 被限流跳过条目 | 限流强度反馈 |
| `cold_start_done` | 是否处于稳态 | 判断是否应启用限流 |

---
## 9. 重置流程（再次冷启动）
1. 设置：`RESET_MODELWATCH_ALL=1` +（可选）`RESET_MODELWATCH_CONFIRM=YES`。
2. 删除或让脚本清理 `cold_start_done.json`。
3. 重新执行“冷启动 SOP”。

---
## 10. 故障与恢复
| 问题 | 可能原因 | 处理 |
|------|----------|------|
| 冷启动未写标记 | 运行中断 / 权限问题 | 手动创建标记或重新跑一次 |
| 标记存在但想全量 | 删除标记文件 + unset `COLD_START_DONE` |
| 生成极少 | 限流参数过小 | 增大 `SNAPSHOT_MAX_NEW` |
| 日志无进度行 | 未启用批处理或 `BATCH_PROGRESS_INTERVAL` 太大 | 确认 `SNAPSHOT_USE_BATCH=1` |

---
## 11. 后续增强（规划）
- backlog aging + 动态优先级加权。
- `pending_summaries.json`：记录被跳过条目做审计与定向补偿。
- Token / 成本估算写入诊断（按来源拆分）。
- 失败摘要回退重试队列（avoid permanent skip）。

---
## 12. 快速核对 Checklist
- [ ] 标记文件存在（稳态）或不存在（冷启动意图清晰）。
- [ ] `generated + reused == 总候选`（冷启动）或 + skipped 匹配（稳态）。
- [ ] 缓存命中率逐步上升（长期 >70% 理想）。
- [ ] 限流参数与 backlog 规模匹配（无无限积压）。

---
## 13. 附：典型变量组合示例
### 冷启动
```
RESET_MODELWATCH_ALL=1
AUTO_WRITE_COLD_START_MARK=1
# 不设置 SNAPSHOT_MAX_* 等限流
```

### 稳态（性能均衡）
```
SNAPSHOT_MAX_NEW=60
SNAPSHOT_MIN_PER_SOURCE=1
SNAPSHOT_PRIORITY_FIELDS=tier,recency,mentions
SNAPSHOT_LIMIT_MODE=priority
SNAPSHOT_USE_BATCH=1
TRI_JSON_FIRST=1
SPEED_MODE=0
```

### 成本极致（牺牲质量）
```
SNAPSHOT_MAX_NEW=30
SPEED_MODE=1
UNIFIED_JSON_NO_SEQ=1
TRI_ENABLE_REWRITE=0
TRI_ENABLE_EXPAND=0
```

---
如需将本手册合并进主 README 或生成英文版本，请提出需求。
