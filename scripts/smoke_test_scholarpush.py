import sys, os, json
sys.path.append(os.path.join(os.getcwd(), 'tools'))
import ai_blog_pipeline as p

# Minimal fake entries (no network/LLM required for fallback path)
entries = [
    {
        'title': 'Test Paper on RAG',
        'url': 'https://arxiv.org/abs/2509.01234',
        'ts': '2025-09-10T00:00:00Z',
        'summary': 'We propose a retrieval-augmented generation method; improves EM by 10% on dataset X.'
    },
    {
        'title': 'GitHub Project Y',
        'url': 'https://github.com/user/repo',
        'ts': '2025-09-10T00:00:00Z',
        'summary': 'A toolkit for X.'
    }
]

sp = p.make_scholarpush(entries, n_items=2, daily=None)
print('items:', len(sp.get('items', [])))
first = sp['items'][0]
print('first.keys:', sorted(first.keys()))
zh = first.get('summary_i18n', {}).get('zh', '')
print('zh_digest_len:', len(zh))
print('zh_digest_head:', zh[:120].replace('\n',' '))
print('ok')
