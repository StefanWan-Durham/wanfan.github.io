# -*- coding: utf-8 -*-
"""
Multi-provider LLM chat adapter with simple failover.

Supported providers via environment variables (any one or more):

- OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL
- OPENROUTER_API_KEY / OPENROUTER_MODEL / OPENROUTER_BASE_URL
- TOGETHER_API_KEY / TOGETHER_MODEL / TOGETHER_BASE_URL
- DEEPSEEK_API_KEY / DEEPSEEK_MODEL / DEEPSEEK_BASE_URL
- DASHSCOPE_API_KEY / DASHSCOPE_MODEL / DASHSCOPE_BASE_URL

Optional: PREFERRED_PROVIDER in {openai, openrouter, together, deepseek, dashscope}

Usage:
    from ai_llm import chat_once
    text = chat_once("your prompt", system="system msg")
"""
import os
import json
import time
from typing import Dict, Any, List, Optional

import requests


class LLMError(Exception):
    pass


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(name)
    return val if val not in (None, "") else default


def _build_messages(prompt: str, system: Optional[str]) -> List[Dict[str, str]]:
    msgs: List[Dict[str, str]] = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": prompt})
    return msgs


def _post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: int = 60) -> Dict[str, Any]:
    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    if r.status_code >= 400:
        raise LLMError(f"HTTP {r.status_code}: {r.text[:500]}")
    try:
        return r.json()
    except Exception as e:
        raise LLMError(f"Invalid JSON response: {e}\n{r.text[:500]}")


def _extract_text(resp: Dict[str, Any]) -> str:
    # OpenAI-compatible response
    try:
        return resp["choices"][0]["message"]["content"].strip()
    except Exception:
        # Some providers (rare) nest differently; try a couple of fallbacks
        try:
            return resp["choices"][0]["text"].strip()
        except Exception:
            raise LLMError("No text content in response")


def _call_openai(messages, temperature, max_tokens) -> str:
    key = _env("OPENAI_API_KEY")
    if not key:
        raise LLMError("OPENAI_API_KEY missing")
    model = _env("OPENAI_MODEL", "gpt-4o-mini")
    base = _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
    url = f"{base.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }
    resp = _post_json(url, headers, payload)
    return _extract_text(resp)


def _call_openrouter(messages, temperature, max_tokens) -> str:
    key = _env("OPENROUTER_API_KEY")
    if not key:
        raise LLMError("OPENROUTER_API_KEY missing")
    model = _env("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    base = _env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    url = f"{base.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # Optional but nice-to-have headers per OpenRouter docs
        "X-Title": _env("GITHUB_REPOSITORY", "AI Daily Blog"),
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }
    resp = _post_json(url, headers, payload)
    return _extract_text(resp)


def _call_together(messages, temperature, max_tokens) -> str:
    key = _env("TOGETHER_API_KEY")
    if not key:
        raise LLMError("TOGETHER_API_KEY missing")
    model = _env("TOGETHER_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo")
    base = _env("TOGETHER_BASE_URL", "https://api.together.xyz/v1")
    url = f"{base.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }
    resp = _post_json(url, headers, payload)
    return _extract_text(resp)


def _call_deepseek(messages, temperature, max_tokens) -> str:
    key = _env("DEEPSEEK_API_KEY")
    if not key:
        raise LLMError("DEEPSEEK_API_KEY missing")
    model = _env("DEEPSEEK_MODEL", "deepseek-chat")
    base = _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    url = f"{base.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }
    resp = _post_json(url, headers, payload)
    return _extract_text(resp)


def _call_dashscope(messages, temperature, max_tokens) -> str:
    key = _env("DASHSCOPE_API_KEY")
    if not key:
        raise LLMError("DASHSCOPE_API_KEY missing")
    model = _env("DASHSCOPE_MODEL", "qwen2.5-72b-instruct")
    # Use OpenAI-compatible endpoint for DashScope
    base = _env("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    url = f"{base.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }
    resp = _post_json(url, headers, payload)
    return _extract_text(resp)


def chat_once(prompt: str,
              system: Optional[str] = None,
              temperature: float = 0.3,
              max_tokens: int = 2048) -> str:
    """Send one chat prompt and return text, with provider failover.

    Resolution order:
      1) PREFERRED_PROVIDER (if key available)
      2) Any provider that has its API key set, in fixed order
         [openai, openrouter, together, deepseek, dashscope]
    """
    messages = _build_messages(prompt, system)

    providers = {
        "openai": _call_openai,
        "openrouter": _call_openrouter,
        "together": _call_together,
        "deepseek": _call_deepseek,
        "dashscope": _call_dashscope,
    }

    order: List[str] = []
    pref = (_env("PREFERRED_PROVIDER", "") or "").strip().lower()

    def has_key(p: str) -> bool:
        return (
            (p == "openai" and _env("OPENAI_API_KEY")) or
            (p == "openrouter" and _env("OPENROUTER_API_KEY")) or
            (p == "together" and _env("TOGETHER_API_KEY")) or
            (p == "deepseek" and _env("DEEPSEEK_API_KEY")) or
            (p == "dashscope" and _env("DASHSCOPE_API_KEY"))
        ) is not None

    if pref and pref in providers and has_key(pref):
        order.append(pref)

    for p in ["openai", "openrouter", "together", "deepseek", "dashscope"]:
        if p not in order and has_key(p):
            order.append(p)

    if not order:
        raise LLMError("No provider API key configured")

    last_err: Optional[Exception] = None
    for p in order:
        try:
            fn = providers[p]
            return fn(messages, temperature, max_tokens)
        except Exception as e:
            last_err = e
            # brief backoff and try next
            time.sleep(0.5)
            continue

    raise LLMError(f"All providers failed. Last error: {last_err}")
