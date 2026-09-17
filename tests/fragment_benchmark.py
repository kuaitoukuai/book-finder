# -*- coding: utf-8 -*-
"""碎片治理真实 API 回归：两遍识别（整图框架 + 切块细节）+ author 字段。

对 tests/dataset/ 的 9 张图各跑一次完整两遍识别（tiles=1），统计：
  - 总书数（对照 manifest 的 full_books_range）
  - 碎片数（结果里仍匹配作者形态/纯数字的 title 数量）
  - 架标是否与 manifest 一致
  - stats（frame_count / detail_count / filled）验证两遍流程
结果增量写入 fragment_benchmark_results.json。
"""
import json
import re
import sys
import time
from pathlib import Path

import requests

BASE = "http://127.0.0.1:8003"
USERNAME = "fragbench"
PASSWORD = "Test123456"

TESTS_DIR = Path(__file__).resolve().parent
IMG_DIR = TESTS_DIR / "dataset"
OUT_PATH = TESTS_DIR / "fragment_benchmark_results.json"

AUTHOR_RE = re.compile(r"^[一-龥]{2,4}[◎○]?(著|主编|编著|编|绘)$")
VOLUME_RE = re.compile(r"^\d{1,4}$")


def count_fragments(books) -> int:
    return sum(1 for b in books
               if AUTHOR_RE.match((b.get("title") or "").strip())
               or VOLUME_RE.match((b.get("title") or "").strip()))


def log(msg):
    print(time.strftime("[%H:%M:%S]"), msg, flush=True)


def get_token() -> str:
    r = requests.post(f"{BASE}/api/login",
                      json={"username": USERNAME, "password": PASSWORD},
                      timeout=15)
    if r.status_code == 401:
        r = requests.post(f"{BASE}/api/register",
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
    out = {"meta": None, "done": None, "error": None}
    event = None
    try:
        if r.status_code != 200:
            out["error"] = f"HTTP {r.status_code}: {r.text[:200]}"
            return out
        for raw in r.iter_lines():
            if not raw:
                continue
            line = raw.decode("utf-8")
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: ") and event:
                payload = json.loads(line[6:])
                if event == "meta":
                    out["meta"] = payload
                elif event == "done":
                    out["done"] = payload
                elif event == "error":
                    out["error"] = payload.get("error", "unknown")
    finally:
        r.close()
    out["elapsed"] = round(time.time() - t0, 1)
    return out


def main():
    token = get_token()
    manifest = {m["filename"]: m for m in json.loads(
        (IMG_DIR / "manifest.json").read_text(encoding="utf-8"))["images"]}
    images = sorted(p for p in IMG_DIR.glob("*.jpg"))
    log(f"共 {len(images)} 张图")

    results = {}
    if OUT_PATH.exists():
        results = json.loads(OUT_PATH.read_text(encoding="utf-8"))

    def save():
        OUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2),
                            encoding="utf-8")

    for img in images:
        if img.name in results and not results[img.name].get("error"):
            log(f"{img.name} 已有结果，跳过")
            continue
        try:
            log(f"{img.name} 两遍识别...")
            res = recognize(token, img)
            if res["error"] or not res["done"]:
                results[img.name] = {"error": res["error"] or "无 done 事件"}
                save()
                log(f"  失败: {results[img.name]['error']}，继续下一张")
                continue
            done = res["done"]
            books = done["books"]
            lo, hi = manifest[img.name]["full_books_range"]
            entry = {
                "n_books": len(books),
                "n_with_author": sum(1 for b in books if b.get("author")),
                "n_fragments": count_fragments(books),
                "n_filled": sum(1 for b in books
                                if b.get("source") == "frame"),
                "shelf": done.get("shelf", ""),
                "shelf_expected": manifest[img.name]["shelf"],
                "shelf_ok": done.get("shelf", "") == manifest[img.name]["shelf"],
                "in_range": lo <= len(books) <= hi,
                "stats": done.get("stats", {}),
                "tiles_total": (res.get("meta") or {}).get("tiles_total"),
                "elapsed": res["elapsed"],
                "books": [{"title": b.get("title", ""),
                           "author": b.get("author", ""),
                           "confidence": b.get("confidence"),
                           "source": b.get("source", ""),
                           "bbox": b["bbox"]} for b in books],
            }
            results[img.name] = entry
            save()
            log(f"  {entry['n_books']} 本(区间{lo}~{hi} "
                f"{'OK' if entry['in_range'] else 'NG'}), "
                f"碎片 {entry['n_fragments']}, 含作者 {entry['n_with_author']}, "
                f"补漏 {entry['n_filled']}, 架标 "
                f"{'OK' if entry['shelf_ok'] else 'NG'} "
                f"[{entry['shelf']}], {entry['elapsed']}s")
        except Exception as e:
            results[img.name] = {"error": f"{type(e).__name__}: {e}"}
            save()
            log(f"  异常: {e}，继续下一张")

    log("全部完成，结果见 " + str(OUT_PATH))


if __name__ == "__main__":
    sys.exit(main())
