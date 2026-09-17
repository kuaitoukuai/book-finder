# -*- coding: utf-8 -*-
"""碎片合并（core/merge.py）的规则测试。"""
from core.merge import fragment_kind, merge_fragments


def _book(title, x0, x1, y1=0.1, y2=0.9, confidence=0.9, author=""):
    return {"title": title, "author": author, "shelf": "A-1",
            "bbox": [x0, y1, x1, y2], "confidence": confidence}


class TestFragmentKind:
    def test_author_patterns(self):
        assert fragment_kind("刘碧瑛◎著") == "author"
        assert fragment_kind("张三著") == "author"
        assert fragment_kind("李四 主编".replace(" ", "")) == "author"
        assert fragment_kind("王五○编") == "author"

    def test_volume_patterns(self):
        assert fragment_kind("37") == "volume"
        assert fragment_kind("1024") == "volume"

    def test_normal_titles(self):
        assert fragment_kind("活着") == ""
        assert fragment_kind("百年孤独") == ""
        assert fragment_kind("") == ""
        assert fragment_kind("123456") == ""  # 超过 4 位不算卷数


class TestMergeAuthor:
    def test_author_merges_into_left(self):
        books = [_book("儿童社交退缩 发展规律与干预", 0.10, 0.16),
                 _book("刘碧瑛◎著", 0.165, 0.19)]
        out = merge_fragments(books)
        assert len(out) == 1
        assert out[0]["author"] == "刘碧瑛"
        # bbox 取并集，confidence 取均值
        assert out[0]["bbox"][0] == 0.10 and out[0]["bbox"][2] == 0.19

    def test_author_merges_into_right_when_no_left(self):
        books = [_book("王敏芝◎著", 0.10, 0.13),
                 _book("『云交往』数字时代的交往与文化", 0.135, 0.20)]
        out = merge_fragments(books)
        assert len(out) == 1
        assert out[0]["title"] == "『云交往』数字时代的交往与文化"
        assert out[0]["author"] == "王敏芝"

    def test_existing_author_not_overwritten(self):
        books = [_book("甲书", 0.10, 0.16, author="余华"),
                 _book("刘碧瑛◎著", 0.165, 0.19)]
        out = merge_fragments(books)
        assert len(out) == 2, "目标已有 author 时应保留碎片"
        assert out[0]["author"] == "余华"


class TestMergeVolume:
    def test_volume_appended_to_title(self):
        books = [_book("下一个十年社会的礼物", 0.10, 0.16),
                 _book("37", 0.165, 0.19)]
        out = merge_fragments(books)
        assert len(out) == 1
        assert out[0]["title"] == "下一个十年社会的礼物 37"


class TestMergeGuard:
    def test_no_neighbor_no_merge(self):
        """孤立碎片（与最近的书间隙过大）不合并。"""
        books = [_book("活着", 0.10, 0.16),
                 _book("37", 0.60, 0.63)]
        out = merge_fragments(books)
        assert len(out) == 2

    def test_cross_row_no_merge(self):
        """跨行的碎片不合并。"""
        books = [_book("活着", 0.10, 0.16, y1=0.05, y2=0.45),
                 _book("37", 0.165, 0.19, y1=0.55, y2=0.95)]
        out = merge_fragments(books)
        assert len(out) == 2

    def test_half_sentence_kept(self):
        """书名片段类碎片（如"与干预"）不做激进合并。"""
        books = [_book("儿童社交退缩 发展规律", 0.10, 0.16),
                 _book("与干预", 0.165, 0.19)]
        out = merge_fragments(books)
        assert len(out) == 2

    def test_confidence_averaged(self):
        books = [_book("活着", 0.10, 0.16, confidence=0.9),
                 _book("37", 0.165, 0.19, confidence=0.7)]
        out = merge_fragments(books)
        assert abs(out[0]["confidence"] - 0.8) < 1e-9

    def test_empty_and_passthrough(self):
        assert merge_fragments([]) == []
        books = [_book("活着", 0.10, 0.16), _book("百年孤独", 0.20, 0.26)]
        assert len(merge_fragments(books)) == 2
