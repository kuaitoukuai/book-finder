# -*- coding: utf-8 -*-
"""边缘半层过滤的真实 API 验证。

- 57 号图（上下边缘各切进半层）：断言结果中没有 y2<0.30 的书（上半层）
  和 y1>0.75 的书（下半层），中间层书数与 fragment_benchmark 结果对比。
- 55、63 号图：确认不过滤误伤（dropped_edge_rows 应为 0 或书数不异常减少）。
结果写 edge_filter_results.json。
"""
import json
import sys
import time
from pathlib import Path

import requests

BASE = "http://127.0.0.1:8003"
USERNAME = "fragbench"
PASSWORD = "Test123456"

TESTS_DIR = Path(__file__).resolve().parent
IMG_DIR = TESTS_DIR / "dataset"
OUT_PATH = TESTS_DIR / "edge_filter_results.json"

IMG_MAIN = "微信图片_20260914111649_57_155.jpg"
IMG_CHECK = ["微信图片_20260914111646_55_155.jpg",
             "微信图片_20260914111654_63_155.jpg"]


def log(msg):
    print(time.strftime("[%H:%M:%S]"), msg, flush=True)


def get_token() -> str:
    r = requests.post(f"{BASE}/api/login",
                      json={"username": USERNAME, "password": PASSWORD},
                      timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def recognize(token: str, img_path: Path) -> dict:
    t0 = time.time()
    with open(img_path, "rb") as f:
        files = {"image": (img_path.name, f, "image/jpeg")}
        r = requests.post(f"{BASE}/api/recognize", files=files,
                          data={"tiles": "1", "name": img_path.name},
                          headers={"Authorization": f"Bearer {token}"},
                          stream=True, timeout=(15, 900))
    out = {"done": None, "error": None}
    event = None
    try:
        r.raise_for_status()
        for raw in r.iter_lines():
            if not raw:
                continue
            line = raw.decode("utf-8")
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: ") and event:
                payload = json.loads(line[6:])
                if event == "done":
                    out["done"] = payload
                elif event == "error":
                    out["error"] = payload.get("error", "unknown")
    finally:
        r.close()
    out["elapsed"] = round(time.time() - t0, 1)
    return out


def main():
    token = get_token()
    prev = json.loads(
        (TESTS_DIR / "fragment_benchmark_results.json").read_text("utf-8"))
    results = {}

    for name in [IMG_MAIN, *IMG_CHECK]:
        log(f"{name} 识别...")
        res = recognize(token, IMG_DIR / name)
        if res["error"] or not res["done"]:
            results[name] = {"error": res["error"] or "无 done 事件"}
            log(f"  失败: {results[name]['error']}")
            continue
        done = res["done"]
        books = done["books"]
        stats = done.get("stats", {})
        entry = {
            "n_books": len(books),
            "stats": stats,
            "shelf": done.get("shelf", ""),
            "elapsed": res["elapsed"],
            "prev_n_books": prev[name]["n_books"],
            "top_edge_books": sum(1 for b in books if b["bbox"][3] < 0.30),
            "bottom_edge_books": sum(1 for b in books if b["bbox"][1] > 0.75),
            "books": [{"title": b.get("title", ""), "bbox": b["bbox"]}
                      for b in books],
        }
        results[name] = entry
        log(f"  {entry['n_books']} 本(此前 {entry['prev_n_books']}), "
            f"丢边缘行 {stats.get('dropped_edge_rows')} 行 "
            f"{stats.get('dropped_edge_books')} 本, "
            f"上缘残留 {entry['top_edge_books']}, 下缘残留 "
            f"{entry['bottom_edge_books']}, 架标 [{entry['shelf']}]")

    OUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2),
                        encoding="utf-8")

    main_res = results.get(IMG_MAIN, {})
    assert main_res.get("top_edge_books") == 0, "上半层书未被过滤干净"
    assert main_res.get("bottom_edge_books") == 0, "下半层书未被过滤干净"
    log("57 号图断言通过：上/下半层书均已过滤")
    log("结果见 " + str(OUT_PATH))


if __name__ == "__main__":
    sys.exit(main())
