from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode


def canonical_url(url: str) -> str:
    parts = list(urlsplit(url))
    q = [(k, v) for k, v in parse_qsl(parts[3], keep_blank_values=True) if not k.lower().startswith('utm_')]
    parts[3] = urlencode(q)
    parts[4] = ''  # drop fragment
    return urlunsplit(parts)
