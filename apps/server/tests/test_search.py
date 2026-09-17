# -*- coding: utf-8 -*-
"""多书搜索测试。"""
from conftest import auth_headers, recognize, register


def _search(client, token, queries):
    r = client.post("/api/search", json={"queries": queries},
                    headers=auth_headers(token))
    assert r.status_code == 200, r.text
    return r.json()["results"]


class TestSearch:
    def test_match_and_best(self, client):
        token = register(client, "alice")
        done = recognize(client, token)
        (res,) = _search(client, token, ["活着"])
        assert res["query"] == "活着"
        assert len(res["matches"]) >= 2  # 活着 / 活着（珍藏版）
        scores = [m["score"] for m in res["matches"]]
        assert scores == sorted(scores, reverse=True)
        # best = 置信度最高的一条：完全匹配且置信度最高的「活着」
        best = res["best"]
        assert best == max(res["matches"],
                           key=lambda m: (m["confidence"], m["score"]))
        assert best["title"] == "活着"
        assert best["record_id"] == done["id"]
        assert best["shelf"] == "A-03"
        assert 0.5 <= best["score"] <= 1.0

    def test_best_prefers_highest_confidence(self):
        """best 取置信度最高的一条，而非 score 最高的 matches[0]。"""
        from core.search import search_records
        records = [{
            "id": "r1", "name": "n", "shelf": "A-01",
            "books": [
                # 完全匹配但置信度低：score = 0.6*1 + 0.4*0.6 = 0.84
                {"title": "活着", "confidence": 0.60, "index": 1},
                # 相似度 0.5 但置信度最高：score = 0.3 + 0.4*0.99 = 0.696
                {"title": "死活", "confidence": 0.99, "index": 2},
            ],
        }]
        (res,) = search_records(records, ["活着"])
        assert res["matches"][0]["title"] == "活着"  # matches 仍按 score 降序
        assert res["best"]["title"] == "死活"  # best 取置信度最高
        assert res["best"]["confidence"] == 0.99

    def test_dirty_data_skipped(self):
        """脏数据（books 非 list、条目非 dict、confidence 为 null/字符串）跳过而非 500。"""
        from core.search import search_records
        records = [
            {"id": "r1", "books": "not-a-list"},
            {"id": "r2", "books": ["not-a-dict", None]},
            {"id": "r3", "books": [{"title": "活着", "confidence": None}]},
            {"id": "r4", "books": [{"title": "活着", "confidence": "高"}]},
            {"id": "r5", "books": [{"title": "活着", "confidence": 0.9}]},
            "not-a-dict-record",
        ]
        (res,) = search_records(records, ["活着"])
        assert len(res["matches"]) == 1
        assert res["matches"][0]["record_id"] == "r5"
        assert res["best"]["record_id"] == "r5"

    def test_no_match(self, client):
        token = register(client, "alice")
        recognize(client, token)
        (res,) = _search(client, token, ["完全不存在的冷门书名"])
        assert res["best"] is None
        assert res["matches"] == []

    def test_multiple_queries(self, client):
        token = register(client, "alice")
        recognize(client, token)
        results = _search(client, token, ["活着", "百年孤独", "不存在的书"])
        assert [r["query"] for r in results] == ["活着", "百年孤独", "不存在的书"]
        assert results[0]["best"]["title"] == "活着"
        assert results[1]["best"]["title"] == "百年孤独"
        assert results[2]["best"] is None

    def test_search_only_own_records(self, client):
        ta = register(client, "alice")
        tb = register(client, "bob")
        recognize(client, ta)
        (res,) = _search(client, tb, ["活着"])
        assert res["best"] is None

    def test_matches_capped_at_20(self, client):
        token = register(client, "alice")
        for _ in range(12):  # 12 条记录 × 每条 2 个匹配 = 24 个候选
            recognize(client, token)
        (res,) = _search(client, token, ["活着"])
        assert len(res["matches"]) <= 20

    def test_validation(self, client):
        token = register(client, "alice")
        assert client.post("/api/search", json={"queries": []},
                           headers=auth_headers(token)).status_code == 400
        assert client.post("/api/search",
                           json={"queries": ["x"] * 51},
                           headers=auth_headers(token)).status_code == 400
        assert client.post("/api/search", json={"queries": ["  "]},
                           headers=auth_headers(token)).status_code == 400
