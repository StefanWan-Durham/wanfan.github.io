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

当前未支持（会按普通文本处理）：
- Markdown 图片语法：`![](…)`（正文插图尚未解析）
- Markdown 表格、原生 HTML 块

如需正文插图/表格等能力，可后续扩展解析器（告知需求优先级即可）。

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