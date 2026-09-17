# -*- coding: utf-8 -*-
"""识别前裁剪（crop）测试。"""
import io

import pytest
from PIL import Image

from conftest import (auth_headers, make_image, parse_sse_event, recognize,
                      register)


def _recognize_raw(client, token, crop, w=800, h=600):
    files = {"image": ("crop.jpg", make_image(w, h), "image/jpeg")}
    return client.post("/api/recognize", files=files,
                       data={"crop": crop}, headers=auth_headers(token))


class TestCrop:
    def test_crop_valid(self, client):
        token = register(client, "alice")
        r = _recognize_raw(client, token, "0,0,0.5,0.5")
        assert r.status_code == 200, r.text
        meta = parse_sse_event(r.text, "meta")
        done = parse_sse_event(r.text, "done")
        assert (meta["width"], meta["height"]) == (400, 300)
        assert (done["width"], done["height"]) == (400, 300)
        # bbox 坐标以裁剪后图片为准（归一化，仍在 0~1 内）
        for b in done["books"]:
            assert all(0 <= v <= 1 for v in b["bbox"])

    def test_crop_saved_image(self, client):
        """保存的 image.jpg 是裁剪后的图。"""
        token = register(client, "alice")
        r = _recognize_raw(client, token, "0.25,0.25,0.75,0.75")
        done = parse_sse_event(r.text, "done")
        img_bytes = client.get(f"/results/{done['id']}/image.jpg",
                               params={"token": token}).content
        assert Image.open(io.BytesIO(img_bytes)).size == (400, 300)

    def test_crop_reduces_tiles(self, client):
        """裁剪后图变小，切块数随之减少（需显式开启大图切块）。"""
        token = register(client, "alice")
        before = lambda crop: client.post(
            "/api/recognize",
            files={"image": ("crop.jpg", make_image(4000, 2000), "image/jpeg")},
            data={"crop": crop, "tiles": "1"},
            headers=auth_headers(token))
        full = before("").text
        cropped = before("0,0,1,0.4").text
        n_full = parse_sse_event(full, "meta")["tiles_total"]
        n_crop = parse_sse_event(cropped, "meta")["tiles_total"]
        assert n_full > 1
        assert n_crop < n_full

    @pytest.mark.parametrize("crop", [
        "abc",                 # 非数字
        "0.1,0.1,0.5",         # 数量不对
        "0.5,0,0.4,1",         # x0 >= x1
        "0,0,1.2,1",           # 越界
        "-0.1,0,0.5,0.5",      # 负值
        "0,0,0.05,0.1",        # 面积 0.5% < 1%
    ])
    def test_crop_invalid(self, client, crop):
        token = register(client, "alice")
        r = _recognize_raw(client, token, crop)
        assert r.status_code == 400
        assert "detail" in r.json()

    def test_crop_requires_auth(self, client):
        files = {"image": ("c.jpg", make_image(), "image/jpeg")}
        r = client.post("/api/recognize", files=files,
                        data={"crop": "0,0,0.5,0.5"})
        assert r.status_code == 401

    def test_no_crop_unchanged(self, client):
        """不传 crop 时保持 V2 行为：整图识别。"""
        token = register(client, "alice")
        done = recognize(client, token)
        assert (done["width"], done["height"]) == (800, 600)
        assert len(done["books"]) == 3
        assert done["shelf"] == "A-03"
