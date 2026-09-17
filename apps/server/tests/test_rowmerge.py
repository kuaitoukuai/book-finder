# -*- coding: utf-8 -*-
"""物理行合并（refine.physical_rows）与行内 x 去重（tiles.dedup_row_x）的测试。

背景：整图被上下切块各读一遍时，同一排书产生两个 y 带部分重叠的逻辑行，
同一本书以"完整标题 + 片段/错读"重复出现，且两次的 x 估计有透视漂移。
"""
from core.refine import physical_rows
from core.tiles import dedup_row_x


def _book(x1, y1, x2, y2, title="t", conf=0.9, author="", source=""):
    return {"title": title, "author": author, "shelf": "", "source": source,
            "bbox": [x1, y1, x2, y2], "confidence": conf}


def _row(x_positions, y1, y2):
    return [_book(x1, y1, x2, y2, title=f"书名{i}")
            for i, (x1, x2) in enumerate(x_positions)]


class TestPhysicalRows:
    def test_overlapping_bands_merge(self):
        # 55 号图实测：同一物理行被上下切块各读一遍，
        # 两逻辑行带 [0.12,0.57] 与 [0.43,0.78]，重叠度 0.42
        xs = [(i * 0.05, i * 0.05 + 0.03) for i in range(4)]
        books = _row(xs, 0.12, 0.57) + _row(xs, 0.43, 0.78)
        rows = physical_rows(books)
        assert len(rows) == 1 and len(rows[0]) == 8

    def test_adjacent_real_rows_not_merged(self):
        xs = [(i * 0.05, i * 0.05 + 0.03) for i in range(4)]
        books = _row(xs, 0.05, 0.35) + _row(xs, 0.45, 0.75)
        rows = physical_rows(books)
        assert len(rows) == 2

    def test_chain_merge(self):
        # 中间行带搭桥，三条带链式并成一条物理行
        xs = [(i * 0.05, i * 0.05 + 0.03) for i in range(3)]
        books = (_row(xs, 0.10, 0.50) + _row(xs, 0.30, 0.70)
                 + _row(xs, 0.55, 0.80))
        assert len(physical_rows(books)) == 1


class TestDedupRowX:
    def test_fragment_absorbed_with_x_drift(self):
        # 55 实测：碎片 "络" 与父书名 x 已无重叠（透视漂移），靠 gap 吸收
        books = [_book(0.714, 0.2, 0.733, 0.6, "练达 如何成为社交高手"),
                 _book(0.722, 0.4, 0.745, 0.78, "络", conf=0.85),
                 _book(0.775, 0.14, 0.794, 0.6, "论关系与关系网络")]
        out = dedup_row_x(books)
        titles = [b["title"] for b in out]
        assert "络" not in titles
        assert "论关系与关系网络" in titles

    def test_reverse_absorption(self):
        # 碎片按 x 序排在完整书之前：后到的完整书反向吸收先到的碎片
        # （碎片领地已被邻书覆盖，模拟双读行的真实情形）
        books = [_book(0.665, 0.2, 0.691, 0.6, "幽默社交"),
                 _book(0.676, 0.4, 0.694, 0.78, "为社交高手", conf=0.85),
                 _book(0.714, 0.2, 0.733, 0.6, "练达 如何成为社交高手")]
        out = dedup_row_x(books)
        titles = [b["title"] for b in out]
        assert "为社交高手" not in titles
        assert "练达 如何成为社交高手" in titles
        assert "幽默社交" in titles

    def test_short_real_book_not_absorbed(self):
        # 领地独占的短真书名（"活着"紧邻"活着（珍藏版）"）不是碎片，不能误吸
        books = [_book(0.10, 0.1, 0.18, 0.9, "活着", conf=0.9),
                 _book(0.20, 0.1, 0.28, 0.9, "活着（珍藏版）", conf=0.7),
                 _book(0.30, 0.1, 0.38, 0.9, "百年孤独", conf=0.8)]
        out = dedup_row_x(books)
        assert len(out) == 3

    def test_copies_never_merged(self):
        # 复本：同名但 x 不重叠，绝不合并（包括相邻紧挨的两份）
        books = [_book(0.10, 0.2, 0.14, 0.6, "幽默社交"),
                 _book(0.14, 0.2, 0.18, 0.6, "幽默社交", conf=0.95),
                 _book(0.40, 0.2, 0.44, 0.6, "幽默社交")]
        out = dedup_row_x(books)
        assert sum(1 for b in out if b["title"] == "幽默社交") == 3

    def test_substring_same_spine_merged(self):
        # 同一书脊两次读法：x 重叠一半，标题互为子串，留长的
        books = [_book(0.110, 0.1, 0.132, 0.57, "高效务实——非营利组织项目管理指南"),
                 _book(0.121, 0.4, 0.148, 0.78, "非营利组织项目管理指南")]
        out = dedup_row_x(books)
        assert [b["title"] for b in out] == ["高效务实——非营利组织项目管理指南"]

    def test_author_transferred_on_merge(self):
        books = [_book(0.110, 0.1, 0.132, 0.57, "高效务实——非营利组织项目管理指南"),
                 _book(0.121, 0.4, 0.148, 0.78, "非营利组织项目管理指南",
                       author="王五")]
        out = dedup_row_x(books)
        assert out[0]["author"] == "王五"

    def test_byline_dropped(self):
        # 书脊底部的作者署名被误读成书名：x 重叠即丢
        books = [_book(0.284, 0.1, 0.305, 0.57, "社交三力", conf=0.95),
                 _book(0.300, 0.4, 0.320, 0.78, "刘碧瑛◎著"),
                 _book(0.305, 0.1, 0.331, 0.57, "关系何以强弱——批判格兰诺维特",
                       conf=0.95)]
        out = dedup_row_x(books)
        titles = [b["title"] for b in out]
        assert "刘碧瑛◎著" not in titles and len(out) == 2

    def test_wide_real_book_not_killed(self):
        # 63 实测：宽框真书 "协同进化" 包住窄框真书，xom 高但不被对方包住，
        # 两本都必须保留
        books = [_book(0.343, 0.24, 0.385, 0.57, "协同进化", conf=0.95),
                 _book(0.363, 0.42, 0.385, 0.79, "GPT 生成式人工智能的应用与前沿")]
        out = dedup_row_x(books)
        titles = {b["title"] for b in out}
        assert "协同进化" in titles
        assert "GPT 生成式人工智能的应用与前沿" in titles

    def test_english_reread_dropped_when_contained(self):
        # 同一书脊的英文重读：基本被中文书名的框包住才丢
        books = [_book(0.386, 0.12, 0.408, 0.57, "『云交往』数字时代的交往与文化",
                       conf=0.95),
                 _book(0.387, 0.42, 0.407, 0.78, "SOCIALIZATION INTO INSIGHTS")]
        out = dedup_row_x(books)
        assert [b["title"] for b in out] == ["『云交往』数字时代的交往与文化"]

    def test_real_rows_independent(self):
        # 上下两排真书，即使标题互为子串也不跨排合并
        books = [_book(0.10, 0.05, 0.15, 0.35, "活着"),
                 _book(0.10, 0.45, 0.18, 0.75, "活着不是给别人看的")]
        out = dedup_row_x(books)
        assert len(out) == 2

    def test_output_order_row_then_x(self):
        books = [_book(0.30, 0.45, 0.35, 0.75, "下排右"),
                 _book(0.10, 0.45, 0.15, 0.75, "下排左"),
                 _book(0.20, 0.05, 0.25, 0.35, "上排右"),
                 _book(0.02, 0.05, 0.07, 0.35, "上排左")]
        out = dedup_row_x(books)
        assert [b["title"] for b in out] == ["上排左", "上排右", "下排左", "下排右"]


class TestCoverageDrop:
    """不对称双读：次带中 x 领地被主带全覆盖的误读书丢弃。"""

    def _double_read(self, junk):
        xs = [(0.05 + i * 0.06, 0.09 + i * 0.06) for i in range(8)]
        main = _row(xs, 0.10, 0.55)  # 主带 8 本完整
        return main + junk

    def test_covered_secondary_junk_dropped(self):
        # 次带 3 本错读（长标题、与主带书名无子串关系），x 领地完全落在
        # 主带书的区间内（55 实测的"务谈判/社会学的邀请"式垃圾）
        junk = [_book(0.115, 0.42, 0.145, 0.78, "社会学的邀请"),
                _book(0.235, 0.42, 0.265, 0.78, "应用社会学"),
                _book(0.355, 0.42, 0.385, 0.78, "格调社会等级与生活品味")]
        out = dedup_row_x(self._double_read(junk))
        assert len(out) == 8
        assert all(b["title"].startswith("书名") for b in out)

    def test_uncovered_secondary_real_book_kept(self):
        # 次带书落在主带 x 空档里（主读漏掉的真书），保留
        junk = [_book(0.095, 0.42, 0.115, 0.78, "谈判技巧 菜鸟谈判进阶的八大要领")]
        # 主带在 0.09~0.12 处留缝
        xs = [(0.05, 0.09), (0.12, 0.15)] + \
             [(0.05 + i * 0.06, 0.09 + i * 0.06) for i in range(2, 8)]
        main = _row(xs, 0.10, 0.55)
        out = dedup_row_x(main + junk)
        assert any("谈判技巧" in b["title"] for b in out)
        assert len(out) == 9

    def test_symmetric_double_read_no_coverage_drop(self):
        # 对称双读中，次带书只被主带部分覆盖（0.75 < 0.8）：保留
        xs = [(0.05 + i * 0.06, 0.09 + i * 0.06) for i in range(6)]
        upper = [_book(x1, 0.10, x2, 0.55, title=f"人类文明史第{i}卷")
                 for i, (x1, x2) in enumerate(xs)]
        lower = [_book(x1 + 0.01, 0.42, x2 + 0.01, 0.78, title=f"量子计算导论{i}")
                 for i, (x1, x2) in enumerate(xs)]
        out = dedup_row_x(upper + lower)
        assert len(out) == 12

    def test_main_short_book_not_replaced_by_hallucination(self):
        # 55 实测：主带 4 字真书"社交三力"差点被次带幻觉"乌合之众"（同一 x 位置、
        # 更长标题）顶替，然后乌合之众又被覆盖丢弃，导致真书一起消失。
        # 主带保护应把真书留下、把幻觉书按覆盖丢弃。
        main = [_book(0.262, 0.21, 0.283, 0.574, "漫画 拒绝", 0.95),
                _book(0.283, 0.21, 0.306, 0.574, "社交三力", 0.95),
                _book(0.306, 0.21, 0.332, 0.574, "关系何以强弱——批判格兰诺维特",
                      0.95)]
        junk = _book(0.283, 0.425, 0.304, 0.777,
                     "乌合之众：群体心理研究", 0.92)
        out = dedup_row_x(main + [junk])
        titles = {b["title"] for b in out}
        assert "社交三力" in titles
        assert "乌合之众：群体心理研究" not in titles
        assert len(out) == 3

    def test_uncovered_garbage_fragment_dropped(self):
        # 次带落在主带覆盖之外的孤立 <=2 字碎片（63 实测的"法"）是噪音，丢弃；
        # 但落在空隙里的长真书（如"AI新生"）仍保留。
        main = [_book(0.05, 0.10, 0.13, 0.60, "人工智能导论", 0.9),
                _book(0.15, 0.10, 0.23, 0.60, "机器学习", 0.9),
                _book(0.25, 0.10, 0.33, 0.60, "深度学习", 0.9),
                _book(0.60, 0.42, 0.64, 0.78, "AI新生", 0.9)]
        frag = _book(0.70, 0.42, 0.72, 0.78, "法", 0.85)
        out = dedup_row_x(main + [frag])
        titles = {b["title"] for b in out}
        assert "法" not in titles
        assert "AI新生" in titles
        assert len(out) == 4
