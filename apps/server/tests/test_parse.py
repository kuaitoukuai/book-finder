# -*- coding: utf-8 -*-
"""解析器与切块去重的对抗性测试（移植自 v1 的 17 项用例）。"""
from core.parse import parse_books
from core.tiles import dedup, make_tiles


class TestParseBooks:
    def test_markdown_fence(self):
        r = parse_books('```json\n[{"title":"a","bbox":[0.1,0.1,0.2,0.5],"confidence":0.9}]\n```')
        assert len(r) == 1

    def test_surrounding_prose(self):
        assert len(parse_books('好的：[{"title":"a","bbox":[0,0,0.1,0.5]}] 希望有帮助')) == 1

    def test_empty(self):
        assert parse_books('') == []

    def test_no_array(self):
        assert parse_books('抱歉我无法识别') == []

    def test_truncated(self):
        r = parse_books('[{"title":"a","bbox":[0,0,0.1,0.5]},{"title":"b","bbox":[0.2,0,0.3,0.5],"conf')
        assert len(r) == 1 and r[0]["title"] == "a"

    def test_missing_bbox(self):
        assert parse_books('[{"title":"a"}]') == []

    def test_string_bbox(self):
        assert parse_books('[{"title":"a","bbox":"xyz"}]') == []

    def test_non_dict_items(self):
        assert parse_books('["just a string", 42, null]') == []

    def test_null_title(self):
        assert parse_books('[{"title":null,"bbox":[0,0,0.1,0.5]}]')[0]["title"] == ""

    def test_long_title_truncated(self):
        r = parse_books('[{"title":"' + 'x' * 500 + '","bbox":[0,0,0.1,0.5]}]')
        assert len(r[0]["title"]) == 120

    def test_bbox_0_1000_scale(self):
        r = parse_books('[{"title":"a","bbox":[100,200,150,800],"confidence":95}]')
        assert abs(r[0]["bbox"][0] - 0.1) < 0.001
        assert abs(r[0]["confidence"] - 0.95) < 0.001

    def test_bbox_0_100_scale(self):
        r = parse_books('[{"title":"a","bbox":[10,20,15,80]}]')
        assert abs(r[0]["bbox"][0] - 0.1) < 0.001

    def test_inverted_coords(self):
        r = parse_books('[{"title":"a","bbox":[0.9,0.9,0.1,0.1]}]')
        assert r[0]["bbox"] == [0.1, 0.1, 0.9, 0.9]

    def test_degenerate_box_dropped(self):
        assert parse_books('[{"title":"a","bbox":[0.5,0.5,0.501,0.501]}]') == []

    def test_out_of_range_clamped(self):
        r = parse_books('[{"title":"a","bbox":[-0.5,-0.5,1.5,1.5]}]')
        assert r[0]["bbox"] == [0.0, 0.0, 1.0, 1.0]

    def test_author_parsed(self):
        r = parse_books('[{"title":"活着","author":"余华",'
                        '"bbox":[0,0,0.1,0.5]}]')
        assert r[0]["author"] == "余华"

    def test_author_default_empty(self):
        r = parse_books('[{"title":"a","bbox":[0,0,0.1,0.5]}]')
        assert r[0]["author"] == ""

    def test_author_non_string_dropped(self):
        r = parse_books('[{"title":"a","author":123,"bbox":[0,0,0.1,0.5]}]')
        assert r[0]["author"] == ""

    def test_author_too_long_dropped(self):
        r = parse_books('[{"title":"a","author":"' + 'x' * 50 + '",'
                        '"bbox":[0,0,0.1,0.5]}]')
        assert r[0]["author"] == ""


class TestDedup:
    BOOKS = [
        {"title": "幽默社交", "bbox": [0.1, 0.1, 0.15, 0.8], "confidence": 0.9},
        {"title": "幽默社交", "bbox": [0.11, 0.1, 0.16, 0.8], "confidence": 0.95},
        {"title": "别的书", "bbox": [0.5, 0.1, 0.55, 0.8], "confidence": 0.8},
    ]

    def test_overlap_dedup(self):
        assert len(dedup(self.BOOKS)) == 2

    def test_keeps_higher_confidence(self):
        kept = [b for b in dedup(self.BOOKS) if b["title"] == "幽默社交"]
        assert kept[0]["confidence"] == 0.95


class TestMakeTiles:
    def test_small_image_single_tile(self):
        assert make_tiles(800, 600) == [(0, 0, 800, 600)]

    def test_large_image_multi_tile(self):
        assert len(make_tiles(4096, 2304)) >= 4

    def test_tile_size_within_limit(self):
        for x0, y0, x1, y1 in make_tiles(4096, 2304):
            assert (x1 - x0) <= 1600 * 1.16
            assert (y1 - y0) <= 1600 * 1.16

    def test_full_coverage(self):
        tiles = make_tiles(4096, 2304)
        assert any(t[0] == 0 and t[1] == 0 for t in tiles)
        assert any(t[2] == 4096 and t[3] == 2304 for t in tiles)

    def test_zero_size(self):
        assert make_tiles(0, 0) == [(0, 0, 0, 0)]


class TestDedupCrossTile:
    """跨切块重复的新规则（55 号图实测碎片形态）。"""

    def test_substring_title_y_shifted(self):
        """同一书脊被上下切块各读一次：完整名 vs 片段，y 偏移半格。"""
        full = {"title": "高效务实——非营利组织项目管理指南",
                "bbox": [0.112, 0.117, 0.136, 0.574], "confidence": 0.90}
        frag = {"title": "非营利组织项目管理指南",
                "bbox": [0.091, 0.426, 0.125, 0.777], "confidence": 0.99}
        out = dedup([frag, full])
        assert len(out) == 1
        # 保留 title 更长的，即使 confidence 更低
        assert out[0]["title"] == "高效务实——非营利组织项目管理指南"

    def test_center_containment(self):
        """一框中心落入另一框且 y 中心接近：大小不一的同一本书。"""
        tall = {"title": "活着", "bbox": [0.10, 0.10, 0.16, 0.90],
                "confidence": 0.9}
        cross = {"title": "活着", "bbox": [0.08, 0.30, 0.30, 0.60],
                 "confidence": 0.8}
        # iou/overlap 都低于旧阈值
        from core.tiles import iou, _overlap_min
        assert iou(tall["bbox"], cross["bbox"]) < 0.3
        assert _overlap_min(tall["bbox"], cross["bbox"]) < 0.5
        assert len(dedup([tall, cross])) == 1

    def test_author_carried_over(self):
        a = {"title": "活着", "bbox": [0.10, 0.10, 0.16, 0.90],
             "confidence": 0.9}
        b = {"title": "活着", "bbox": [0.105, 0.12, 0.155, 0.88],
             "confidence": 0.8, "author": "余华"}
        out = dedup([a, b])
        assert len(out) == 1
        assert out[0].get("author") == "余华"

    def test_side_by_side_reprints_kept(self):
        """同排并放的两本复本（同名但 x 不重叠）不误伤。"""
        a = {"title": "活着", "bbox": [0.10, 0.10, 0.16, 0.90],
             "confidence": 0.9}
        b = {"title": "活着", "bbox": [0.19, 0.10, 0.25, 0.90],
             "confidence": 0.85}
        assert len(dedup([a, b])) == 2

    def test_same_title_other_row_kept(self):
        """上下两排同列的同名书（y 不重叠）不误伤。"""
        a = {"title": "活着", "bbox": [0.10, 0.05, 0.16, 0.45],
             "confidence": 0.9}
        b = {"title": "活着", "bbox": [0.10, 0.55, 0.16, 0.95],
             "confidence": 0.85}
        assert len(dedup([a, b])) == 2

    def test_short_substring_not_merged(self):
        """单字互为子串（长度<2）不触发标题包含规则。"""
        a = {"title": "家", "bbox": [0.10, 0.05, 0.16, 0.45],
             "confidence": 0.9}
        b = {"title": "国家", "bbox": [0.105, 0.50, 0.155, 0.95],
             "confidence": 0.85}
        assert len(dedup([a, b])) == 2
