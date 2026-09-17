# -*- coding: utf-8 -*-
"""记录删除接口测试：DELETE /api/results/{rid} 与 POST /api/results/delete_all。"""
from conftest import auth_headers, recognize, register


def _results(client, token):
    r = client.get("/api/results", headers=auth_headers(token))
    assert r.status_code == 200
    return r.json()


class TestDeleteResult:
    def test_delete_own(self, client):
        token = register(client, "alice")
        done = recognize(client, token)
        r = client.delete(f"/api/results/{done['id']}",
                          headers=auth_headers(token))
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_delete_other_user_404(self, client):
        ta = register(client, "alice")
        tb = register(client, "bob")
        done_b = recognize(client, tb)
        r = client.delete(f"/api/results/{done_b['id']}",
                          headers=auth_headers(ta))
        assert r.status_code == 404

    def test_delete_nonexistent_404(self, client):
        token = register(client, "alice")
        r = client.delete("/api/results/20260101_000000_099",
                          headers=auth_headers(token))
        assert r.status_code == 404

    def test_delete_bad_rid_404(self, client):
        token = register(client, "alice")
        r = client.delete("/api/results/bad-rid",
                          headers=auth_headers(token))
        assert r.status_code == 404

    def test_delete_requires_auth(self, client):
        token = register(client, "alice")
        done = recognize(client, token)
        r = client.delete(f"/api/results/{done['id']}")
        assert r.status_code == 401

    def test_after_delete_detail_and_image_404(self, client):
        token = register(client, "alice")
        done = recognize(client, token)
        rid = done["id"]
        assert client.delete(f"/api/results/{rid}",
                             headers=auth_headers(token)).status_code == 200
        assert client.get(f"/api/results/{rid}",
                          headers=auth_headers(token)).status_code == 404
        assert client.get(f"/results/{rid}/image.jpg",
                          params={"token": token}).status_code == 404

    def test_after_delete_gone_from_list_and_search(self, client):
        token = register(client, "alice")
        done = recognize(client, token)
        client.delete(f"/api/results/{done['id']}", headers=auth_headers(token))
        assert _results(client, token) == []
        r = client.post("/api/search", json={"queries": ["活着"]},
                        headers=auth_headers(token))
        assert r.json()["results"][0]["best"] is None


class TestDeleteAll:
    def test_delete_all_only_own(self, client):
        ta = register(client, "alice")
        tb = register(client, "bob")
        recognize(client, ta)
        recognize(client, ta)
        done_b = recognize(client, tb)

        r = client.post("/api/results/delete_all", headers=auth_headers(ta))
        assert r.status_code == 200
        assert r.json() == {"ok": True, "deleted": 2}
        assert _results(client, ta) == []
        # bob 的记录不受影响
        assert [d["id"] for d in _results(client, tb)] == [done_b["id"]]

    def test_delete_all_empty(self, client):
        token = register(client, "alice")
        r = client.post("/api/results/delete_all", headers=auth_headers(token))
        assert r.json() == {"ok": True, "deleted": 0}

    def test_delete_all_requires_auth(self, client):
        assert client.post("/api/results/delete_all").status_code == 401
