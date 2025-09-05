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
SYS = (
        "You are a senior AI editor. Write publishable, objective Chinese posts. "
        "No chain-of-thought; avoid hype/marketing words; replace speculation with attributed phrasing."
)
# Two-step, stricter JSON output with plan + locked refs
PROMPT = r"""
You are an experienced AI news editor. Produce a DAILY Chinese blog post as STRICT JSON.
Do the job in TWO STEPS **inside one JSON**:

1) "plan": pick 3–5 key items ONLY from the given entries and define:
     - plan.toc: 3–6 section titles (Chinese).
     - plan.refs: an ordered list of {title,url} where every url MUST be from the entries.
     - plan.claims: 6–10 one-sentence factual bullets, each mapping to one or more ref indexes.

2) "draft": write the article body with these constraints:
     - title_zh: 18–28 Chinese characters, no punctuation at the end.
     - description_zh: 60–120 Chinese characters, objective and specific.
     - tags: 3–5 short tags, e.g. ["LLM","RAG","Agent"].
     - sections: array of {heading, markdown}, length = len(plan.toc).
         * Each section 150–250 Chinese characters.
         * End each section with bracketed reference indexes matching plan.refs, e.g. [1][3].
         * Do NOT introduce facts that are not supported by plan.refs.
     - en_teaser: 1–2 English sentences.
     - es_teaser: 1–2 oraciones en español.
     - Total Chinese body length ≈ [[MAX_WORDS]] characters (±15%).

Rules:
- Cite **only** from plan.refs; no extra sources, no speculation, no marketing language.
- Prefer cross-source corroborated items; avoid overlapping news.
- Avoid direct quotes > 25 words; rewrite in your words.
- Output JSON ONLY with keys: plan, title_zh, description_zh, tags, toc, sections, refs, en_teaser, es_teaser
    where:
    * toc == plan.toc
    * refs == plan.refs

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

# ===== Output post-processing helpers =====
def _urls_from_entries(entries):
    return { (it.get("url") or "").strip() for it in entries if it.get("url") }

def _sanitize_output(j, entries):
    allowed = _urls_from_entries(entries)
    plan = j.get("plan", {}) if isinstance(j, dict) else {}
    # 1) refs whitelist from entries
    raw_refs = plan.get("refs") or j.get("refs") or []
    clean_refs = []
    for r in raw_refs:
        if not isinstance(r, dict):
            continue
        url = (r.get("url") or "").strip()
        if url and url in allowed:
            clean_refs.append({"title": (r.get("title") or "").strip(), "url": url})
    if not clean_refs:
        raise ValueError("No valid refs in output.")
    j["refs"] = clean_refs

    # 2) toc alignment
    toc = plan.get("toc") or j.get("toc") or []
    j["toc"] = toc[:6]

    # 3) sections count matches toc
    sec = j.get("sections") or []
    j["sections"] = sec[:len(j["toc"])]
    return j

def _cn_len(s: str) -> int:
    return sum(2 if '\u4e00' <= c <= '\u9fff' else 1 for c in (s or ""))

def _trim_title(s: str) -> str:
    t = (s or "").strip(" ，。！？?!.:；;\n\t")
    # enforce ~18-28 CJK char length (rough)
    L = _cn_len(t)
    if L < 18 or L > 28:
        # simple hard cut without re-asking model
        t = t[:20]
    return t

def _compress_sections(j: dict, max_words: int):
    secs = j.get("sections") or []
    n = max(1, len(secs))
    per = int(max_words / n) + 40
    for s in secs:
        txt = s.get("markdown", "")
        while _cn_len(txt) > per and len(txt) > 10:
            txt = txt[:-10]
        s["markdown"] = txt

def _cap_ref_indexes(sections, ref_count: int):
    pat = re.compile(r"\[(\d+)\]")
    for s in sections:
        txt = s.get("markdown", "")
        def repl(m):
            idx = int(m.group(1))
            idx = min(max(idx, 1), max(ref_count, 1))
            return f"[{idx}]"
        s["markdown"] = pat.sub(repl, txt)

def pick_and_write(entries, max_words=1100):
    joined = "\n".join([f"- {it['title']} | {it['url']} | {it['ts']}\n  {it['summary']}" for it in entries])
    prompt = PROMPT.replace("[[ENTRIES]]", joined).replace("[[MAX_WORDS]]", str(max_words))
    out = chat_once(prompt, system=SYS, temperature=0.25)
    j = _extract_json_from_text(out)
    # sanitize and align with plan
    j = _sanitize_output(j, entries)
    # hard trims for title/sections length & cap ref indexes
    j["title_zh"] = _trim_title(j.get("title_zh", ""))
    _compress_sections(j, max_words)
    _cap_ref_indexes(j.get("sections", []), len(j.get("refs", [])))
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

def _link_ref_indexes(html: str, ref_count: int) -> str:
    try:
        return re.sub(r"\[(\d{1,2})\]", lambda m: f"<sup><a href=\"#ref-{min(max(int(m.group(1)),1), ref_count)}\">[{m.group(1)}]</a></sup>" if ref_count>0 else m.group(0), html)
    except Exception:
        return html

def sections_to_html(sections, ref_count: int = 0):
    parts=[]
    for i, sec in enumerate(sections, 1):
        hid = f"sec-{i}"
        heading = BS(sec["heading"], "html.parser").text
        # markdown → HTML
        html = md2html(sec["markdown"], extras=["fenced-code-blocks","tables","strike"])
        html = _link_ref_indexes(html, ref_count)
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
    content_html = sections_to_html(j["sections"], ref_count=len(j["refs"]))
    refs_html = "\n".join([f'<li id="ref-{i+1}"><a href="{r["url"]}" target="_blank" rel="noopener">{BS(r["title"],"html.parser").text}</a></li>' for i, r in enumerate(j["refs"])])

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
