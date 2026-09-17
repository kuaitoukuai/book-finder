import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/CameraCapture";
import { Checkbox } from "@/components/ui/checkbox";
import { CropEditor } from "@/components/CropEditor";
import { Progress } from "@/components/ui/progress";
import { recognizeStream } from "@/lib/api";
import { useFinder } from "@/store/finder";

interface FileProgress {
  id: string;
  name: string;
  status: "doing" | "ok" | "err";
  text: string;
  done: number;
  total: number;
}

/** 与服务端 MAX_UPLOAD_BYTES 对齐（30MB），提前拦截避免白等 413 */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** crypto.randomUUID 只在安全上下文（https / localhost）可用，
 *  生产用 http://192.168.x.x 访问时它是 undefined，必须降级 */
let idSeq = 0;
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  idSeq += 1;
  return `${Date.now().toString(36)}-${idSeq}`;
}

/** 拖拽上传 / 拍照 → 裁剪框选 → SSE 逐块识别 */
export function UploadZone() {
  const [items, setItems] = useState<FileProgress[]>([]);
  // 大图切块默认关闭；整图识别通常已足够，切块仅在整图结果不准（漏书）时人工开启
  const [useTiles, setUseTiles] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<File[]>([]); // 待裁剪队列
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const addImage = useFinder((s) => s.addImage);
  // 卸载/离开页面时取消未完成的识别：否则服务端会继续跑完所有切块并烧 API 额度
  const controllersRef = useRef(new Set<AbortController>());

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
  }, []);

  // 同名文件可能先后上传，进度一律按任务 id 匹配
  const patch = (id: string, p: Partial<FileProgress>) =>
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...p } : it));

  async function recognizeOne(file: File, crop: string | null) {
    const id = newId();
    setItems((prev) => [...prev, {
      id, name: file.name, status: "doing", text: "识别中", done: 0, total: 0,
    }]);
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      await recognizeStream(file, useTiles, crop, (e) => {
        if (e.type === "meta")
          patch(id, { total: e.tiles_total, text: `已切 ${e.tiles_total} 块` });
        else if (e.type === "tile")
          patch(id, {
            done: e.done,
            text: `切块 ${e.done}/${e.total} · 累计识别中`,
          });
        else if (e.type === "books")
          patch(id, { text: `合并去重 → ${e.books.length} 本` });
        else if (e.type === "done") {
          const tileErr = e.result.tiles.filter((t) => t.error).length;
          patch(id, {
            status: "ok",
            text: `识别出 ${e.result.books.length} 本书` +
              (tileErr ? `（${tileErr} 个切块失败，可能漏识别）` : ""),
          });
          addImage(e.result);
        } else if (e.type === "error")
          patch(id, { status: "err", text: e.error });
      }, controller.signal);
    } catch (err) {
      // 主动取消（组件卸载/离开页面）不算识别失败，但要收掉"识别中"的进度条
      if (controller.signal.aborted) {
        patch(id, { status: "err", text: "已取消识别" });
        return;
      }
      patch(id, {
        status: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      controllersRef.current.delete(controller);
    }
  }

  function handleFiles(files: FileList | File[]) {
    const imgs: File[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) {
        setItems((prev) => [...prev, {
          id: newId(),
          name: f.name, status: "err", text: "不是图片文件，已跳过", done: 0, total: 0,
        }]);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setItems((prev) => [...prev, {
          id: newId(),
          name: f.name, status: "err",
          text: `文件超过 ${MAX_FILE_BYTES / 1024 / 1024}MB，请压缩后再上传`,
          done: 0, total: 0,
        }]);
        continue;
      }
      imgs.push(f);
    }
    if (imgs.length) setPending((prev) => [...prev, ...imgs]); // 逐张框选后再识别
    if (inputRef.current) inputRef.current.value = "";
    if (captureRef.current) captureRef.current.value = "";
  }

  function openCamera() {
    if (typeof navigator.mediaDevices?.getUserMedia === "function") setCameraOpen(true);
    else captureRef.current?.click(); // 降级：调起系统相机
  }

  const current = pending[0];

  return (
    <div>
      <div
        role="button" tabIndex={0} aria-label="上传书架照片"
        className={`rounded-md border-2 border-dashed px-4 py-7 text-center transition-colors ${
          dragOver ? "border-lamp bg-[#eef2ea]" : "border-[#a9b3a4]"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
      >
        <p className="text-[15px]">把书架照片拖到这里</p>
        <p className="my-1.5 text-xs text-ink-soft">或</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={() => inputRef.current?.click()}>选择图片</Button>
          <Button type="button" variant="outline" onClick={openCamera}>拍照</Button>
        </div>
        <input
          ref={inputRef} type="file" accept="image/*" multiple hidden
          onChange={() => inputRef.current?.files && handleFiles(inputRef.current.files)}
        />
        <input
          ref={captureRef} type="file" accept="image/*" capture="environment" hidden
          onChange={() => captureRef.current?.files && handleFiles(captureRef.current.files)}
        />
        <label className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-ink-soft">
          <Checkbox
            checked={useTiles}
            onCheckedChange={(v) => setUseTiles(v === true)}
          />
          大图切块识别<span className="text-xs">（整图不准时再开）</span>
        </label>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={(file) => { setCameraOpen(false); handleFiles([file]); }}
          onClose={() => setCameraOpen(false)}
          onFallback={() => { setCameraOpen(false); captureRef.current?.click(); }}
        />
      )}

      {current && (
        <CropEditor
          key={`${current.name}-${current.lastModified}-${pending.length}`}
          file={current}
          onConfirm={(crop) => {
            setPending((prev) => prev.slice(1));
            recognizeOne(current, crop);
          }}
          onCancel={() => setPending((prev) => prev.slice(1))}
        />
      )}

      {items.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[13px]" aria-live="polite">
          {items.map((it) => (
            <li
              key={it.id}
              className={`rounded border px-2.5 py-1.5 ${
                it.status === "ok" ? "border-[#bcd8c4] text-[#2e7d46]" :
                it.status === "err" ? "border-[#e5b7b3] text-[#b3261e]" :
                "border-[#e3cfa2] text-[#a86a00]"}`}
            >
              <div className="flex justify-between gap-2">
                <span className="truncate">{it.name}</span>
                <span className="shrink-0">{it.text}</span>
              </div>
              {it.status === "doing" && it.total > 0 && (
                <Progress value={(it.done / it.total) * 100} className="mt-1.5 h-1.5" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
