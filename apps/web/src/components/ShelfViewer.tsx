import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  fetchProviders, reidentify, withToken,
  type ProviderInfo, type ShelfImage,
} from "@/lib/api";
import { useFinder } from "@/store/finder";

interface ViewState {
  scale: number;
  tx: number;
  ty: number;
  overlay: boolean;
  fitted: boolean;
}

/** 书架照片 + canvas 标注层：缩放/平移/点击选中/命中标红 */
export function ShelfViewer({ img, imgIdx }: { img: ShelfImage; imgIdx: number }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0, overlay: true, fitted: false });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const movedRef = useRef(0);

  const selected = useFinder((s) => s.selected);
  const images = useFinder((s) => s.images); // matched 状态变化时重绘
  const fontScale = useFinder((s) => s.fontScale);
  const locate = useFinder((s) => s.locate);
  const replaceImage = useFinder((s) => s.replaceImage);
  const [imgError, setImgError] = useState(false);

  // 重新识别：多供应商选择 + 融合
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [useTiles, setUseTiles] = useState(false);
  const [reIdBusy, setReIdBusy] = useState(false);
  const [reIdErr, setReIdErr] = useState("");
  const [reIdNote, setReIdNote] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchProviders()
      .then((list) => {
        if (!alive) return;
        setProviders(list);
        const avail = list.filter((p) => p.available);
        setChosen(avail.length ? [avail[0].name] : []);
        setUseTiles(false);
      })
      .catch((e) => setReIdErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [open]);

  async function doReidentify() {
    if (!chosen.length || reIdBusy) return;
    setReIdBusy(true);
    setReIdErr("");
    setReIdNote("");
    try {
      const { result, counts, failed } = await reidentify(img.id, chosen, useTiles);
      replaceImage(imgIdx, result);
      const summary = Object.entries(counts)
        .map(([n, c]) => `${n}:${c}本`)
        .join(" / ");
      const failNote = Object.keys(failed).length
        ? `（失败：${Object.entries(failed).map(([n, m]) => `${n}:${m}`).join("；")}）`
        : "";
      setReIdNote(`识别完成：${summary}${failNote}`);
      setOpen(false);
    } catch (e) {
      setReIdErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReIdBusy(false);
    }
  }

  function toggleProvider(name: string, checked: boolean) {
    setChosen((prev) =>
      checked ? Array.from(new Set([...prev, name])) : prev.filter((n) => n !== name));
  }

  const applyTransform = useCallback(() => {
    const v = viewRef.current;
    if (stageRef.current)
      stageRef.current.style.transform =
        `translate(${v.tx}px,${v.ty}px) scale(${v.scale})`;
  }, []);

  const fitView = useCallback(() => {
    const vp = viewportRef.current, v = viewRef.current;
    if (!vp || !img.width || !img.height) return;
    const vw = vp.clientWidth, vh = vp.clientHeight;
    if (!vw || !vh) return;
    const s = Math.min(vw / img.width, vh / img.height);
    v.scale = s;
    v.tx = (vw - img.width * s) / 2;
    v.ty = (vh - img.height * s) / 2;
    applyTransform();
  }, [img.width, img.height, applyTransform]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const v = viewRef.current;
    if (!canvas || !canvas.width) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!v.overlay) return;
    const W = img.width, H = img.height;
    const zoomed = v.scale * W > 1400; // 放得够大才给普通书也写字

    img.books.forEach((b, bookIdx) => {
      const [x1, y1, x2, y2] = b.bbox;
      const bx = x1 * W, by = y1 * H, bw = (x2 - x1) * W, bh = (y2 - y1) * H;
      const isSel = selected?.imgIdx === imgIdx && selected?.bookIdx === bookIdx;
      let color = "rgba(64,140,220,0.95)";
      if (b.matched) color = "#e0231a";
      if (isSel) color = "#f5b800";
      ctx.lineWidth = Math.max(3, W / 700);
      ctx.strokeStyle = color;
      ctx.strokeRect(bx, by, bw, bh);
      if (b.matched) {
        ctx.fillStyle = "rgba(224,35,26,0.16)";
        ctx.fillRect(bx, by, bw, bh);
      }
      const vertical = bh > bw * 1.8; // 竖立书脊
      // 竖排书名像书脊印刷字，全程显示；横排标签只在放大/命中/选中时显示
      if (b.title && (vertical || b.matched || isSel || zoomed)) {
        if (vertical) {
          let chars = [...b.title];
          const fsFit = Math.min(bw * 0.78, (bh - 14) / chars.length);
          let fs = fsFit * fontScale;
          const fsMin = Math.max(9, W / 350) * fontScale;
          if (fs < fsMin) { // 字太多放不下：按最小字号截断并加省略号
            fs = fsMin;
            const n = Math.max(3, Math.floor((bh - 14) / fs) - 1);
            chars = chars.length > n ? [...chars.slice(0, n), "…"] : chars;
          }
          ctx.font = `${fs}px "Microsoft YaHei", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const stripW = fs + 10;
          const stripH = chars.length * fs + 12;
          const cxm = bx + bw / 2;
          // 竖条贴在书脊框内底部，不再居中遮挡书脊
          const sy = Math.max(by + 4, by + bh - stripH - 4);
          ctx.fillStyle = "rgba(30,41,59,0.85)";
          ctx.fillRect(cxm - stripW / 2, sy, stripW, stripH);
          ctx.fillStyle = "#22c55e"; // 醒目绿字 + 深色底条保证可读
          chars.forEach((ch, i) => ctx.fillText(ch, cxm, sy + 6 + i * fs));
          ctx.textAlign = "start";
          ctx.textBaseline = "alphabetic";
        } else {
          const fs = Math.max(14, W / 140) * fontScale;
          ctx.font = `bold ${fs}px "Microsoft YaHei", sans-serif`;
          const label = b.title.length > 16 ? b.title.slice(0, 16) + "…" : b.title;
          const tw = ctx.measureText(label).width;
          // 优先画在框外底部；下方没空间才收进框内底边
          const ly = by + bh + fs + 14 < H ? by + bh + fs + 14 : by + bh - 6;
          ctx.fillStyle = "rgba(30,41,59,0.85)";
          ctx.fillRect(bx, ly - fs, tw + 10, fs + 8);
          ctx.fillStyle = "#22c55e";
          ctx.fillText(label, bx + 5, ly - 3);
        }
      }
    });
  }, [img, imgIdx, selected, fontScale]);

  // matched/selected/fontScale 变化时重绘
  useEffect(() => { draw(); }, [draw, images, fontScale]);

  // 图片加载后初始化画布与视图
  const onImgLoad = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = img.width;
    canvas.height = img.height;
    if (!viewRef.current.fitted) {
      viewRef.current.fitted = true;
      fitView();
    }
    draw();
  }, [img.width, img.height, fitView, draw]);

  // 定位副作用：滚动 + 居中 + 闪烁
  useEffect(() => {
    if (!selected || selected.imgIdx !== imgIdx) return;
    const b = img.books[selected.bookIdx];
    const vp = viewportRef.current;
    if (!b || !vp || !viewRef.current.fitted) return;
    const v = viewRef.current;
    vp.scrollIntoView({ behavior: "smooth", block: "start" });
    const bh = Math.max(b.bbox[3] - b.bbox[1], 0.01);
    const bw = Math.max(b.bbox[2] - b.bbox[0], 0.01);
    const s = Math.min(6, Math.max(v.scale,
      vp.clientHeight / (bh * img.height * 3),
      vp.clientWidth / (bw * img.width * 8)));
    const cx = (b.bbox[0] + b.bbox[2]) / 2 * img.width;
    const cy = (b.bbox[1] + b.bbox[3]) / 2 * img.height;
    v.scale = s;
    v.tx = vp.clientWidth / 2 - cx * s;
    v.ty = vp.clientHeight / 2 - cy * s;
    applyTransform();
    draw();
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.classList.remove("flash");
      void canvas.offsetWidth;
      canvas.classList.add("flash");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.nonce]);

  // 滚轮缩放（非 passive，需原生监听）
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.min(8, Math.max(0.05, v.scale * k));
      v.tx = mx - (mx - v.tx) * (ns / v.scale);
      v.ty = my - (my - v.ty) * (ns / v.scale);
      v.scale = ns;
      applyTransform();
      draw(); // 缩放后可能跨过标签显示阈值
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [applyTransform, draw]);

  const onPointerDown = (e: React.PointerEvent) => {
    const v = viewRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty };
    movedRef.current = 0;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    movedRef.current = Math.max(movedRef.current,
      Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y));
    const v = viewRef.current;
    v.tx = d.tx + e.clientX - d.x;
    v.ty = d.ty + e.clientY - d.y;
    applyTransform();
  };
  const onPointerUp = () => { dragRef.current = null; };

  const onClick = (e: React.MouseEvent) => {
    if (movedRef.current > 6) return; // 是拖拽不是点击
    const vp = viewportRef.current;
    // width/height 为 0 时下面的换算会得到 Infinity/NaN，直接放弃命中判定
    if (!vp || !img.width || !img.height) return;
    const v = viewRef.current;
    const rect = vp.getBoundingClientRect();
    const px = (e.clientX - rect.left - v.tx) / v.scale / img.width;
    const py = (e.clientY - rect.top - v.ty) / v.scale / img.height;
    const hit = img.books.findIndex((b) =>
      px >= b.bbox[0] && px <= b.bbox[2] && py >= b.bbox[1] && py <= b.bbox[3]);
    if (hit >= 0) locate(imgIdx, hit);
  };

  const hitCount = img.books.filter((b) => b.matched).length;

  return (
    <section className="overflow-hidden rounded-md border border-line bg-card shadow-sm">
      <h3 className="flex flex-wrap items-center justify-between gap-2 bg-lamp-deep px-4 py-2.5 text-[13.5px] tracking-wide text-[#f3efe4]">
        <span>
          {img.name} · {img.books.length} 本
          {hitCount > 0 && <span className="ml-2 text-red-300">命中 {hitCount}</span>}
        </span>
        <span className="flex gap-1.5">
          <Button
            variant="outline" size="sm"
            className="h-7 border-[#f3efe4]/40 bg-transparent px-3 text-xs text-[#f3efe4] hover:bg-white/10 hover:text-white"
            onClick={() => { viewRef.current.overlay = !viewRef.current.overlay; draw(); }}
          >切换标注</Button>
          <Button
            variant="outline" size="sm"
            className="h-7 border-[#f3efe4]/40 bg-transparent px-3 text-xs text-[#f3efe4] hover:bg-white/10 hover:text-white"
            onClick={fitView}
          >重置视图</Button>
          <Button
            variant="outline" size="sm"
            className="h-7 border-amber-200/50 bg-transparent px-3 text-xs text-amber-100 hover:bg-white/10 hover:text-white"
            onClick={() => { setReIdErr(""); setReIdNote(""); setOpen(true); }}
          >重新识别</Button>
        </span>
      </h3>
      <div
        ref={viewportRef}
        className="relative h-[72vh] min-h-[320px] cursor-grab touch-none overflow-hidden bg-[#21251f] active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
      >
        <div ref={stageRef} className="absolute origin-top-left">
          {imgError ? (
            <div
              className="grid place-items-center bg-[#2a2f28] text-[13px] text-[#c9cfc4]"
              style={{ width: img.width, height: img.height }}
            >
              图片加载失败（可能登录已过期或记录已删除），请刷新重试
            </div>
          ) : (
            <img
              src={withToken(img.image_url)} alt={img.name}
              onLoad={onImgLoad}
              onError={() => setImgError(true)}
              className="block max-w-none select-none"
              style={{ width: img.width, height: img.height }}
              draggable={false}
            />
          )}
          <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0" />
        </div>
      </div>

      {/* 重新识别对话框 */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { if (!reIdBusy) setOpen(false); }}
        >
          <div
            className="w-[min(92vw,520px)] rounded-xl border border-line bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="mb-3 text-[15px] font-semibold tracking-wide">
              重新识别 · {img.name}
            </h4>

            {reIdErr && (
              <p className="mb-3 rounded-md border border-red-300/40 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">
                {reIdErr}
              </p>
            )}
            {reIdNote && (
              <p className="mb-3 rounded-md border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-300">
                {reIdNote}
              </p>
            )}

            <p className="mb-1.5 text-[12.5px] text-muted-foreground">
              选择用于识别的 API（勾选多个自动智能融合：按位置分组 + 置信度择优 + 补漏）：
            </p>
            <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1">
              {providers.map((p) => (
                <label
                  key={p.name}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-muted/60"
                >
                  <Checkbox
                    checked={chosen.includes(p.name)}
                    disabled={reIdBusy || !p.available}
                    onCheckedChange={(c) => toggleProvider(p.name, c === true)}
                  />
                  <span className={p.available ? "" : "text-muted-foreground line-through"}>
                    {p.label}
                  </span>
                  {p.note && (
                    <span className="truncate text-[11px] text-muted-foreground">（{p.note}）</span>
                  )}
                </label>
              ))}
            </div>

            <label className="mb-4 flex cursor-pointer items-center gap-2 text-[12.5px]">
              <Checkbox
                checked={useTiles}
                disabled={reIdBusy}
                onCheckedChange={(c) => setUseTiles(c === true)}
              />
              <span>整图 + 大图切块两遍（整图不准时再开）</span>
            </label>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline" size="sm"
                className="h-8 px-4 text-xs"
                disabled={reIdBusy}
                onClick={() => setOpen(false)}
              >取消</Button>
              <Button
                size="sm"
                className="h-8 px-4 text-xs"
                disabled={reIdBusy || !chosen.length}
                onClick={doReidentify}
              >
                {reIdBusy ? "识别中…" : "开始重新识别"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
