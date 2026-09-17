import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  deleteAllResults, deleteResult, exportExcel, fetchResults, type ResultMeta,
} from "@/lib/api";
import { useFinder } from "@/store/finder";

function fmtTime(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("zh-CN", { hour12: false });
}

export function HistoryPage() {
  const [items, setItems] = useState<ResultMeta[]>([]);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const removeImages = useFinder((s) => s.removeImages);

  useEffect(() => {
    fetchResults().then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function toggle(id: string, v: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (v) next.add(id); else next.delete(id);
      return next;
    });
  }

  const allChecked = items.length > 0 && checked.size === items.length;

  async function doExport() {
    setExporting(true);
    setError("");
    try {
      await exportExcel([...checked]);
      setChecked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  async function doDelete(it: ResultMeta) {
    if (!window.confirm("确定删除这条记录？图片和识别结果将一起删除，不可恢复")) return;
    setDeletingId(it.id);
    setError("");
    try {
      await deleteResult(it.id);
      setItems((prev) => prev.filter((r) => r.id !== it.id));
      removeImages([it.id]); // 工作台若已加载该记录，同步移除
      setChecked((prev) => {
        const next = new Set(prev);
        next.delete(it.id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId("");
    }
  }

  async function doDeleteAll() {
    if (!window.confirm(
      `将删除你的全部 ${items.length} 条记录，不可恢复。确定继续？`)) return;
    setDeletingAll(true);
    setError("");
    try {
      await deleteAllResults();
      setItems([]);
      setChecked(new Set());
      removeImages(items.map((it) => it.id)); // 工作台同步清空已加载记录
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingAll(false);
    }
  }

  return (
    <Card className="gap-0 border-line bg-card py-0 shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="callno">D·04</span>
        <h2 className="font-serif-cn text-[17px] tracking-[2px] text-lamp-deep">
          馆藏 · 历史识别记录
        </h2>
      </div>
      <CardContent className="px-5 py-4">
        {error && <p className="text-sm text-match">操作失败：{error}</p>}
        {!error && items.length === 0 && (
          <p className="text-sm text-ink-soft">
            还没有识别记录。先到<Link to="/" className="text-lamp underline">工作台</Link>上传一张书架照片。
          </p>
        )}
        {items.length > 0 && (
          <>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <label className="flex items-center gap-1.5 text-ink-soft">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) =>
                    setChecked(v === true ? new Set(items.map((it) => it.id)) : new Set())}
                  aria-label="全选"
                />
                全选<span>（已选 {checked.size} 条）</span>
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  disabled={checked.size === 0 || exporting || deletingAll}
                  onClick={doExport}
                >{exporting ? "导出中…" : `导出选中 Excel（${checked.size}）`}</Button>
                <Button
                  variant="destructive" size="sm"
                  disabled={items.length === 0 || deletingAll || exporting}
                  onClick={doDeleteAll}
                >{deletingAll ? "删除中…" : "删除全部"}</Button>
              </div>
            </div>
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-white px-3 py-2.5"
                >
                  <label className="flex min-w-0 items-center gap-2.5">
                    <Checkbox
                      checked={checked.has(it.id)}
                      onCheckedChange={(v) => toggle(it.id, v === true)}
                      aria-label={`选择 ${it.name}`}
                    />
                    <span className="min-w-0">
                      <span className="font-mono text-[13px]">{it.id}</span>
                      <span className="ml-2.5">{it.name}</span>
                      <Badge variant="secondary" className="ml-2.5">{it.count} 本</Badge>
                      {it.shelf && (
                        <Badge variant="outline" className="ml-1.5 font-mono">
                          书架 {it.shelf}
                        </Badge>
                      )}
                      <span className="ml-2.5 block text-[12px] text-ink-soft sm:inline">
                        {fmtTime(it.created_at)}
                      </span>
                    </span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm"
                      render={<Link to={`/?load=${encodeURIComponent(it.id)}`} />}>
                      打开
                    </Button>
                    <Button
                      variant="destructive" size="sm"
                      aria-label={`删除 ${it.name}`}
                      disabled={deletingId === it.id || deletingAll}
                      onClick={() => doDelete(it)}
                    >
                      <Trash2 />
                      {deletingId === it.id ? "删除中…" : "删除"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
