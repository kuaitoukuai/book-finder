# -*- coding: utf-8 -*-
"""多视觉模型结果的"智能融合"：按位置分组 + 置信度择优 + 补漏。

策略（用户确认）：
- 把各家已组装的书籍按书脊位置（bbox 交并比 IoU）分组，落在同一物理书脊的几个结果
  视为同一本书；
- 组内多家都识别到时，normalize 后的书名出现次数最多的作为主角（多票），bbox 取该组
  成员的平均，置信度取各家置信度中的最高，并记下由哪几家提供（sources）；
- 只有一家识别到的组照常保留（补漏）——避免"必须多票才保留"把只有一家能看清的书漏掉。
"""
from __future__ import annotations

from .parse import norm_title


def _box(cx, cy, bw, bh):
    return [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]


def _iou(a, b) -> float:
    if not a or not b or len(a) < 4 or len(b) < 4:
        return 0.0
    xA = max(a[0], b[0]); yA = max(a[1], b[1])
    xB = min(a[2], b[2]); yB = min(a[3], b[3])
    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    aA = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    bA = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    if aA + bA - inter <= 0:
        return 0.0
    return inter / (aA + bA - inter)


def fuse_book_lists(provider_lists: list[list[dict]]) -> list[dict]:
    """provider_lists：各家组装后的书籍列表；返回融合后（未排序/未编号）的书籍。"""
    # 收集所有书，记录来源
    entries = []  # (bbox, dict, providerIdx)
    for pi, books in enumerate(provider_lists):
        for b in books:
            bb = b.get("bbox")
            if not isinstance(bb, (list, tuple)) or len(bb) < 4:
                continue
            if not str(b.get("title") or "").strip():
                continue  # 无书名的空壳不参与融合
            entries.append((list(float(v) for v in bb[:4]), b, pi))
    if not entries:
        return []

    # 贪心分组：按 IoU >= 0.3 视为同一物理书脊；保证一张书脊只进一个组
    groups: list[list[tuple[list, dict, int]]] = []
    for ent in entries:
        placed = False
        for g in groups:
            ref = g[0][0]
            if _iou(ent[0], ref) >= 0.3:
                g.append(ent)
                placed = True
                break
        if not placed:
            groups.append([ent])

    out = []
    for g in groups:
        # 归一化书名统计：同组内多家一致的采用多数；无多数则用置信度最高
        by_title = {}
        for (bb, b, pi) in g:
            nt = norm_title(str(b.get("title") or "")) or str(b.get("title") or "")
            by_title.setdefault(nt, []).append((bb, b, pi))
        best_nt = max(by_title, key=lambda k: (len(by_title[k]),
                                               max(x[1].get("confidence", 0)
                                                   for x in by_title[k])))

        # 取该主角名下的成员：bbox 平均、置信度取最高、来源集合、作者取非空
        members = by_title[best_nt]
        n = len(members)
        bb_avg = [sum(m[0][i] for m in members) / n for i in range(4)]
        conf = max(float(m[1].get("confidence", 0) or 0) for m in members)
        author = ""
        for (_bb, b, _pi) in members:
            a = str(b.get("author") or "").strip()
            if a:
                author = a
                break
        sources = sorted({m[2] for m in members})
        # 主角的置信度：多来源时取最高并额外 +0.05 作为"多家印证"的微奖（封顶 1）
        fused_conf = min(1.0, conf + (0.05 if len(sources) >= 2 else 0))
        out.append({
            "title": (fused := next((b.get("title") for (bb, b, pi) in g
                                     if (norm_title(str(b.get("title") or ""))
                                         or "") == best_nt), "")) or "",
            "author": author,
            "bbox": [round(v, 4) for v in bb_avg],
            "confidence": round(fused_conf, 4),
            "sources": sources,
            "voted": len(sources) >= 2,
        })
    # 按位置从左到右、从上到下排
    out.sort(key=lambda b: (round(b["bbox"][1], 2), b["bbox"][0]))
    return out