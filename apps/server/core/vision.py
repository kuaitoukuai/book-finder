# -*- coding: utf-8 -*-
"""DeepSeek 视觉 API 调用（移植自 book_finder_web/app.py）。

通用多供应商调用（含同一份提示词）在 core/providers.py，这里保留 DeepSeek 专属封装。
"""
import logging

from .providers import PROMPT as PROMPT  # noqa: F401  共享提示词
from .providers import call_vision_any

logger = logging.getLogger("bookfinder.vision")


def call_vision(image_bytes: bytes, *, api_key: str, base_url: str,
                model: str, retries: int = 2) -> str:
    """DeepSeek 专属整图视觉调用（thinking 模式需显式禁用）。"""
    if not api_key:
        # 缺少 Key 时早点失败，避免每个切块都白跑一轮重试
        raise RuntimeError("服务端未配置 DeepSeek API Key：请设置环境变量 "
                           "DEEPSEEK_API_KEY 后重启服务")
    return call_vision_any(image_bytes, base_url=base_url, api_key=api_key,
                           model=model, thinking=True, retries=retries,
                           label="DeepSeek")
