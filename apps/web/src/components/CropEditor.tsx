import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export interface CropBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MIN = 0.1; // 最小框边长（归一化），与服务端"裁剪面积 ≥1%"一致

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

interface DragState {
  mode: DragMode;
  px: number;
  py: number;
  box: CropBox;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 识别前的裁剪框选：可拖动/可缩放的矩形框，默认整图 */
export function CropEditor({ file, onConfirm, onCancel }: {
  file: File;
  /** crop 为归一化坐标 "x0,y0,x1,y1"；整图（未调整）时为 null */
  onConfirm: (crop: string | null) => void;
  onCancel: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [box, setBox] = useState<CropBox>({ x0: 0, y0: 0, x1: 1, y1: 1 });
  const [touched, setTouched] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const pct = (v: number) => `${v * 100}%`;

  function startDrag(mode: DragMode) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { mode, px: e.clientX, py: e.clientY, box };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!d || !rect || !rect.width || !rect.height) return; // 图片未加载时避免 NaN
    const dx = (e.clientX - d.px) / rect.width;
    const dy = (e.clientY - d.py) / rect.height;
    const b = d.box;
    let next: CropBox;
    if (d.mode === "move") {
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      const x0 = clamp(b.x0 + dx, 0, 1 - w);
      const y0 = clamp(b.y0 + dy, 0, 1 - h);
      next = { x0, y0, x1: x0 + w, y1: y0 + h };
    } else {
      next = { ...b };
      if (d.mode.includes("w")) next.x0 = clamp(b.x0 + dx, 0, b.x1 - MIN);
      if (d.mode.includes("e")) next.x1 = clamp(b.x1 + dx, b.x0 + MIN, 1);
      if (d.mode.includes("n")) next.y0 = clamp(b.y0 + dy, 0, b.y1 - MIN);
      if (d.mode.includes("s")) next.y1 = clamp(b.y1 + dy, b.y0 + MIN, 1);
    }
    setBox(next);
    setTouched(true);
  }

  function endDrag() {
    dragRef.current = null;
  }

  function confirm() {
    const vals = [box.x0, box.y0, box.x1, box.y1];
    // 未调整或坐标异常（NaN/Infinity）时按整图处理，不传 crop
    if (!touched || !vals.every(Number.isFinite)) {
      onConfirm(null);
      return;
    }
    onConfirm(vals.map((v) => v.toFixed(4)).join(","));
  }

  const handleCls =
    "absolute h-4 w-4 rounded-sm border-2 border-white bg-brass shadow touch-none";

  return (
    <div className="mt-3.5 rounded-md border border-line bg-white px-3 py-3">
      <p className="mb-2 text-[13px] text-ink-soft">
        <span className="font-bold text-lamp-deep">{file.name}</span>
        — 拖动边框或四角，框选一层书架（含架标），减少上下层干扰；不调整则按整图识别。
      </p>
      {imgFailed && (
        <p className="mb-2 text-[13px] text-match">
          这个文件无法作为图片预览（扩展名可能被改动过），请换一张图片。
        </p>
      )}
      <div className="relative inline-block max-w-full select-none">
        <img
          src={url} alt={file.name} draggable={false}
          className="block max-h-[55vh] max-w-full"
          onError={() => setImgFailed(true)}
        />
        <div ref={overlayRef} className="absolute inset-0 touch-none">
          <div
            role="presentation"
            className="absolute cursor-move border-2 border-brass shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{
              left: pct(box.x0), top: pct(box.y0),
              width: pct(box.x1 - box.x0), height: pct(box.y1 - box.y0),
            }}
            onPointerDown={startDrag("move")}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span className={`${handleCls} -left-2 -top-2 cursor-nwse-resize`}
              onPointerDown={startDrag("nw")}
              onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
            <span className={`${handleCls} -right-2 -top-2 cursor-nesw-resize`}
              onPointerDown={startDrag("ne")}
              onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
            <span className={`${handleCls} -bottom-2 -left-2 cursor-nesw-resize`}
              onPointerDown={startDrag("sw")}
              onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
            <span className={`${handleCls} -bottom-2 -right-2 cursor-nwse-resize`}
              onPointerDown={startDrag("se")}
              onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={confirm}>
          {touched ? "开始识别（按框裁剪）" : "开始识别（整图）"}
        </Button>
        <Button
          variant="outline" size="sm" disabled={!touched}
          onClick={() => { setBox({ x0: 0, y0: 0, x1: 1, y1: 1 }); setTouched(false); }}
        >重置为整图</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>换一张</Button>
      </div>
    </div>
  );
}
