# -*- coding: utf-8 -*-
"""碎片合并：把模型误拆出来的"作者名/卷数数字"窄条并回所属书。

模型偶尔把一条书脊上的作者名（"刘碧瑛◎著"）、系列数字（"37"）各自输出成
一本独立的书。这类碎片特征明显：title 匹配作者形态或纯数字、与所属书同一行
且 x 方向紧贴。本模块只做这两种高置信合并，其余碎片（如半句话）保持原样，
避免误伤真书——更根本的治理在提示词与两遍识别。
"""
import re

from .refine import cluster_rows

AUTHOR_RE = re.compile(r"^[一-龥]{2,4}[◎○]?(著|主编|编著|编|绘)$")
VOLUME_RE = re.compile(r"^\d{1,4}$")
AUTHOR_SUFFIX_RE = re.compile(r"[◎○]?(主编|编著|著|编|绘)$")

X_GAP_RATIO = 0.3   # 相邻判定：x 间隙 < 该行平均书宽 × 0.3


def fragment_kind(title: str) -> str:
    """'author' / 'volume' / ''（非碎片）。"""
    t = (title or "").strip()
    if AUTHOR_RE.match(t) or "◎著" in t:
        return "author"
    if VOLUME_RE.match(t):
        return "volume"
    return ""


def _x_center(b):
    return (b["bbox"][0] + b["bbox"][2]) / 2


def _y_center(b):
    return (b["bbox"][1] + b["bbox"][3]) / 2


def _absorb(target: dict, frag: dict):
    """bbox 取并集，confidence 取两者均值。"""
    tb, fb = target["bbox"], frag["bbox"]
    target["bbox"] = [min(tb[0], fb[0]), min(tb[1], fb[1]),
                      max(tb[2], fb[2]), max(tb[3], fb[3])]
    target["confidence"] = round(
        (target.get("confidence", 0.5) + frag.get("confidence", 0.5)) / 2, 3)


def merge_fragments(books: list[dict]) -> list[dict]:
    """把作者/卷数碎片并入相邻书（优先左侧），返回合并后的列表。"""
    if not books:
        return books
    out: list[dict] = []
    for row in cluster_rows(books):
        row.sort(key=_x_center)
        avg_w = sum(b["bbox"][2] - b["bbox"][0] for b in row) / len(row)
        max_gap = avg_w * X_GAP_RATIO
        i = 0
        while i < len(row):
            frag = row[i]
            kind = fragment_kind(frag.get("title", ""))
            if not kind:
                i += 1
                continue
            # 左右相邻的非碎片候选（优先左侧，其次右侧）
            cands = []
            if i > 0 and not fragment_kind(row[i - 1].get("title", "")) \
                    and frag["bbox"][0] - row[i - 1]["bbox"][2] < max_gap:
                cands.append(row[i - 1])
            if i + 1 < len(row) and not fragment_kind(row[i + 1].get("title", "")) \
                    and row[i + 1]["bbox"][0] - frag["bbox"][2] < max_gap:
                cands.append(row[i + 1])
            absorbed = False
            for target in cands:
                if kind == "author":
                    if target.get("author"):  # 目标书已有 author 则跳过
                        continue
                    target["author"] = AUTHOR_SUFFIX_RE.sub(
                        "", frag["title"].strip())
                else:  # volume：卷数并入书名尾部
                    target["title"] = (target.get("title", "").strip()
                                       + " " + frag["title"].strip()).strip()
                _absorb(target, frag)
                absorbed = True
                break
            if absorbed:
                row.pop(i)
            else:
                i += 1
        out.extend(row)
    return out
