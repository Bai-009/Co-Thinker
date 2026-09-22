"""DeepSeek（OpenAI 兼容）调用。所有模型调用都从这里走。

这里是 harness 的底座，做三件事：
- 按角色显式钉住 thinking 模式。DeepSeek 现在默认开 thinking（档位 high），
  开着时 temperature 不生效；thinker 是心跳，默认关；其他角色默认开。
- 让流式响应在最后一块带回 usage，按角色记录输入、缓存命中、未命中、输出、
  推理 token 和耗时。没有这些数字，缓存和 thinking 是否按预期工作无从得知。
- 把角色的旋钮收在环境变量里（见 .env.example）：
    COTHINKER_<ROLE>_THINKING      1/0，thinker 默认 0，其余默认 1
    COTHINKER_<ROLE>_EFFORT        low|high|max，只在 thinking 开着时有效
    COTHINKER_<ROLE>_TEMPERATURE   小数，只在 thinking 关着时有效
  ROLE 取 THINKER / REWRITER / BRIEF / JUDGE。
"""

import json
import logging
import os
import time
from typing import AsyncIterator

import httpx
from dotenv import load_dotenv

_base = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(_base, '..', '.env'))

log = logging.getLogger("cothinker.llm")


def get_llm_settings() -> tuple[str, str, str]:
    return (
        os.getenv("DEEPSEEK_API_KEY", ""),
        os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        # 文档里当前的正式 ID；deepseek-v4-flash 自 2026-09-10 起只是临时别名。
        os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
    )


def get_reasoner_model() -> str:
    """判官用的推理档模型。判官在代谢那边异步跑，等得起秒到分钟的延迟。"""
    return os.getenv("DEEPSEEK_REASONER_MODEL", "deepseek-v4-pro")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def call_options(role: str) -> dict:
    """某个角色这次调用的旋钮。thinker 默认不 thinking，其余默认 thinking。"""
    key = role.upper()
    opts: dict = {"role": role, "thinking": _env_flag(f"COTHINKER_{key}_THINKING", role != "thinker")}
    effort = os.getenv(f"COTHINKER_{key}_EFFORT", "").strip().lower()
    if effort in ("low", "high", "max"):
        opts["effort"] = effort
    temperature = os.getenv(f"COTHINKER_{key}_TEMPERATURE", "").strip()
    if temperature:
        try:
            opts["temperature"] = float(temperature)
        except ValueError:
            log.warning("COTHINKER_%s_TEMPERATURE 不是数字：%r，忽略", key, temperature)
    return opts


def _payload(
    messages: list[dict],
    model: str,
    *,
    thinking: bool | None,
    effort: str | None,
    temperature: float | None,
) -> dict:
    payload: dict = {"model": model, "messages": messages}
    if thinking is not None:
        payload["thinking"] = {"type": "enabled" if thinking else "disabled"}
        if thinking and effort:
            payload["reasoning_effort"] = effort
    # thinking 开着时 temperature 不被支持，只在明确关掉时才传。
    if thinking is False and temperature is not None:
        payload["temperature"] = temperature
    return payload


def _log_usage(role: str, model: str, usage: dict | None, ttft_ms: int | None, total_ms: int) -> None:
    usage = usage or {}
    details = usage.get("completion_tokens_details") or {}
    log.info(
        "llm role=%s model=%s prompt=%s hit=%s miss=%s out=%s reasoning=%s ttft=%sms total=%sms",
        role or "-",
        model,
        usage.get("prompt_tokens", "?"),
        usage.get("prompt_cache_hit_tokens", "?"),
        usage.get("prompt_cache_miss_tokens", "?"),
        usage.get("completion_tokens", "?"),
        details.get("reasoning_tokens", "?"),
        "?" if ttft_ms is None else ttft_ms,
        total_ms,
    )


def _settings_or_raise() -> tuple[str, str, str]:
    api_key, base_url, default_model = get_llm_settings()
    if not api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY，请在 .env 文件中设置。")
    return api_key, base_url, default_model


async def chat_completion(
    messages: list[dict],
    model: str | None = None,
    *,
    role: str = "",
    thinking: bool | None = None,
    effort: str | None = None,
    temperature: float | None = None,
) -> str:
    """非流式调用，返回完整正文。"""
    api_key, base_url, default_model = _settings_or_raise()
    model = model or default_model
    payload = _payload(messages, model, thinking=thinking, effort=effort, temperature=temperature)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
    _log_usage(role, model, data.get("usage"), None, int((time.monotonic() - started) * 1000))
    return data["choices"][0]["message"]["content"]


async def chat_completion_stream(
    messages: list[dict],
    model: str | None = None,
    *,
    role: str = "",
    thinking: bool | None = None,
    effort: str | None = None,
    temperature: float | None = None,
) -> AsyncIterator[str]:
    """流式调用，每次 yield 一段正文。推理内容（reasoning_content）不吐给调用方。"""
    api_key, base_url, default_model = _settings_or_raise()
    model = model or default_model
    payload = _payload(messages, model, thinking=thinking, effort=effort, temperature=temperature)
    payload["stream"] = True
    payload["stream_options"] = {"include_usage": True}
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    started = time.monotonic()
    first_token_ms: int | None = None
    usage: dict | None = None
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            async with client.stream("POST", f"{base_url}/chat/completions", headers=headers, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    if data.get("usage"):
                        usage = data["usage"]
                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        if first_token_ms is None:
                            first_token_ms = int((time.monotonic() - started) * 1000)
                        yield content
    finally:
        _log_usage(role, model, usage, first_token_ms, int((time.monotonic() - started) * 1000))
