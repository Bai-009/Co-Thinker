import os
import json
from typing import AsyncIterator

import httpx
from dotenv import load_dotenv

_base = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(_base, '..', '.env'))


def get_llm_settings() -> tuple[str, str, str]:
    return (
        os.getenv("DEEPSEEK_API_KEY", ""),
        os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
    )


async def chat_completion(messages: list[dict]) -> str:
    """
    调用 DeepSeek Chat Completion API（非流式）。
    messages: OpenAI 格式的消息列表
    返回完整的 AI 回复文本。
    """
    api_key, base_url, model = get_llm_settings()
    if not api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY，请在 .env 文件中设置。")

    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.8,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def chat_completion_stream(messages: list[dict]) -> AsyncIterator[str]:
    """
    流式调用 DeepSeek Chat Completion API。
    每次 yield 一个 token / token chunk 的文本片段。
    """
    api_key, base_url, model = get_llm_settings()
    if not api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY，请在 .env 文件中设置。")

    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.8,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
                choices = data.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content
