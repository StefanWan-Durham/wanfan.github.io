# 博客写作与发布攻略（长期可用）

面向本仓库的写作工作流与规范说明。按本文操作，你只需专注写 Markdown，推送到 main 分支后即自动生成并发布 HTML 页面与封面图。

---

## 一、快速上手（3 步）
1. 新建目录：`content/blog/<slug>`（例如：`my-second-post`，建议全小写、用连字符）。
2. 在该目录内至少创建 `zh.md`（可选 `en.md`、`es.md`），参考下文模板填写 Front Matter 与正文。
3. 提交到 main 分支，等待 GitHub Actions 自动生成：
   - 文章页：`blog/<slug>.html`、`blog/<slug>.en.html`、`blog/<slug>.es.html`
   - 博客索引自动更新：`blog.html`
   - 封面图自动生成：`assets/blog/<slug>-<lang>.png`（若无法生成则写同名 `.svg`）

发布后，浏览器请强制刷新一次（Shift+刷新）以避免 Service Worker 缓存旧页面。

---

## 二、目录与命名规范
- 文章目录：`content/blog/<slug>/`
  - `<slug>` 仅用小写字母、数字、连字符（示例：`future-of-rag-2025-kblam`）。
- 语言文件：至少中文 `zh.md`；可选英文 `en.md`、西语 `es.md`。
- 输出路径：
  - 中文：`blog/<slug>.html`
  - 英文：`blog/<slug>.en.html`
  - 西语：`blog/<slug>.es.html`

---

## 三、Markdown 模板（Front Matter 示例）
在 `content/blog/<slug>/zh.md` 中：

```markdown
---
title: 新文章示例：我的第二篇博客
description: 这是一篇示例文章，用于验证 Markdown 到 HTML 的自动生成与封面渲染。
date: 2025-09-05
# 发布控制：true=草稿（不会发布与索引）、false=发布
draft: false
# 封面（可选，三种写法三选一）
# 1) 不写：自动使用生成封面（PNG/SVG），否则占位图
# 2) 站内相对路径（会校验存在性）：
# cover: assets/blog/my-second-post-zh.png
# 3) 绝对 URL（直接使用）：
# cover: https://example.com/cover.png
---

## 写在前面
正文内容……
```

英文/西语的 `en.md` / `es.md` 用相同字段；各语种可分别设置 `title/description/date/draft/cover`。

字段说明：
- `title`：文章标题（用于页面标题与索引卡片）。
- `description`：摘要（用于 meta 与索引卡片）。
- `date`：`YYYY-MM-DD`（仅做字符串比较，越新越靠前）。
- `draft`：`true/false`；为 `true` 时跳过生成与索引。
- `cover`：
  - 绝对 URL：直接使用。
  - 站内路径：会先检查文件是否存在；不存在则回退到“生成 PNG → 生成 SVG → 占位图”。
  - 未指定：同样按“PNG → SVG → 占位图”自动回退。

---

## 四、封面图策略（自动/手动）
- 自动（推荐省心）：
  - 脚本基于模板自动生成 1200×630 PNG（若环境限制则生成同名 SVG）。
  - 文章页与索引会优先使用对应语言的 PNG；缺失则使用 SVG；仍缺失则使用 `assets/placeholder.jpg`。
- 手动：
  - 在 Front Matter 设置 `cover`：
    - 站内路径：`assets/blog/<slug>-<lang>.png`（建议 1200×630）
    - 或绝对 URL。

---

## 五、Markdown → HTML 对照表（本站渲染）
已支持：
- 标题：
  - `#` → `<h1>`，`##` → `<h2>`，… 到 `######` → `<h6>`（自动生成锚点 id）
- 段落：空行分隔 → `<p>`
- 无序列表：`-` / `*` 开头 → `<ul><li>`
- 有序列表：`1.`、`2.` → `<ol><li>`
- 引用：`> 引用内容` → `<blockquote>`
- 代码块（语法高亮）：
  - 三反引号围住，行首可写语言：```js / ```python / ```bash 等 → `<pre><code class="language-…">`（Highlight.js 渲染）
- 行内代码：`` `code` `` → `<code>`
- 链接：`[文本](URL)` → `<a href="…" target="_blank" rel="noopener">`
- 分隔线：独立一行 `---` → `<hr>`
- 粗体/斜体：
  - `**粗体**` 或 `__粗体__` → `<b>`
  - `*斜体*` 或 `_斜体_` → `<i>`
- 数学公式（KaTeX 自动渲染）：
  - 行内：`$ a^2 + b^2 = c^2 $`
  - 块级：
    ```
    $$
    e^{i\pi} + 1 = 0
    $$
    ```
- 图片：`![alt](path-or-url)` 支持相对路径（相对于 `content/blog/<slug>/`，发布后自动改为页面可访问路径）与绝对 URL。
- 表格：GitHub 风格表格（表头+`|---|` 分隔+数据行）自动渲染为 `<table>`。

注：原生 HTML 片段不建议直接内嵌，以免破坏页面结构；如确有需要，先在本地预览验证。

---

## 六、自动发布流程（CI/CD）
- 推送到 `main` 后，GitHub Actions 自动执行：
  1) 生成或更新封面图（PNG 或 SVG）
  2) 生成多语言文章 HTML
  3) 按日期倒序更新 `blog.html` 索引卡片（跳过草稿）
- 首次打开或更新后，请用 Shift+刷新 强制刷新页面以绕过 Service Worker 缓存。

---

## 七、本地预览（可选）
你已安装 Node v20（推荐）。在仓库根目录：

```bash
npm i
npm run site:build
```

说明：
- 若本机无法启动 Puppeteer，无妨；会写入同名 `.svg` 封面，文章页会自动回退显示 SVG 或占位图。
- 构建完成后，用浏览器直接打开 `blog/<slug>.html` 进行检查。

---

## 八、排序与草稿
- 排序依据：语言文件中的 `date`（字符串比较，格式须为 `YYYY-MM-DD`）。
- 草稿：任一语言文件 `draft: true` 时，该语言不会生成页面；索引也会跳过该文章（仅当所有语言都为草稿时完全不可见）。

---

## 九、多语言与索引行为
- 至少有 `zh.md`；`en.md` / `es.md` 可选。
- 索引卡片会尽量展示当前语言的 `title/description/date`，若缺失则回退到其他已存在语言。
- 索引卡片点击跳转会根据语言切换器调整链接（`data-href-zh/en/es`）。

---

## 十、常见问题（FAQ）
1) 封面不显示或 404？
- 无需手动上传。系统会按“Front Matter cover → 生成 PNG → 生成 SVG → 占位图”的顺序回退。
- 若写了站内路径，请确认文件存在于仓库对应位置。

2) 新文章未出现在博客列表？
- 确认 `draft: false` 且 `date` 合法（如 `2025-09-05`）。
- 等待 GitHub Actions 执行完成；必要时刷新缓存（Shift+刷新）。

3) 只有中文，英文/西语缺失可以吗？
- 可以。系统将仅生成已存在语言的页面；索引的标题与摘要会自动回退到可用语言内容。

4) 能否手动指定封面？
- 可以。`cover` 支持站内路径或绝对 URL。不存在时仍会自动回退到生成封面或占位图。

5) 本地构建失败（Puppeteer 相关）怎么办？
- 忽略即可。会写 `.svg` 封面，预览不受影响。线上 CI 仍会尝试生成 `.png`。

6) 修改了文章但页面没更新？
- 检查 CI 是否成功；刷新浏览器缓存；必要时稍后再看（静态资源可能有缓存）。

---

## 十一、最佳实践与建议
- slug 命名稳定且语义清晰，避免未来改动链接。
- `date` 保持规范；用于排序与读者心理预期。
- `description` 简洁明确，有助于 SEO 与索引卡片展示。
- 代码块标明语言（如 ` ```python`），便于高亮。
- 数学公式尽量用 KaTeX 语法，复杂表达式使用块级 `$$…$$`。
- 封面图如需手动制作，建议 1200×630，尽量简洁可读。

---

如需“正文内插图/表格/脚注/目录自动生成”等扩展，请告知你的优先级，我会在不破坏现有流程的前提下增强解析与样式。

---

## 十二、自动翻译（zh → en / es）

你可以只写中文 `zh.md`，系统会自动生成英文 `en.md` 与西语 `es.md`：

- 位置：`content/blog/<slug>/zh.md` → 输出同目录下 `en.md`、`es.md`
- 触发方式：
  - 本地：`npm run blog:translate`（或 `node scripts/translate-markdown.mjs <slug>`）
  - 线上 CI：`npm run site:build` 会自动先跑翻译再生成 HTML
- 覆盖策略（安全）：
  - 如果检测到 `en.md` / `es.md` 是手工维护（Front Matter 无 `auto_translated: true`），永不覆盖。
  - 如果是自动生成且 `source_hash` 与当前中文不一致，会自动更新。
  - 可用 `--force` 强制重写：`node scripts/translate-markdown.mjs <slug> --force`

翻译引擎（按优先级）：
1) DeepSeek（默认）
   - 环境变量：`DEEPSEEK_API_KEY`，`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com/v1`），`DEEPSEEK_MODEL`（默认 `deepseek-chat`）
2) OpenAI（若配置了 `OPENAI_API_KEY` 则作为备选）
3) 本地占位：若未配置任何 key，则“复制中文到英文/西语”，便于你后续人工校对

Front Matter 处理：
- 会翻译 `title`、`description`；保留 `date`、`cover`。
- 自动写入 `auto_translated: true` 与 `source_hash` 以追踪是否需要更新。

本地配置（只对你本机有效，已 gitignore）：
- 仓库根目录有 `.env` 文件，可填：
  - `DEEPSEEK_API_KEY=...`
  - `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1`
  - `DEEPSEEK_MODEL=deepseek-chat`
  不填也可构建，只是本地翻译会退化为“复制中文”。

CI 配置（已接好）：
- GitHub → Settings → Secrets and variables：
  - Secrets: `DEEPSEEK_API_KEY`
  - Variables: `DEEPSEEK_BASE_URL`，`DEEPSEEK_MODEL`
- 工作流 `.github/workflows/build-blog.yml` 已把上述变量注入 `npm run site:build`。

---

## 十三、三语切换机制（前端）

- 站点的语言偏好存储在 `localStorage.lang`，默认 `zh`，你也可以用户级通过右上角语言切换器更改。
- 页面中使用 `i18n` 块按语言展示/隐藏文案；博客页面也会输出 hreflang 与 alternate 链接：
  - 中文：`blog/<slug>.html`
  - 英文：`blog/<slug>.en.html`
  - 西语：`blog/<slug>.es.html`
- 博客列表 `blog.html` 的卡片，点击链接与缩略图会根据当前语言跳转；缺失语言会回退到已有语言。

---

## 十四、ScholarPush（学术快报）是什么、如何翻译

概念：
- ScholarPush 是“AI Studio”的一个模块（`lab/scholarpush.html`），面向研究者/开发者的“每日精选论文与要点”页面。
- 页面数据来自 JSON feed（`data/ai/scholarpush/index.json`），前端按这个 feed 渲染卡片与统计。

内容来源与生成：
- 抓取/聚合：可通过 RSS/Atom 源获取当天内容（详见下节 `sources.ai.json`）。
- 结构化摘要：仓库提供了 `tools/ai_blog_pipeline.py`，其内置 `PROMPT_SCHOLAR` 会把当日条目整理成结构化 JSON（含 headline、one_liner、tags、links、stats 等）。
- 语言：
  - 你可以先用中文生成 feed，再使用 `tools/translate.mjs` 对 JSON 中的中文字段（对象含 `zh` 时）进行 en/es 预填充（该工具基于词典/回退策略，以便你后期校对）。
  - 或者在生成时就让你的管道同时产出多语言字段。

博客页与学术快报联动：
- 若博客 slug 符合 `*-ai-daily-*`，生成器会优先采用 ScholarPush 的顺序与“返回学术快报”的导航（见 `scripts/generate-blog.mjs` 中对 `ai-daily` 的特殊处理）。

---

## 十五、sources.ai.json（数据源清单）如何使用与维护

文件：`tools/sources.ai.json`

用途：
- 以 JSON 方式集中管理“学术/AI 新闻/论文”的抓取来源（RSS/Atom 等），便于增删、审计与共享。

维护规范：
- 纯数组，每一项：`{ "name": "可读名称", "url": "订阅地址" }`
- 可以随时增删；提交到 main 后，CI 不会直接使用它生成页面，但它是你的抓取脚本的权威输入清单（建议你的采集脚本读取此文件）。

接入建议：
- 如你使用 `tools/ai_blog_pipeline.py`，可把其中的内置 `SOURCES` 替换为读取 `tools/sources.ai.json`（简例）：
  - Python 伪代码：
    1) `with open('tools/sources.ai.json','r',encoding='utf-8') as f: sources = [x['url'] for x in json.load(f)]`
    2) 迭代 `sources` 去抓取，每源设置合理的超时与去重
- 这样做的好处：数据源与代码解耦，维护成本更低。

---

## 十六、端到端流程总览（只写中文也能三语发布）

1) 你在 `content/blog/<slug>/zh.md` 编写中文文章并提交到 main。
2) CI 触发，运行：
   - 翻译：生成/更新 `en.md`、`es.md`（DeepSeek→OpenAI→复制中文的回退链）。
   - 生成 HTML：`blog/<slug>.html(.en/.es)`。
   - 生成/回退封面图：PNG→SVG→占位图。
   - 更新博客索引 `blog.html` 与 RSS。
3) 访问站点，右上角语言切换器可在中文/英文/西语间切换；缺失语言自动回退。

本地只要 `npm run site:build` 即可模拟上述流程；若未配置 API key，翻译会退化为复制中文，页面仍可用。