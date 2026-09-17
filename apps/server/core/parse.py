# -*- coding: utf-8 -*-
"""模型输出解析（移植自 book_finder_web/app.py，含对抗性加固）。"""
import json
import math
import re

FENCE_RE = re.compile(r"```(?:json)?")
PUNCT_RE = re.compile(r"[\s《》〈〉「」『』【】\-—_·:：,，.。!！?？'’\"“”]")


def parse_books(text: str) -> list[dict]:
    """从模型输出中稳健提取书籍 JSON 数组。"""
    text = FENCE_RE.sub("", text)
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return []
    try:
        arr = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        chunk = text[start:end + 1]
        last = chunk.rfind("}")
        if last == -1:
            return []
        try:
            arr = json.loads(chunk[:last + 1] + "]")
        except json.JSONDecodeError:
            return []
    books = []
    for item in arr if isinstance(arr, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            raw_bbox = item.get("bbox") or item.get("box") or item.get("box_2d")
            bbox = [float(v) for v in raw_bbox][:4]
            if len(bbox) != 4:
                continue
            # json.loads 默认接受 NaN/Infinity，若放行会一路带到 json.dumps，
            # 产出 JS 的 JSON.parse 无法解析的非法 JSON（SSE 整条消息报废）
            if not all(math.isfinite(v) for v in bbox):
                continue
            # 坐标系自适应：模型偶尔返回 0~1000 或 0~100 的坐标
            peak = max(abs(v) for v in bbox)
            if peak > 100:
                bbox = [v / 1000.0 for v in bbox]
            elif peak > 1.5:
                bbox = [v / 100.0 for v in bbox]
            x1, y1, x2, y2 = bbox
            x1, x2 = sorted((min(max(x1, 0), 1), min(max(x2, 0), 1)))
            y1, y2 = sorted((min(max(y1, 0), 1), min(max(y2, 0), 1)))
            if (x2 - x1) * (y2 - y1) < 0.0002:
                continue
            conf = float(item.get("confidence", 0.5) or 0.5)
            if not math.isfinite(conf):  # 同上：NaN 会污染整份 JSON
                conf = 0.5
            if conf > 1.5:  # 百分制置信度
                conf /= 100.0
            author = item.get("author")
            if not isinstance(author, str) or len(author.strip()) > 40:
                author = ""
            books.append({
                "title": str(item.get("title") or "").strip()[:120],
                "author": author.strip(),
                "shelf": str(item.get("shelf") or "").strip()[:40],
                "bbox": [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)],
                "confidence": round(min(max(conf, 0), 1), 3),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return books


def norm_title(t: str) -> str:
    return PUNCT_RE.sub("", (t or "").lower())
