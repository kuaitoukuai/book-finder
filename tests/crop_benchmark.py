# -*- coding: utf-8 -*-
"""裁剪 vs 全图识别 真实 API 对比实测。

对 测试图片2026.9.14/ 下每张图：
  1. 全图识别 1 次（tiles=1，不传 crop）；
  2. 按书脊 y 中心聚类成行，选书最多的一行，生成裁剪框
     [0, row_y1-0.08, 1, row_y2+0.08]（clamp 到 0~1）；
  3. 带 crop 识别 2 次（验证稳定性）。
结果增量写入 crop_benchmark_results.json。
只调用 HTTP 接口，不依赖服务端内部实现。
"""
import json
import math
import sys
import time
from pathlib import Path

import requests

BASE = "http://127.0.0.1:8002"
USERNAME = "testcrop"
PASSWORD = "Test123456"

TESTS_DIR = Path(__file__).resolve().parent
IMG_DIR = TESTS_DIR.parent.parent / "测试图片2026.9.14"
OUT_PATH = TESTS_DIR / "crop_benchmark_results.json"

Y_TOL = 0.05   # 行聚类容差（与服务端 refine 一致）
ROW_PAD = 0.08  # 行裁剪框上下留白


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


def recognize(token: str, img_path: Path, crop: str = "") -> dict:
    """调用 /api/recognize，流式解析 SSE，返回 {meta, books, shelf, done, error, elapsed}。"""
    t0 = time.time()
    data = {"tiles": "1", "name": img_path.name}
    if crop:
        data["crop"] = crop
    with open(img_path, "rb") as f:
        files = {"image": (img_path.name, f, "image/jpeg")}
        r = requests.post(f"{BASE}/api/recognize", files=files, data=data,
                          headers={"Authorization": f"Bearer {token}"},
                          stream=True, timeout=(15, 900))
    out = {"meta": None, "books": None, "done": None, "error": None}
    if r.status_code != 200:
        out["error"] = f"HTTP {r.status_code}: {r.text[:200]}"
        out["elapsed"] = round(time.time() - t0, 1)
        r.close()
        return out
    event = None
    try:
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
                elif event == "books":
                    out["books"] = payload
                elif event == "done":
                    out["done"] = payload
                elif event == "error":
                    out["error"] = payload.get("error", "unknown")
    finally:
        r.close()
    out["elapsed"] = round(time.time() - t0, 1)
    return out


def main_row(books: list[dict]) -> list[dict]:
    """按 y 中心聚类成行，返回书最多的一行。"""
    rows: list[list[dict]] = []
    for b in sorted(books, key=lambda b: (b["bbox"][1] + b["bbox"][3]) / 2):
        cy = (b["bbox"][1] + b["bbox"][3]) / 2
        if rows and abs(cy - sum((x["bbox"][1] + x["bbox"][3]) / 2
                                 for x in rows[-1]) / len(rows[-1])) <= Y_TOL:
            rows[-1].append(b)
        else:
            rows.append([b])
    return max(rows, key=len) if rows else []


def row_crop(row: list[dict]) -> list[float]:
    y1 = min(b["bbox"][1] for b in row) - ROW_PAD
    y2 = max(b["bbox"][3] for b in row) + ROW_PAD
    return [0.0, round(max(0.0, y1), 4), 1.0, round(min(1.0, y2), 4)]


def run_summary(res: dict) -> dict:
    books = (res.get("done") or {}).get("books") or []
    return {
        "n_books": len(books),
        "tiles_total": (res.get("meta") or {}).get("tiles_total"),
        "shelf": (res.get("done") or {}).get("shelf")
                 or (res.get("books") or {}).get("shelf", ""),
        "elapsed": res["elapsed"],
        "error": res.get("error"),
        "books": [{"title": b.get("title", ""), "confidence": b.get("confidence"),
                   "bbox": b["bbox"]} for b in books],
    }


def main():
    token = get_token()
    log(f"登录成功，图片目录: {IMG_DIR}")
    images = sorted(IMG_DIR.glob("*.jpg"))
    log(f"共 {len(images)} 张图")

    results = {}
    if OUT_PATH.exists():
        results = json.loads(OUT_PATH.read_text(encoding="utf-8"))

    def save():
        OUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2),
                            encoding="utf-8")

    for img in images:
        entry = results.setdefault(img.name, {})
        try:
            if "full" not in entry:
                log(f"{img.name} 全图识别...")
                res = recognize(token, img)
                entry["full"] = run_summary(res)
                if res["error"]:
                    entry["error"] = f"全图识别失败: {res['error']}"
                    save()
                    log(f"  失败: {res['error']}，跳过")
                    continue
                row = main_row(res["books"]["books"] if res.get("books") else [])
                entry["main_row_count"] = len(row)
                entry["crop"] = row_crop(row) if row else None
                save()
                log(f"  全图: {entry['full']['n_books']} 本, "
                    f"{entry['full']['tiles_total']} tiles, "
                    f"架标={entry['full']['shelf']}, "
                    f"主行 {len(row)} 本, crop={entry['crop']}, "
                    f"耗时 {entry['full']['elapsed']}s")

            if not entry.get("crop"):
                entry.setdefault("error", "全图无可用行，无法裁剪")
                save()
                continue

            crop_str = ",".join(str(v) for v in entry["crop"])
            runs = entry.setdefault("crop_runs", [])
            while len(runs) < 2:
                log(f"{img.name} 裁剪识别 第{len(runs) + 1}次 crop={crop_str}...")
                res = recognize(token, img, crop_str)
                runs.append(run_summary(res))
                save()
                log(f"  裁剪{len(runs)}: {runs[-1]['n_books']} 本, "
                    f"{runs[-1]['tiles_total']} tiles, "
                    f"架标={runs[-1]['shelf']}, "
                    f"错误={runs[-1]['error']}, 耗时 {runs[-1]['elapsed']}s")
        except Exception as e:
            entry["error"] = f"{type(e).__name__}: {e}"
            save()
            log(f"  异常: {e}，继续下一张")

    log("全部完成，结果见 " + str(OUT_PATH))


if __name__ == "__main__":
    sys.exit(main())
