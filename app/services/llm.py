"""The single tier-aware LLM funnel (CLAUDE.md architecture decision):
every LLM call in the app goes through one wrapper (services/extraction.py,
services/classifier.py) — enabled only when LLM_TIER=on AND the key is set.
Compose points LLM_BASE_URL at an OpenAI-compatible endpoint.

Everything here is fail-soft by convention: callers decide what a disabled
tier or an unreachable endpoint degrades to, never a crash — the extraction
contract degrades to manual entry (PROJECT_PLAN.md, no task queue)."""

import json

import httpx

from .. import config


class LlmError(Exception):
    """An endpoint failure (disabled tier, HTTP error, timeout, no usable
    JSON message) — carries a short human-readable reason."""

    def __init__(self, reason: str, http_status: int | None = None):
        super().__init__(reason)
        self.reason = reason
        self.http_status = http_status


def tier_on() -> bool:
    """The documented gate: LLM_TIER=on AND the key set."""
    return config.LLM_TIER == "on" and bool(config.LLM_API_KEY.strip())


def chat(
    messages: list,
    *,
    temperature: float = 0.0,
    response_format: dict | None = None,
    timeout_s: int | None = None,
) -> dict:
    """One OpenAI-compatible chat completion. Returns the full response body,
    raises LlmError on anything unusable."""
    if not tier_on():
        raise LlmError("the LLM tier is switched off")
    payload = {
        "model": config.LLM_MODEL,
        "temperature": temperature,
        "messages": messages,
    }
    if response_format is not None:
        payload["response_format"] = response_format
    try:
        res = httpx.post(
            f"{config.LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {config.LLM_API_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=timeout_s or config.LLM_TIMEOUT_S,
        )
    except httpx.TimeoutException:
        raise LlmError("the extraction server timed out")
    except httpx.HTTPError:
        raise LlmError("the extraction server is unreachable")
    if res.status_code >= 400:
        raise LlmError(f"the extraction server answered HTTP {res.status_code}", res.status_code)
    try:
        body = res.json()
    except ValueError:
        raise LlmError("the extraction server sent no JSON")
    return body


def _candidate_texts(message: dict | None):
    """One completion may carry its text several ways: a plain string content,
    a reasoning field (an ollama-style quirk: content empty, payload in the
    reasoning), or a content part array."""
    if not message:
        return
    content = message.get("content")
    for text in (content, message.get("reasoning")):
        if isinstance(text, str) and text.strip():
            yield text
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                yield part["text"]


def parse_json_message(body: dict) -> dict | None:
    """Defensive JSON extraction from a completion (the local OpenAI-compatible
    server does not enforce response_format, and hosted answers may be fenced
    or prose-wrapped). Returns the first parseable JSON object, else None."""
    try:
        message = body["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return None
    for text in _candidate_texts(message):
        stripped = text.strip()
        candidates = [stripped]
        first, last = stripped.find("{"), stripped.rfind("}")
        if first != -1 and last > first:
            candidates.append(stripped[first : last + 1])
        for candidate in candidates:
            try:
                value = json.loads(candidate)
            except ValueError:
                continue
            if isinstance(value, dict):
                return value
    return None