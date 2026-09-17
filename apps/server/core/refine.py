# -*- coding: utf-8 -*-
"""bbox 行内吸附：把模型"目测"的松散书脊框对齐成整齐的书架格子。

原理：
- 书都立在同一块层板上，所以同一排书的底边 y2 应当对齐（取行内中位数）；
- 相邻书脊共享一条物理边界，模型给出的两个相邻框经常互相越界或留缝，
  把两者的相邻边吸附到中点即可消除重叠与缝隙。
"""
from collections import Counter
import re
from statistics import median

Y_TOL = 0.05       # y 中心聚类容差（归一化）
Y_SNAP = 0.06      # y2 距行中位数超过此值则不吸附（可能是另一层）
MIN_ROW = 3        # 行内少于几本不做吸附


def _y_center(b):
    return (b["bbox"][1] + b["bbox"][3]) / 2


def cluster_rows(books: list[dict], y_tol: float = Y_TOL) -> list[list[dict]]:
    """按 y 中心把书聚成行（snap_rows 与 drop_edge_rows 共用）。"""
    rows: list[list[dict]] = []
    for b in sorted(books, key=_y_center):
        if rows and abs(_y_center(b) - sum(map(_y_center, rows[-1]))
                        / len(rows[-1])) <= y_tol:
            rows[-1].append(b)
        else:
            rows.append([b])
    return rows


def physical_rows(books: list[dict], y_overlap: float = 0.3) -> list[list[dict]]:
    """把 cluster_rows 的逻辑行按 y 带重叠度合并成物理行。

    同一排书被上下两个切块各读一遍时，会产生两个 y 带部分重叠的逻辑行
    （实测带高重叠度 0.42）；而相邻两排真书的 y 带几乎不重叠（<0.2）。
    按"交集/较短带高 > y_overlap"把逻辑行并成物理行，供行内 x 去重使用。
    阈值取 0.3 而非更直觉的 0.6：0.6 会漏掉实测 0.42 的错位重读，
    而真书相邻行带重叠度远低于 0.3，不会误并。
    """
    rows = cluster_rows(books)
    if not rows:
        return rows
    bands = [[min(b["bbox"][1] for b in row),
              max(b["bbox"][3] for b in row), list(row)] for row in rows]
    merged = [bands[0]]
    for y1, y2, members in bands[1:]:
        my1, my2, mm = merged[-1]
        inter = max(0.0, min(my2, y2) - max(my1, y1))
        shorter = min(my2 - my1, y2 - y1)
        if shorter > 0 and inter / shorter > y_overlap:
            merged[-1] = [min(my1, y1), max(my2, y2), mm + members]
        else:
            merged.append([y1, y2, members])
    return [members for _, _, members in merged]


def snap_rows(books: list[dict]) -> list[dict]:
    if not books:
        return books
    rows = cluster_rows(books)

    for row in rows:
        if len(row) < MIN_ROW:
            continue
        # 底边对齐到行中位数
        y2s = sorted(b["bbox"][3] for b in row)
        y2_med = round(y2s[len(y2s) // 2], 4)
        for b in row:
            if abs(b["bbox"][3] - y2_med) <= Y_SNAP:
                b["bbox"][3] = y2_med
        # 竖立书脊的相邻边吸附到中点
        upright = [b for b in row
                   if (b["bbox"][3] - b["bbox"][1])
                   > (b["bbox"][2] - b["bbox"][0]) * 1.5]
        upright.sort(key=lambda b: (b["bbox"][0] + b["bbox"][2]) / 2)
        for a, c in zip(upright, upright[1:]):
            if a["bbox"][2] > c["bbox"][0]:
                mid = round((a["bbox"][2] + c["bbox"][0]) / 2, 4)
                a["bbox"][2], c["bbox"][0] = mid, mid
    return books


def drop_edge_rows(books: list[dict], edge: float = 0.02, shrink: float = 0.8):
    """丢弃照片上下边缘被画面裁断的半层书。

    判定（满足其一即整行丢弃）：
    - 行中位 y1 贴上缘（<= edge）或中位 y2 贴下缘（>= 1-edge），
      且行中位高度 < shrink × 全图高度中位数 H（"贴边且明显矮"）；
    - 行中位 y1/y2 直接顶到画面边框（parse  clamp 后 == 0.0/1.0，说明书脊
      被画面裁断伸出界外），且行中位高度 < H（比典型书脊矮）。
      实测 57 号图下半层残留高度达 0.81×H，单靠 shrink 阈值漏网，
      但完整可见的行几乎不会整行顶死在边框上，故此信号可靠。
    真书贴边拍但高度完整（med_h ≈ H）的行不受影响。
    只有一行时（裁剪单行场景）高度无从比较，不过滤。

    返回 (保留的书, 丢弃行数, 丢弃书数)。
    """
    if not books:
        return books, 0, 0
    rows = cluster_rows(books)
    if len(rows) <= 1:
        return books, 0, 0
    H = median(b["bbox"][3] - b["bbox"][1] for b in books)
    kept, dropped_rows, dropped_books = [], 0, 0
    for row in rows:
        med_y1 = median(b["bbox"][1] for b in row)
        med_y2 = median(b["bbox"][3] for b in row)
        med_h = median(b["bbox"][3] - b["bbox"][1] for b in row)
        touch_edge = med_y1 <= edge or med_y2 >= 1 - edge
        clipped = med_y1 <= 0.001 or med_y2 >= 0.999
        if touch_edge and med_h < shrink * H:
            drop = True
        elif clipped and med_h < H:
            drop = True
        else:
            drop = False
        if drop:
            dropped_rows += 1
            dropped_books += len(row)
            continue
        kept.extend(row)
    return kept, dropped_rows, dropped_books


CODE_RE = re.compile(r"[A-Za-z]+\d")


def assign_shelf_per_row(books: list[dict]) -> list[dict]:
    """按行（y 带）把书架号统一到该行的众数架标，一本书一个 shelf。

    同一个架标常被不同切块/不同次读法"读碎"（有的只读到分类号 C912.22/44422，
    有的只读到类目名"社会团体"）——整行书统一用该行 `majority_shelf` 合并后的
    完整架标，避免逐本碎片化。若一张图里有两排不同的架标（两排书架），各自按
    行独立聚合、互不混淆。行内没有架标读数的书不动（保持各自原值/留空）。
    """
    if not books:
        return books
    for row in cluster_rows(books):
        row_shelf = majority_shelf(row)
        for b in row:
            if row_shelf:
                b["shelf"] = row_shelf
    return books


def majority_shelf(books: list[dict]) -> str:
    """把各书脊的 shelf 读数聚合为整张图的书架号。

    同一个架标常被不同切块"读碎"：有的块只看到分类号（C912.22/44422），
    有的块只看到类目名（社会团体）。聚合规则：
    1. 若某个高频值已包含其他高频值（完整架标），直接取它；
    2. 否则把"含字母+数字的分类号"与"类目名"的最高频各取一个拼接；
    3. 都没有则退化为普通众数。
    """
    vals = Counter(b["shelf"].strip() for b in books
                   if b.get("shelf", "").strip())
    if not vals:
        return ""
    ranked = vals.most_common()
    frequent = [v for v, n in ranked if n >= 2] or [ranked[0][0]]
    for v in frequent:
        others = [o for o in frequent if o != v]
        if others and all(o in v for o in others):
            return v
    codes = [v for v in frequent if CODE_RE.search(v)]
    names = [v for v in frequent if not CODE_RE.search(v)]
    parts = []
    if codes:
        # 分类号可能只读到一半（"C912 社会团体" vs "C912.22/44422 社会团体"）：
        # 在票数达到一定量级（≥最高票的 30%）的值里取信息量最大（归一化后最长）的
        top_n = ranked[0][1]
        strong = [v for v in codes if vals[v] >= max(2, 0.3 * top_n)]
        parts.append(max(strong or codes,
                         key=lambda v: (len(re.sub(r"[\s/.\-]", "", v)), vals[v])))
    if names:
        parts.append(max(names, key=lambda v: vals[v]))
    return " ".join(parts) if parts else ranked[0][0]
