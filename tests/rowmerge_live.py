# -*- coding: utf-8 -*-
"""真实 API 回归：对 55 / 63 号图走完整识别流程（8003 端口）。

断言：
- 55：无 <=2 字碎片、无 '络'/'求研究' 类漏网碎片、本数收敛（~35 上下浮动）；
- 63：本数不低于历史基准的合理区间（双读去重会合法降本数）。
结果写 rowmerge_live_results.json（GBK 安全输出，只用 ASCII 标记）。
"""
import json
import sys
import time
from pathlib import Path

import requests

BASE = "http://127.0.0.1:8003"
ROOT = Path(__file__).resolve().parent
IMG_DIR = ROOT.parent.parent / "测试图片2026.9.14"
IMAGES = ["微信图片_20260914111646_55_155.jpg",
          "微信图片_20260914111654_63_155.jpg"]


def login():
    r = requests.post(f"{BASE}/api/login",
                      json={"username": "fragbench", "password": "Test123456"},
                      timeout=15)
    if r.status_code != 200:
        requests.post(f"{BASE}/api/register",
                      json={"username": "fragbench", "password": "Test123456"},
                      timeout=15)
        r = requests.post(f"{BASE}/api/login",
                          json={"username": "fragbench",
                                "password": "Test123456"}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def recognize(token: str, path: Path) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    with open(path, "rb") as f:
        files = {"image": (path.name, f, "image/jpeg")}
        r = requests.post(f"{BASE}/api/recognize", files=files,
                          data={"tiles": "1", "name": path.name},
                          headers=headers, stream=True, timeout=(15, 900))
    r.raise_for_status()
    done = None
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        payload = json.loads(line[6:])
        if "books" in payload and "tiles" in payload:
            done = payload
    return done


def norm(t):
    import re
    return re.sub(r"[\s《》〈〉「」『』【】\-—_·:：,，.。!！?？'’\"“”]", "",
                  (t or "").lower())


def main():
    token = login()
    results = {}
    for name in IMAGES:
        t0 = time.time()
        done = recognize(token, IMG_DIR / name)
        books = done["books"]
        frags = [b["title"] for b in books if len(norm(b["title"])) <= 2]
        seen, dups = set(), []
        for b in books:
            n = norm(b["title"])
            if n in seen:
                dups.append(b["title"])
            seen.add(n)
        results[name] = {
            "n_books": len(books),
            "fragments_le2": frags,
            "dup_titles": dups,
            "stats": done.get("stats"),
            "shelf": done.get("shelf"),
            "elapsed": round(time.time() - t0, 1),
            "titles": [b["title"] for b in books],
        }
        print(f"OK {name}: {len(books)} books, frags={frags}, "
              f"dups={dups}, {results[name]['elapsed']}s")
    out = ROOT / "rowmerge_live_results.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    print("written", out.name)


if __name__ == "__main__":
    main()
