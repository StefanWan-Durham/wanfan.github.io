# -*- coding: utf-8 -*-
import os, re, json, hashlib, subprocess, feedparser, requests
from datetime import datetime, timezone
from dateutil import parser as dtp
from markdown2 import markdown as md2html
from bs4 import BeautifulSoup as BS
from ai_llm import chat_once

# ===== 基础路径 =====
SITE_BASE = ""  # 如你用子路径，可以填 "/wanfan.github.io"
BLOG_DIR = "blog"
DATA_DIR = "data/ai/blog"
OG_DIR = "assets/og"
TPL_PATH = "tools/templates/blog_post_template.html"
os.makedirs(BLOG_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(OG_DIR, exist_ok=True)

# ===== 数据源（先走RSS，稳）=====
SOURCES = [
  "https://export.arxiv.org/rss/cs.AI",
  "https://export.arxiv.org/rss/cs.CL",
  "https://export.arxiv.org/rss/cs.LG",
  "https://export.arxiv.org/rss/cs.CV",
  "https://openai.com/blog/rss.xml",
  "https://www.anthropic.com/news/rss.xml",
  "https://ai.googleblog.com/atom.xml",
  "https://huggingface.co/blog/feed.xml",
]

def fetch_items(limit_per_feed=25):
    items = []
    for url in SOURCES:
        try:
            feed = feedparser.parse(url)
            for e in feed.entries[:limit_per_feed]:
                title = (e.get("title") or "").strip()
                link = e.get("link") or ""
                published = e.get("published") or e.get("updated") or ""
                ts = dtp.parse(published).astimezone(timezone.utc).isoformat() if published else datetime.now(timezone.utc).isoformat()
                summary = (e.get("summary") or "")
                summary = re.sub("<.*?>", "", summary)[:1200]  # 去HTML
                items.append({"title":title, "url":link, "ts":ts, "summary":summary})
        except Exception:
            pass
    # 去重
    seen=set(); uniq=[]
    for it in items:
        h = hashlib.md5((it["title"]+it["url"]).encode("utf-8")).hexdigest()
        if h not in seen: seen.add(h); uniq.append(it)
    return uniq

# ===== 选题与成文 =====
SYS = "You are a senior AI editor. Write publishable blog posts. No chain-of-thought."
# Use sentinel placeholders to avoid Python str.format conflicts with braces
PROMPT = """
Given today's AI updates (title|url|ts + brief), create a DAILY blog post in Chinese with structure:
- title_zh: concise, 18-28 Chinese characters, no punctuation at end.
- description_zh: 60-120 chars summary for SEO/OG.
- tags: 3-5 short tags (e.g., LLM,RAG,Agent,CV,Infra).
- toc: an ordered list of section titles (3-6 items).
- sections: array of {"heading": string, "markdown": string} where `markdown` is ~150-250 words in Chinese for each section.
- refs: 6-12 items of {"title": string, "url": string} (must be real sources from the given entries).
- en_teaser: 1-2 sentences in English (for cross-post).
- es_teaser: 1-2 oraciones en español.

Rules:
- Prefer 3-5 key items across LLM/Agent/RAG/CV, focusing on significance and impact; avoid rumors.
- Attribute facts to sources; include URLs in refs only (no footnotes inline).
- Avoid direct quotes > 25 words. Summarize in your own words.
- Keep total Chinese body within [[MAX_WORDS]] characters roughly.
- Output JSON ONLY with the fields above.

Entries:
[[ENTRIES]]
"""

def _extract_json_from_text(text: str):
    t = (text or "").strip()
    # Try fenced code block first
    try:
        import re
        m = re.search(r"```(?:json)?\s*(.*?)```", t, re.DOTALL | re.IGNORECASE)
        if m:
            return json.loads(m.group(1).strip())
    except Exception:
        pass
    # Then try raw JSON slice
    try:
        first = t.find('{')
        last = t.rfind('}')
        if first != -1 and last != -1 and last > first:
            return json.loads(t[first:last+1])
    except Exception:
        pass
    # Finally try direct
    return json.loads(t)

def pick_and_write(entries, max_words=1100):
    joined = "\n".join([f"- {it['title']} | {it['url']} | {it['ts']}\n  {it['summary']}" for it in entries])
    prompt = PROMPT.replace("[[ENTRIES]]", joined).replace("[[MAX_WORDS]]", str(max_words))
    out = chat_once(prompt, system=SYS, temperature=0.25)
    j = _extract_json_from_text(out)
    return j

# ===== HTML 拼装 =====
def load_tpl():
    with open(TPL_PATH, "r", encoding="utf-8") as f:
        return f.read()

def to_slug(s):
    s = re.sub(r"[^\w\u4e00-\u9fff\- ]+", "", s)
    s = s.strip().replace(" ", "-")
    return s[:60]

def gen_toc_html(toc):
    items = []
    for i, t in enumerate(toc, 1):
        aid = f"sec-{i}"
        items.append(f'<li><a href="#{aid}">{BS(t, "html.parser").text}</a></li>')
    return "\n".join(items)

def sections_to_html(sections):
    parts=[]
    for i, sec in enumerate(sections, 1):
        hid = f"sec-{i}"
        heading = BS(sec["heading"], "html.parser").text
        # markdown → HTML
        html = md2html(sec["markdown"], extras=["fenced-code-blocks","tables","strike"])
        parts.append(f'<h2 id="{hid}">{heading}</h2>\n{html}')
    return "\n".join(parts)

# ===== OG 图（SVG→PNG）=====
def make_og(title, date_str, outfile_png):
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#0f172a"/>
  <text x="60" y="200" font-size="72" fill="#e2e8f0" font-family="system-ui,Segoe UI,Roboto,sans-serif">AI Daily · {date_str}</text>
  <foreignObject x="60" y="260" width="1080" height="320">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#94a3b8;font-size:44px;line-height:1.25;font-family:system-ui,Segoe UI,Roboto,sans-serif;">{BS(title,'html.parser').text}</div>
  </foreignObject>
</svg>"""
    tmp_svg = outfile_png.replace(".png",".svg")
    with open(tmp_svg,"w",encoding="utf-8") as f: f.write(svg)
    # 需要 librsvg2-bin: rsvg-convert (provided in CI)
    subprocess.run(["rsvg-convert","-w","1200","-h","630","-o",outfile_png,tmp_svg], check=True)

# ===== 索引 & RSS =====
def update_index(meta):
    idx_path = os.path.join(DATA_DIR, "index.json")
    idx = []
    if os.path.exists(idx_path):
        with open(idx_path,"r",encoding="utf-8") as f:
            try: idx = json.load(f)
            except: idx = []
    # 去重 by slug
    idx = [x for x in idx if x.get("slug") != meta["slug"]]
    idx.insert(0, meta)
    idx = idx[:90]  # 保留最近90篇
    with open(idx_path,"w",encoding="utf-8") as f: json.dump(idx,f,ensure_ascii=False,indent=2)
    return idx

def write_rss(index):
    # 极简 RSS；如要并入你原站点RSS，我们可再合并
    items=[]
    for it in index[:30]:
        items.append(f"""
  <item>
    <title>{it["title"]}</title>
    <link>{it["url"]}</link>
    <description><![CDATA[{it["description"]}]]></description>
    <pubDate>{it["published_rfc2822"]}</pubDate>
  </item>""")
    xml=f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>AI Daily · Fan Wan</title>
  <link>{SITE_BASE or ''}/data/ai/blog/rss.xml</link>
  <description>每日 AI 要闻与解读</description>
  {''.join(items)}
</channel></rss>"""
    with open(os.path.join(DATA_DIR,"rss.xml"),"w",encoding="utf-8") as f: f.write(xml)

# ===== Buttondown（选填，创建草稿）=====
def push_buttondown(meta, html):
    api = os.getenv("BUTTONDOWN_API_KEY")
    if not api: return
    status = os.getenv("BUTTONDOWN_STATUS","draft")
    try:
        r = requests.post(
            "https://api.buttondown.email/v1/emails",
            headers={"Authorization": f"Token {api}"},
            json={
              "subject": meta["title"],
              "body": html,
              "status": status
            },
            timeout=60
        )
        r.raise_for_status()
    except Exception as e:
        print("Buttondown failed:", e)

def main():
    # 1) 抓取
    entries = fetch_items()
    min_items = int(os.getenv("MIN_ITEMS","6"))
    if len(entries) < min_items:
        print("Not enough entries today; skip.")
        return

    # 2) 选题 & 成文
    max_words = int(os.getenv("MAX_WORDS","1100"))
    j = pick_and_write(entries, max_words=max_words)

    # 3) 组织元数据
    now = datetime.now(timezone.utc)
    ymd = now.strftime("%Y-%m-%d")
    title = j["title_zh"]
    slug = f"{ymd}-ai-daily-{to_slug(title)}"
    url = f"{SITE_BASE}/blog/{slug}.html" if SITE_BASE else f"/blog/{slug}.html"
    desc = j["description_zh"][:180]
    tags = ", ".join(j.get("tags",[]))
    date_str = now.astimezone().strftime("%Y-%m-%d")
    pub_iso = now.isoformat()
    pub_rfc = now.strftime("%a, %d %b %Y %H:%M:%S %z")

    # 4) 内容→HTML
    toc_html = gen_toc_html(j["toc"])
    content_html = sections_to_html(j["sections"])
    refs_html = "\n".join([f'<li><a href="{r["url"]}" target="_blank" rel="noopener">{BS(r["title"],"html.parser").text}</a></li>' for r in j["refs"]])

    # 5) OG 分享图
    og_png = os.path.join(OG_DIR, f"{slug}.png")
    make_og(title, date_str, og_png)
    og_url = f"{SITE_BASE}/{og_png}" if SITE_BASE else f"/{og_png}"

    # 6) 渲染模板
    with open(TPL_PATH,"r",encoding="utf-8") as f: tpl = f.read()
    html = (tpl
      .replace("{{TITLE}}", title)
      .replace("{{DESCRIPTION}}", desc)
      .replace("{{CANONICAL}}", url)
      .replace("{{OG_IMAGE}}", og_url)
      .replace("{{PUBLISHED}}", pub_iso)
      .replace("{{DATE_STR}}", date_str)
      .replace("{{READING_MIN}}", str(max(3, int(max_words/350))))
      .replace("{{TAGS}}", tags)
      .replace("{{TOC}}", toc_html)
      .replace("{{CONTENT_HTML}}", content_html)
      .replace("{{REFS}}", refs_html)
    )

    # 7) 写入文件
    out_path = os.path.join(BLOG_DIR, f"{slug}.html")
    with open(out_path,"w",encoding="utf-8") as f: f.write(html)

    # 8) 更新索引 & RSS
    meta = {
      "title": title,
      "slug": slug,
      "url": url,
      "description": desc,
      "og_image": og_url,
      "published": pub_iso,
      "published_rfc2822": pub_rfc,
      "tags": j.get("tags",[])
    }
    idx = update_index(meta)
    write_rss(idx)

    # 9)（可选）发 Buttondown 草稿
    push_buttondown(meta, html)

    print("Done:", out_path)

if __name__ == "__main__":
    main()
