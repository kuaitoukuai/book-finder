# -*- coding: utf-8 -*-
"""离线回归回放：对 fragment_benchmark_results.json 里 9 张图的已保存书目
（旧管线产物）追加执行 dedup_row_x，对比每张图前后本数与碎片数，
快速发现过合并/误删。不调用任何 API。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "apps" / "server"))
from core.parse import norm_title  # noqa: E402
from core.refine import physical_rows  # noqa: E402
from core.tiles import dedup_row_x  # noqa: E402

SRC = Path(__file__).with_name("fragment_benchmark_results.json")


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    out = []
    for name, rec in data.items():
        books = rec.get("books") or []
        for b in books:  # 兼容旧记录缺字段
            b.setdefault("author", "")
            b.setdefault("source", "")
        n0 = len(books)
        rows = physical_rows(books)
        after = dedup_row_x([dict(b, bbox=list(b["bbox"])) for b in books])
        n1 = len(after)
        frag0 = sum(1 for b in books if len(norm_title(b["title"])) <= 2)
        frag1 = sum(1 for b in after if len(norm_title(b["title"])) <= 2)
        kept = {norm_title(b["title"]) for b in after}
        dropped = [b["title"] for b in books
                   if norm_title(b["title"]) not in kept]
        out.append(f"{name}: {n0} -> {n1} 本, 物理行 "
                   f"{[len(r) for r in rows]}, 碎片 {frag0}->{frag1}")
        for t in dropped:
            out.append(f"    [-] {t}")
    text = "\n".join(out)
    Path(__file__).with_name("rowmerge_replay.txt").write_text(
        text, encoding="utf-8")
    print(text.splitlines()[0])
    print("written rowmerge_replay.txt")


if __name__ == "__main__":
    main()
