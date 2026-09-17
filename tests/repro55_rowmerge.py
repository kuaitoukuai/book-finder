# -*- coding: utf-8 -*-
"""离线回放：用真实代码验证 dedup_row_x 对 55 号实测结果（61 本）的收敛效果。

不调用任何 API；输入为已保存的 result.json（旧管线产物），
模拟新管线中 dedup_row_x 的增量效果，并单独模拟 _fill_from_frame 的
同名跳过（4 本整图遍错位重复在新逻辑下根本不会补进来）。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "apps" / "server"))
from core.parse import norm_title  # noqa: E402
from core.refine import physical_rows  # noqa: E402
from core.tiles import dedup_row_x  # noqa: E402

SRC = Path(__file__).resolve().parent.parent / "apps" / "server" \
    / "results" / "20260915_120014_369" / "result.json"


def main():
    d = json.loads(SRC.read_text(encoding="utf-8"))
    books = d["books"]
    out = [f"输入 {len(books)} 本 ({d.get('name')})"]

    rows = physical_rows(books)
    out.append(f"物理行数: {len(rows)}  每行本数: {[len(r) for r in rows]}")

    after = dedup_row_x(books)
    frame = [b for b in after if b.get("source") == "frame"]
    detail = [b for b in after if b.get("source") != "frame"]
    out.append(f"dedup_row_x 后 {len(after)} 本"
               f"（其中 frame 补充 {len(frame)} 本，新逻辑下会被同名跳过）")
    out.append(f"预计新管线输出: {len(detail)} 本")
    out.append("---- 保留书目 ----")
    for b in detail:
        out.append(f"  x[{b['bbox'][0]:.3f},{b['bbox'][2]:.3f}] "
                   f"y[{b['bbox'][1]:.3f},{b['bbox'][3]:.3f}] {b['title']}")
    kept_titles = {norm_title(b["title"]) for b in detail}
    out.append("---- 被吸收/丢弃的条目 ----")
    for b in books:
        if b.get("source") == "frame":
            out.append(f"  [frame 同名跳过] {b['title']}")
        elif norm_title(b["title"]) not in kept_titles:
            out.append(f"  [x] {b['title']}")
    short = [b["title"] for b in detail if len(norm_title(b["title"])) <= 2]
    out.append(f"遗留 <=2 字碎片: {short if short else '无'}")
    text = "\n".join(out)
    Path(__file__).with_name("repro55_after.txt").write_text(
        text, encoding="utf-8")
    print(f"written repro55_after.txt, after={len(after)}, "
          f"detail={len(detail)}")


if __name__ == "__main__":
    main()
