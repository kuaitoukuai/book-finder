# -*- coding: utf-8 -*-
"""多书搜索：在当前用户所有记录的书籍中做模糊匹配。

score = 0.6 * 相似度 + 0.4 * 识别置信度；
相似度 = max(子串匹配 ? 1 : 0, difflib.SequenceMatcher ratio)；
score >= 0.5 视为匹配，按 score 降序最多保留 20 条；
best 取置信度最高的一条（置信度相同取 score 高者）。
脏数据（books 非 list、条目非 dict、confidence 不可转 float）整条跳过。
"""
import difflib

from .parse import norm_title

MATCH_MIN_SCORE = 0.5
MAX_MATCHES = 20


def _similarity(query: str, title: str) -> float:
    q, t = norm_title(query), norm_title(title)
    if not q or not t:
        return 0.0
    sub = 1.0 if (q in t or t in q) else 0.0
    return max(sub, difflib.SequenceMatcher(None, q, t).ratio())


def search_records(records: list[dict], queries: list[str]) -> list[dict]:
    """records 为完整记录字典列表，返回契约格式的搜索结果。"""
    results = []
    for query in queries:
        matches = []
        for rec in records:
            if not isinstance(rec, dict):
                continue
            books = rec.get("books")
            if not isinstance(books, list):
                continue
            for b in books:
                if not isinstance(b, dict):
                    continue
                title = b.get("title")
                if not isinstance(title, str) or not title.strip():
                    continue
                title = title.strip()
                try:
                    confidence = float(b.get("confidence", 0))
                except (TypeError, ValueError):
                    continue  # confidence 为 null/字符串等脏数据，跳过该条
                score = round(0.6 * _similarity(query, title)
                              + 0.4 * confidence, 4)
                if score < MATCH_MIN_SCORE:
                    continue
                matches.append({
                    "record_id": rec.get("id", ""),
                    "record_name": rec.get("name", ""),
                    "shelf": b.get("shelf") or rec.get("shelf", ""),
                    "index": b.get("index", 0),
                    "title": title,
                    "confidence": confidence,
                    "score": score,
                })
        matches.sort(key=lambda m: -m["score"])
        matches = matches[:MAX_MATCHES]
        best = (max(matches, key=lambda m: (m["confidence"], m["score"]))
                if matches else None)
        results.append({"query": query, "best": best, "matches": matches})
    return results
