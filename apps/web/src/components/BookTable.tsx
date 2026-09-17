import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { exportExcel } from "@/lib/api";
import { sortedBooks, totalBooks, useFinder } from "@/store/finder";

export function BookTable() {
  const images = useFinder((s) => s.images);
  const locate = useFinder((s) => s.locate);
  const updateTitle = useFinder((s) => s.updateTitle);
  const fontScale = useFinder((s) => s.fontScale);
  const setFontScale = useFinder((s) => s.setFontScale);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");

  const rows = sortedBooks(images);
  if (rows.length === 0) return null;

  async function doExport() {
    setExporting(true);
    setExportErr("");
    try {
      await exportExcel(images.map((im) => im.id));
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-soft">
          点击任意一行，在下方照片中定位该书；书名识别有误可直接改。
          <span className="text-[#a86a00]">行内修改暂不会保存到导出文件（仅保留在本浏览器）。</span>
        </p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            文字大小
            <input
              type="range" min={0.15} max={1.5} step={0.05}
              value={fontScale}
              onChange={(e) => setFontScale(Number(e.target.value))}
              className="w-24 accent-lamp-deep"
              aria-label="标注文字大小"
            />
            <span className="w-9 font-mono">{Math.round(fontScale * 100)}%</span>
          </label>
          <Button
            variant="outline" size="sm" className="h-7 px-3 text-xs"
            disabled={exporting}
            onClick={doExport}
          >{exporting ? "导出中…" : "导出 Excel"}</Button>
        </div>
      </div>
      {exportErr && <p className="mb-2 text-[13px] text-match">导出失败：{exportErr}</p>}
      {/* 原生滚动容器：base-ui ScrollArea 的 viewport 依赖父级确定高度，
          仅设 max-height 时约束不生效、内容被截断且无滚动条 */}
      <div className="max-h-[60vh] overflow-y-auto rounded border border-line">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-lamp hover:bg-lamp">
              <TableHead className="text-[#f3efe4]">架位</TableHead>
              <TableHead className="text-[#f3efe4]">照片</TableHead>
              <TableHead className="text-[#f3efe4]">书架号</TableHead>
              <TableHead className="text-[#f3efe4]">书名</TableHead>
              <TableHead className="text-[#f3efe4]">作者</TableHead>
              <TableHead className="text-[#f3efe4]">置信度</TableHead>
              <TableHead className="text-[#f3efe4]">检索</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ imgIdx, bookIdx, book, img }) => (
              <TableRow
                key={`${img.id}-${book.index}`}
                data-locate={`${imgIdx}-${bookIdx}`}
                className={`cursor-pointer ${
                  book.matched
                    ? "bg-match-bg hover:bg-match-bg border-l-4 border-l-match"
                    : ""}`}
                onClick={() => locate(imgIdx, bookIdx)}
              >
                <TableCell className={book.matched ? "font-bold text-match" : ""}>
                  {imgIdx + 1}-{book.index}
                </TableCell>
                <TableCell className="max-w-[120px] truncate text-[13px] text-ink-soft">
                  {img.name}
                </TableCell>
                <TableCell className="font-mono text-[13px] text-ink-soft">
                  {book.shelf || img.shelf || "—"}
                </TableCell>
                <TableCell>
                  <input
                    className="w-full rounded-sm bg-transparent px-0.5 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-brass"
                    value={book.title}
                    aria-label="书名，可编辑"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateTitle(imgIdx, bookIdx, e.target.value)}
                  />
                </TableCell>
                <TableCell className="max-w-[140px] truncate text-[13px] text-ink-soft">
                  {book.author || "—"}
                </TableCell>
                <TableCell>
                  <span className={`font-mono text-[13px] ${
                    book.confidence < 0.6 ? "font-bold text-match" : ""}`}>
                    {Math.round(book.confidence * 100)}%
                  </span>
                </TableCell>
                <TableCell>
                  {book.matched && (
                    <>
                      <Badge className="mr-1 bg-match text-white hover:bg-match">
                        {book.matchQuery}
                      </Badge>
                      <span className="font-mono text-[12.5px] text-match">
                        {Math.round((book.score ?? 0) * 100)}%
                      </span>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-right text-[12.5px] text-ink-soft">
        共 {totalBooks(images)} 本
      </p>
    </div>
  );
}
