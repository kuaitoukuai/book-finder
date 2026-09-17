# -*- coding: utf-8 -*-
"""大图切块与跨块去重（移植自 book_finder_web/app.py）。"""
import difflib
import math
import os
import re

_DEBUG_DUMP = os.environ.get("BF3_DUMP_DEDUP")  # 非空时把行内去重决策写到文件（临时探针）

from .parse import norm_title
from .refine import cluster_rows, physical_rows

TILE_MAX = 1600      # 切块最长边
TILE_OVERLAP = 0.15  # 切块重叠比例


def make_tiles(w: int, h: int) -> list[tuple[int, int, int, int]]:
    """返回 [(x0,y0,x1,y1)] 像素坐标；小图返回整图一块。"""
    if max(w, h) <= TILE_MAX:
        return [(0, 0, w, h)]
    nx = max(1, math.ceil(w / TILE_MAX))
    ny = max(1, math.ceil(h / TILE_MAX))
    tw, th = w / nx, h / ny
    ox, oy = tw * TILE_OVERLAP, th * TILE_OVERLAP
    tiles = []
    for j in range(ny):
        for i in range(nx):
            x0 = max(0, int(i * tw - ox))
            y0 = max(0, int(j * th - oy))
            x1 = min(w, int((i + 1) * tw + ox))
            y1 = min(h, int((j + 1) * th + oy))
            tiles.append((x0, y0, x1, y1))
    return tiles


def iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def _overlap_min(a, b) -> float:
    """交集面积 / 较小框面积，对错位重复框更敏感。"""
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / min(area_a, area_b)


def _x_overlap_min(a, b) -> float:
    """x 向交集宽度 / 较窄框宽度：判断两框是否落在同一列书脊上。"""
    inter = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    if inter <= 0:
        return 0.0
    return inter / min(a[2] - a[0], b[2] - b[0])


def _y_overlap_min(a, b) -> float:
    """y 向交集高度 / 较矮框高度。"""
    inter = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    if inter <= 0:
        return 0.0
    return inter / min(a[3] - a[1], b[3] - b[1])


def _center(b) -> tuple[float, float]:
    return ((b["bbox"][0] + b["bbox"][2]) / 2, (b["bbox"][1] + b["bbox"][3]) / 2)


def _center_in(b, a) -> bool:
    """b 的中心点是否落入 a 的框内。"""
    cx, cy = _center(b)
    return (a["bbox"][0] <= cx <= a["bbox"][2]
            and a["bbox"][1] <= cy <= a["bbox"][3])


def _is_dup(a: dict, b: dict) -> bool:
    if iou(a["bbox"], b["bbox"]) > 0.3 or _overlap_min(a["bbox"], b["bbox"]) > 0.5:
        return True
    # 中心点包含 + y 中心接近：同一本书被两个切块框得大小不一
    # （一个只框文字带、一个框整条书脊）
    if abs(_center(a)[1] - _center(b)[1]) < 0.1 \
            and (_center_in(a, b) or _center_in(b, a)):
        return True
    ta, tb = norm_title(a["title"]), norm_title(b["title"])
    if ta and ta == tb:
        ca, cb = _center(a), _center(b)
        if abs(ca[0] - cb[0]) < 0.06 and abs(ca[1] - cb[1]) < 0.1:
            return True
    # 标题互为子串（长度≥2）且 x 重叠 > 0.5、y 重叠 > 0.2：同一书脊被上下两个
    # 切块各读一次，一次读出完整书名、一次只读出片段（如 "非营利组织项目管理指南"
    # vs "高效务实——非营利组织项目管理指南"），y 偏移可达半格，iou/面积规则兜不住。
    # 防护：同排并放的复本 x 重叠≈0，上下排的同名列书 y 重叠≈0，都不会误伤。
    if ta and tb and min(len(ta), len(tb)) >= 2 and (ta in tb or tb in ta) \
            and _x_overlap_min(a["bbox"], b["bbox"]) > 0.5 \
            and _y_overlap_min(a["bbox"], b["bbox"]) > 0.2:
        return True
    return False


def dedup(books: list[dict]) -> list[dict]:
    # 保留信息量更大的副本：title 更长优先，其次 confidence 更高
    books = sorted(books, key=lambda b: (-len(norm_title(b["title"])),
                                         -b["confidence"]))
    kept: list[dict] = []
    for b in books:
        dup_of = next((k for k in kept if _is_dup(b, k)), None)
        if dup_of is not None:
            # 被丢方有 author 而保留方没有，把 author 带过来
            if not dup_of.get("author") and b.get("author"):
                dup_of["author"] = b["author"]
            continue
        kept.append(b)
    # 按位置排序：先行（y）后列（x）
    kept.sort(key=lambda b: (round((b["bbox"][1] + b["bbox"][3]) / 2, 1),
                             b["bbox"][0]))
    return kept


# 作者署名被误读成书名的特征（如 "刘碧瑛◎著"、"王敏芝 著" 归一化后）
_BYLINE_RE = re.compile(r"^[一-龥]{2,4}[◎/]?著\d*$")
_CJK_RE = re.compile(r"[一-龥]")


def _is_byline(norm: str) -> bool:
    return bool(_BYLINE_RE.match(norm))


def _weak_title(norm: str) -> bool:
    """"弱书名"：超短（<=4 字）、纯作者署名或无中文（英文名重读）。
    这类条目在同位置已有正常书名时，大概率是同一书脊被另一切块
    读了书脊上的作者/英文/架标文字而产生的垃圾重复。"""
    return len(norm) <= 4 or _is_byline(norm) or not _CJK_RE.search(norm)


def _prefer(a: dict, b: dict) -> tuple[dict, dict]:
    """判重合并时保留信息量更大的一方：书名更长优先，其次置信度更高，
    再次非整图补漏（frame 遍的 bbox 定位不准）。返回 (保留, 丢弃)。"""
    ka = (len(norm_title(a["title"])), a["confidence"],
          0 if a.get("source") == "frame" else 1)
    kb = (len(norm_title(b["title"])), b["confidence"],
          0 if b.get("source") == "frame" else 1)
    return (a, b) if ka >= kb else (b, a)


def _merge_into(keep: dict, drop: dict) -> None:
    """把 drop 合并进 keep：作者互补。bbox 保留信息量更大一方的框——
    若取并集，已合并书与未合并书的 y 带会错开半个行高，导致聚类与
    列表排序被打散。"""
    if not keep.get("author") and drop.get("author"):
        keep["author"] = drop["author"]


def _x_coverage(b: dict, intervals: list[tuple[float, float]]) -> float:
    """b 的 x 区间被 intervals（已排序）并集覆盖的比例。"""
    x1, x2 = b["bbox"][0], b["bbox"][2]
    if x2 - x1 <= 0:
        return 0.0
    cov = 0.0
    for a, c in intervals:
        if c <= x1:
            continue
        if a >= x2:
            break
        cov += min(c, x2) - max(a, x1)
    return cov / (x2 - x1)


def _dedup_one_row(row: list[dict]) -> list[dict]:
    widths = sorted(b["bbox"][2] - b["bbox"][0] for b in row)
    w_med = widths[len(widths) // 2] if widths else 0.02
    window = 5 * w_med            # 参与比较的 x 中心距上限
    gap_max = max(0.07, 3 * w_med)  # 片段吸收的盒间距上限（容错透视漂移）
    # 每本书的 x 领地是否已被行内其他书覆盖：被双读的行 x 空间是双重覆盖的，
    # 漂移碎片必然落在别人领地上；单读的真书（如"活着"紧邻"活着（珍藏版）"）
    # 领地独占，不会被 gap 吸收误伤
    covered: dict[int, float] = {}
    for i, b in enumerate(row):
        covered[id(b)] = max(
            (_x_overlap_min(b["bbox"], o["bbox"])
             for j, o in enumerate(row) if j != i), default=0.0)
    # 主带（书最多、置信度平均值最高）在合并/弱书名丢弃前先算好：
    # 用来保护"主带真书"——第二遍的弱书名规则绝不能把主带真书删掉去换一个
    # 次带幻觉书（实测 55 号 4 字真书"社交三力"差点被"乌合之众"顶替后一起消失）。
    main_band = None
    main_ids: set[int] = set()
    _init_bands = cluster_rows(row)
    if len(_init_bands) >= 2:
        main_band = max(_init_bands, key=lambda bd: (
            len(bd),
            sum(x["confidence"] for x in bd) / len(bd)))
        main_ids = {id(x) for x in main_band}

    def _protect(dropped_b, survivor_b) -> bool:
        """True 表示应阻止这次丢弃：被丢者是主带真书，而幸存者是次带书。"""
        return id(dropped_b) in main_ids and id(survivor_b) not in main_ids

    kept: list[dict] = []         # 按 x 中心升序
    for b in sorted(row, key=lambda b: (b["bbox"][0] + b["bbox"][2]) / 2):
        cx = (b["bbox"][0] + b["bbox"][2]) / 2
        tb = norm_title(b["title"])
        dropped = False
        neighbours = []
        for k in reversed(kept):
            kcx = (k["bbox"][0] + k["bbox"][2]) / 2
            if cx - kcx > window:
                break
            neighbours.append(k)
        # 第一遍只找"同书"合并：标题相等/互为子串/高度相似且位置相容
        for k in neighbours:
            tk = norm_title(k["title"])
            xom = _x_overlap_min(b["bbox"], k["bbox"])
            gap = max(0.0, max(b["bbox"][0], k["bbox"][0])
                      - min(b["bbox"][2], k["bbox"][2]))
            equal = bool(tb) and tb == tk
            sub = bool(tb) and bool(tk) and tb != tk and (tb in tk or tk in tb)
            sim = difflib.SequenceMatcher(None, tb, tk).ratio() if tb and tk \
                else 0.0
            shorter, longer = (tb, tk) if len(tb) <= len(tk) else (tk, tb)
            merge = False
            if xom > 0.25 and (equal or sub):
                merge = True  # 同一书脊的两次读法，x 基本对得上
            elif xom > 0.45 and sim >= 0.55:
                merge = True  # 标题高度相似且 x 大半重叠
            elif sub and gap <= gap_max \
                    and len(shorter) <= max(4, len(longer) // 2) \
                    and covered[id(b if tb == shorter else k)] > 0.3:
                # 透视漂移导致的错位片段（x 已无重叠）：只吸收"短者明显是
                # 长者片段、且短者的 x 领地已被别人覆盖（双读冗余）"的情况。
                # 等长同名（复本）绝不因 gap 合并；领地独占的短真书名
                # （如"活着"）不会被误吸。
                merge = True
            if merge:
                keep, drop = _prefer(b, k)
                if drop is k:
                    kept.remove(k)
                    kept.append(keep)
                _merge_into(keep, drop)
                dropped = True
                break
        # 第二遍：标题完全对不上但 x 大半重叠——同一书脊被读成作者署名/
        # 英文名/架标等"弱书名"，丢掉弱的一方
        if not dropped:
            for k in neighbours:
                if k not in kept:
                    continue
                tk = norm_title(k["title"])
                xom = _x_overlap_min(b["bbox"], k["bbox"])
                by_b, by_k = _is_byline(tb), _is_byline(tk)
                if by_b != by_k:
                    # 纯署名不是书名：与任何书脊 x 重叠即视为该脊的误读
                    if xom > 0.3:
                        if by_b:
                            dropped = True
                            break
                        kept.remove(k)
                    continue
                if xom <= 0.6:
                    continue
                wb, wk = _weak_title(tb), _weak_title(tk)
                if wb and wk:  # 都弱：留置信度高/书名长的
                    if (b["confidence"], len(tb)) <= (k["confidence"], len(tk)):
                        if not _protect(b, k):
                            dropped = True
                            break
                    else:
                        if not _protect(k, b):
                            kept.remove(k)
                elif wb != wk:
                    # 一弱一强：弱方基本被强方包住才丢。宽框真书（如模型把
                    # "协同进化"框成双倍宽）xom 高但并不被包住，不能误杀
                    weak_b = b if wb else k
                    strong_b = k if weak_b is b else b
                    inter = max(0.0, min(b["bbox"][2], k["bbox"][2])
                                - max(b["bbox"][0], k["bbox"][0]))
                    w_weak = weak_b["bbox"][2] - weak_b["bbox"][0]
                    if w_weak > 0 and inter / w_weak > 0.8 \
                            and not _protect(weak_b, strong_b):
                        if weak_b is b:
                            dropped = True
                            break
                        kept.remove(k)
        if not dropped:
            kept.append(b)
    # 双读行的覆盖丢弃：物理行由多个子带（同一排书的多次切块重读）构成时，
    # 最大子带视为主带；其余子带中 x 领地已被主带（合并后）基本完全覆盖
    # （>=0.8）的书，是同一书脊的误读/幻觉（标题规则兜不住的 garbled 读法，
    # 如 "务谈判" 之于 "优势谈判"、下带幻觉出的整排"社会学经典"）。
    # 主带书永不丢；次带中领地未被覆盖的书（主读漏掉的真书，如实测
    # "谈判技巧" coverage 0.52、"协同进化" 0.31）不受影响。
    if main_band is None or len(main_band) < 3:
        # 单子带（裁剪单行）或无足够主带书时不启用覆盖丢弃
        return kept
    # 主带中有些书已在前几步合并丢弃，只保留存活的计算区间
    main_kept = [b for b in main_band if id(b) in {id(k) for k in kept}]
    if len(main_kept) < 3:
        return kept
    # 主带存活的每一本都占自己的书脊区间；不做 x 膨胀。真正堵住"幻觉书掉进
    # 区间空隙"的是上面的主带保护（不让主带真书被次带幻觉书顶替吃掉），
    # 保住真实书脊区间后，次带幻觉书都会落在主带区间上被覆盖丢弃。
    intervals = sorted((b["bbox"][0], b["bbox"][2]) for b in main_kept)
    kept_ids = {id(b) for b in main_kept}
    if _DEBUG_DUMP:
        lines = ["== row n=%d main_n=%d main_kept_n=%d\n"
                 % (len(kept), len(main_band), len(main_kept)),
                 "   intervals=%s\n"
                 % ", ".join("[%.3f,%.3f]" % i for i in intervals)]
        for b in kept:
            if id(b) in kept_ids:
                continue
            nb = norm_title(b["title"])
            cov = _x_coverage(b, intervals)
            lines.append("   cov_exp=%.3f drop=%s bbox=%s '%s'\n"
                         % (cov, cov >= 0.8 or (cov < 0.05
                                                and (len(nb) <= 2
                                                     or _is_byline(nb))),
                            "[%.3f,%.3f]" % (b["bbox"][0], b["bbox"][2]),
                            b["title"]))
        with open(_DEBUG_DUMP, "a", encoding="utf-8") as fh:
            fh.writelines(lines)
    out = []
    for b in kept:
        if id(b) in kept_ids:
            out.append(b)
            continue
        cov = _x_coverage(b, intervals)
        # 次带书：x 领地已被主带（膨胀后）基本完全覆盖，是同一书脊的误读/幻觉
        # （如 "务谈判" 之于 "优势谈判"、下带幻觉出的整排"社会学经典"）；或
        # 孤立强垃圾碎片（<=2 字 / 纯署名，落在任何主带覆盖之外），一并丢弃。
        # 其余（主读漏掉、落在真实空隙里的真书，如实测"协同进化"）保留。
        nb = norm_title(b["title"])
        if cov >= 0.8 or (cov < 0.05 and (len(nb) <= 2 or _is_byline(nb))):
            continue
        out.append(b)
    return out


def dedup_row_x(books: list[dict]) -> list[dict]:
    """物理行内去重：同一排书被上下切块各读一遍时，同一本书会以
    "完整标题 + 片段/错读"的形式出现两次，且两次的 x 估计有漂移
    （实测最右端漂移可达 3 倍书宽），全局 dedup 的 iou/中心点规则
    兜不住。先把 y 带重叠的逻辑行并成物理行，再在行内按 x 序做
    判重合并与弱书名吸收。x 不重叠的同名书（复本）绝不合并。"""
    if not books:
        return books
    out: list[dict] = []
    # physical_rows 按 y 升序返回，行内 kept 按 x 升序：
    # 输出即"先行后列"的阅读顺序
    for row in physical_rows(books):
        out.extend(_dedup_one_row(row))
    return out
