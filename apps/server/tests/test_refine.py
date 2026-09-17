# -*- coding: utf-8 -*-
"""行内吸附（refine）与 shelf 字段解析的测试。"""
from core.parse import parse_books
from core.refine import drop_edge_rows, majority_shelf, snap_rows


def _book(x1, y1, x2, y2, title="t", shelf=""):
    return {"title": title, "shelf": shelf,
            "bbox": [x1, y1, x2, y2], "confidence": 0.9}


class TestParseShelf:
    def test_shelf_kept(self):
        r = parse_books('[{"title":"a","shelf":"I24","bbox":[0,0,0.1,0.5]}]')
        assert r[0]["shelf"] == "I24"

    def test_shelf_missing_defaults_empty(self):
        r = parse_books('[{"title":"a","bbox":[0,0,0.1,0.5]}]')
        assert r[0]["shelf"] == ""

    def test_shelf_truncated(self):
        import json
        payload = json.dumps([{"title": "a", "shelf": "X" * 100,
                               "bbox": [0, 0, 0.1, 0.5]}])
        r = parse_books(payload)
        assert len(r[0]["shelf"]) == 40


class TestSnapRows:
    def test_bottom_edges_aligned(self):
        books = [_book(0.00, 0.2, 0.08, 0.90),
                 _book(0.09, 0.2, 0.17, 0.88),
                 _book(0.18, 0.2, 0.26, 0.92)]
        snap_rows(books)
        assert len({b["bbox"][3] for b in books}) == 1  # 底边全部对齐

    def test_overlap_snapped_to_midpoint(self):
        books = [_book(0.00, 0.2, 0.10, 0.9),
                 _book(0.06, 0.2, 0.16, 0.9),
                 _book(0.18, 0.2, 0.26, 0.9)]
        snap_rows(books)
        a, b, _ = books
        assert a["bbox"][2] == b["bbox"][0] == 0.08  # 共享中点边界

    def test_small_row_untouched(self):
        books = [_book(0.0, 0.2, 0.1, 0.9), _book(0.2, 0.2, 0.3, 0.85)]
        snap_rows(books)
        assert books[1]["bbox"][3] == 0.85  # 不足 3 本不吸附

    def test_separate_rows_not_merged(self):
        row1 = [_book(i * 0.1, 0.10, i * 0.1 + 0.08, 0.45) for i in range(3)]
        row2 = [_book(i * 0.1, 0.55, i * 0.1 + 0.08, 0.95) for i in range(3)]
        books = row1 + row2
        snap_rows(books)
        assert all(abs(b["bbox"][3] - 0.45) < 0.01 for b in row1)
        assert all(abs(b["bbox"][3] - 0.95) < 0.01 for b in row2)


class TestMajorityShelf:
    def test_mode(self):
        books = [_book(0, 0, 0.1, 0.5, shelf="I24") for _ in range(3)]
        books.append(_book(0, 0, 0.1, 0.5, shelf="A-03"))
        books.append(_book(0, 0, 0.1, 0.5))  # 空串不计
        assert majority_shelf(books) == "I24"

    def test_empty(self):
        assert majority_shelf([_book(0, 0, 0.1, 0.5)]) == ""

    def test_code_plus_name_merged(self):
        """同一架标被切块读碎：分类号与类目名应合并（用户实测场景）。"""
        books = [_book(0, 0, 0.1, 0.5, shelf="C912.22/44422") for _ in range(11)]
        books += [_book(0, 0, 0.1, 0.5, shelf="社会团体") for _ in range(19)]
        books += [_book(0, 0, 0.1, 0.5, shelf="8排6架3层") for _ in range(4)]
        assert majority_shelf(books) == "C912.22/44422 社会团体"

    def test_full_label_passthrough(self):
        """已有完整架标（包含其他高频片段）时直接取完整值。"""
        books = [_book(0, 0, 0.1, 0.5, shelf="C912.22/44422 社会团体")
                 for _ in range(5)]
        books += [_book(0, 0, 0.1, 0.5, shelf="社会团体") for _ in range(3)]
        assert majority_shelf(books) == "C912.22/44422 社会团体"

    def test_partial_code_loses_to_complete(self):
        """票数高但只读到一半分类号的值，应让位给票数够量级且更完整的值。"""
        books = [_book(0, 0, 0.1, 0.5, shelf="C912 社会团体") for _ in range(22)]
        books += [_book(0, 0, 0.1, 0.5, shelf="C912.22/44422 社会团体")
                  for _ in range(9)]
        assert majority_shelf(books) == "C912.22/44422 社会团体"


class TestDropEdgeRows:
    def test_top_and_bottom_edge_rows_dropped(self):
        """上贴边矮行 + 下贴边矮行整行丢弃，中间正常行保留。"""
        top = [_book(i * 0.1, 0.0, i * 0.1 + 0.08, 0.10) for i in range(3)]
        mid = [_book(i * 0.1, 0.30, i * 0.1 + 0.08, 0.75) for i in range(6)]
        bottom = [_book(i * 0.1, 0.90, i * 0.1 + 0.08, 1.0) for i in range(3)]
        kept, drows, dbooks = drop_edge_rows(top + mid + bottom)
        assert (drows, dbooks) == (2, 6)
        assert len(kept) == 6
        assert all(b["bbox"][1] == 0.30 for b in kept)

    def test_single_row_never_dropped(self):
        """裁剪单行场景：只有一行，高度无从比较，不过滤。"""
        books = [_book(i * 0.1, 0.0, i * 0.1 + 0.08, 0.10) for i in range(5)]
        kept, drows, dbooks = drop_edge_rows(books)
        assert (drows, dbooks) == (0, 0)
        assert len(kept) == 5

    def test_full_height_edge_row_kept(self):
        """贴边但高度完整（真书贴边拍全了）的行不丢。"""
        top = [_book(i * 0.1, 0.0, i * 0.1 + 0.08, 0.45) for i in range(5)]
        bottom = [_book(i * 0.1, 0.55, i * 0.1 + 0.08, 1.0) for i in range(5)]
        kept, drows, _ = drop_edge_rows(top + bottom)
        assert drows == 0
        assert len(kept) == 10

    def test_empty(self):
        assert drop_edge_rows([]) == ([], 0, 0)

    def test_clipped_slightly_short_row_dropped(self):
        """顶死边框且比中位高度略矮的行（0.8H < h < H）： tier2 裁断信号丢弃。

        57 号图实测形态：下半层残留高度达 0.81×H，单靠 shrink=0.8 漏网，
        但整行 y2 顶死在 1.0 说明书脊被画面裁断。
        """
        mid = [_book(i * 0.1, 0.20, i * 0.1 + 0.08, 0.60) for i in range(6)]
        bottom = [_book(i * 0.1, 0.66, i * 0.1 + 0.08, 1.0) for i in range(6)]
        # H = (0.40+0.34)/2 = 0.37，bottom med_h 0.34：> 0.8H=0.296 但 < H
        kept, drows, dbooks = drop_edge_rows(mid + bottom)
        assert (drows, dbooks) == (1, 6)
        assert len(kept) == 6
