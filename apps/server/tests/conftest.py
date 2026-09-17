import io
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main
from core import auth, vision


@pytest.fixture(autouse=True)
def _clear_rate_limit():
    """限流状态是进程级全局，测试间必须隔离，否则余量耗尽会出现随机 429。"""
    main._RATE_HITS.clear()
    yield
    main._RATE_HITS.clear()


FAKE_VISION_RAW = json.dumps([
    {"title": "活着", "shelf": "A-03", "bbox": [0.10, 0.10, 0.18, 0.90],
     "confidence": 0.90},
    {"title": "活着（珍藏版）", "shelf": "A-03", "bbox": [0.20, 0.10, 0.28, 0.90],
     "confidence": 0.70},
    {"title": "百年孤独", "shelf": "A-03", "bbox": [0.30, 0.10, 0.38, 0.90],
     "confidence": 0.80},
], ensure_ascii=False)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """隔离的测试客户端：临时 results 目录、临时数据库、假视觉接口。"""
    results = tmp_path / "results"
    results.mkdir()
    monkeypatch.setattr(main, "RESULTS_DIR", results)
    monkeypatch.setattr(auth, "DB_PATH", tmp_path / "app.db")
    monkeypatch.setattr(main, "SECRET", "test-secret")
    auth.init_db()

    def fake_call_vision(image_bytes, **kw):
        return FAKE_VISION_RAW

    monkeypatch.setattr(vision, "call_vision", fake_call_vision)
    monkeypatch.setattr(main, "call_vision", fake_call_vision)
    return TestClient(main.app)


def make_image(w=800, h=600, color=(120, 80, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="JPEG")
    return buf.getvalue()


def parse_sse_event(text: str, event: str):
    marker = f"event: {event}\ndata: "
    idx = text.find(marker)
    if idx == -1:
        return None
    start = idx + len(marker)
    end = text.find("\n", start)
    return json.loads(text[start:end])


def register(client, username, password="pass123") -> str:
    r = client.post("/api/register",
                    json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def auth_headers(token) -> dict:
    return {"Authorization": f"Bearer {token}"}


def recognize(client, token, filename="test.jpg", img_bytes=None, **data) -> dict:
    """走完整识别流程，返回 done 事件的记录 JSON。"""
    files = {"image": (filename, img_bytes or make_image(), "image/jpeg")}
    r = client.post("/api/recognize", files=files, data=data,
                    headers=auth_headers(token))
    assert r.status_code == 200, r.text
    done = parse_sse_event(r.text, "done")
    assert done, r.text
    return done
