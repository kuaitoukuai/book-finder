import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { exportSearchResults, searchBooks, type QueryResult, type SearchMatch } from "@/lib/api";

function MatchCells({ m }: { m: SearchMatch }) {
  return (
    <>
      <TableCell>{m.title}</TableCell>
      <TableCell className="max-w-[140px] truncate text-[13px] text-ink-soft">
        <Link
          to={`/?load=${encodeURIComponent(m.record_id)}`}
          className="text-lamp underline"
        >{m.record_name}</Link>
      </TableCell>
      <TableCell className="font-mono text-[13px]">{m.shelf || "—"}</TableCell>
      <TableCell className="font-mono text-[13px]">第 {m.index} 本</TableCell>
      <TableCell className="font-mono text-[13px]">
        {Math.round(m.confidence * 100)}%
      </TableCell>
      <TableCell className="font-mono text-[13px]">
        {Math.round(m.score * 100)}%
      </TableCell>
    </>
  );
}

export function SearchPage() {
  const [text, setText] = useState("");
  const [results, setResults] = useState<QueryResult[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const MAX_QUERY_LEN = 200;

  async function submit() {
    const seen = new Set<string>();
    let overlong = false;
    const queries: string[] = [];
    for (const line of text.split("\n")) {
      let q = line.trim();
      if (!q) continue;
      if (q.length > MAX_QUERY_LEN) { // 单行限 200 字符
        q = q.slice(0, MAX_QUERY_LEN);
        overlong = true;
      }
      if (seen.has(q)) continue; // 去重重复行
      seen.add(q);
      queries.push(q);
    }
    if (!queries.length) return;
    if (queries.length > 50) {
      setError("一次最多搜索 50 本书");
      return;
    }
    setBusy(true);
    setError("");
    setExportError("");
    setNote(overlong ? `单条书名最长 ${MAX_QUERY_LEN} 字符，超出部分已截断` : "");
    try {
      setResults(await searchBooks(queries));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    if (!results.length) return;
    setExporting(true);
    setExportError("");
    try {
      await exportSearchResults(results.map((r) => r.query));
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="gap-0 border-line bg-card py-0 shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <span className="callno">E·05</span>
          <h2 className="font-serif-cn text-[17px] tracking-[2px] text-lamp-deep">
            检索 · 多书搜索
          </h2>
        </div>
        <CardContent className="px-5 py-4">
          <Textarea
            rows={5}
            aria-label="要搜索的书名列表"
            placeholder={"每行输入一个书名，例如：\n社交恐惧心理学\n幽默社交\n活着"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={busy || !text.trim()}>
              {busy ? "搜索中…" : "开始搜索"}
            </Button>
            <Button variant="outline" onClick={doExport} disabled={exporting || !results.length}>
              {exporting ? "导出中…" : "导出 Excel"}
            </Button>
            <span className="text-[12.5px] text-ink-soft">
              在我的全部识别记录中模糊匹配，每个书名给出置信度最高的一册推荐
            </span>
          </div>
          {error && <p className="mt-2 text-[13px] text-match">{error}</p>}
          {exportError && <p className="mt-2 text-[13px] text-match">{exportError}</p>}
          {note && <p className="mt-2 text-[13px] text-[#a86a00]">{note}</p>}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card className="gap-0 border-line bg-card py-0 shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-serif-cn text-[16px] tracking-[2px] text-lamp-deep">
              查书结果汇总
            </h2>
            <div className="text-[13px]">
              <span className="font-bold text-[#2e7d46]">
                找到 {results.filter((r) => r.best).length}
              </span>
              <span className="text-ink-soft"> / 共 {results.length} 本</span>
            </div>
          </div>
          <CardContent className="px-0 py-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-lamp hover:bg-lamp">
                    <TableHead className="text-[#f3efe4]">书名</TableHead>
                    <TableHead className="text-[#f3efe4]">状态</TableHead>
                    <TableHead className="text-[#f3efe4]">推荐匹配</TableHead>
                    <TableHead className="text-[#f3efe4]">所在记录</TableHead>
                    <TableHead className="text-[#f3efe4]">书架号</TableHead>
                    <TableHead className="text-[#f3efe4]">位置</TableHead>
                    <TableHead className="text-[#f3efe4]">置信度</TableHead>
                    <TableHead className="text-[#f3efe4]">匹配度</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.query}>
                      <TableCell className="max-w-[160px] truncate text-[13px]">
                        {r.query}
                      </TableCell>
                      <TableCell>
                        {r.best ? (
                          <Badge className="bg-[#2e7d46] text-white hover:bg-[#2e7d46]">找到</Badge>
                        ) : (
                          <Badge variant="outline" className="text-ink-soft">未找到</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-[13px]">
                        {r.best?.title ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-[13px] text-ink-soft">
                        {r.best ? (
                          <Link
                            to={`/?load=${encodeURIComponent(r.best.record_id)}`}
                            className="text-lamp underline"
                          >{r.best.record_name}</Link>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[13px]">{r.best?.shelf ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[13px]">
                        {r.best ? `第 ${r.best.index} 本` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[13px]">
                        {r.best ? `${Math.round(r.best.confidence * 100)}%` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[13px] text-[#2e7d46]">
                        {r.best ? `${Math.round(r.best.score * 100)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {results.map((r, i) => {
        const others = r.best
          ? r.matches.filter(
              (m) => !(m.record_id === r.best!.record_id && m.index === r.best!.index))
          : [];
        return (
          <Card key={`${r.query}-${i}`} className="gap-0 border-line bg-card py-0 shadow-sm">
            <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
              <h3 className="font-serif-cn text-[15px] tracking-[1px] text-lamp-deep">
                {r.query}
              </h3>
              {r.best ? (
                <Badge className="bg-[#2e7d46] text-white hover:bg-[#2e7d46]">
                  置信度最高 · 推荐
                </Badge>
              ) : (
                <Badge variant="outline" className="text-ink-soft">无匹配</Badge>
              )}
            </div>
            <CardContent className="px-5 py-4">
              {r.best && (
                <div className="mb-3 rounded border-2 border-[#2e7d46] bg-[#f0f7f1] px-3.5 py-2.5 text-[14px] leading-7">
                  <span className="font-bold">{r.best.title}</span>
                  <span className="ml-3 text-ink-soft">所在记录</span>
                  <Link
                    to={`/?load=${encodeURIComponent(r.best.record_id)}`}
                    className="ml-1.5 text-lamp underline"
                  >{r.best.record_name}</Link>
                  <span className="ml-3 text-ink-soft">书架号</span>
                  <span className="ml-1.5 font-mono">{r.best.shelf || "—"}</span>
                  <span className="ml-3 text-ink-soft">位置</span>
                  <span className="ml-1.5 font-mono">第 {r.best.index} 本</span>
                  <span className="ml-3 text-ink-soft">置信度</span>
                  <span className="ml-1.5 font-mono font-bold text-[#2e7d46]">
                    {Math.round(r.best.confidence * 100)}%
                  </span>
                </div>
              )}
              {others.length > 0 && (
                <>
                  <p className="mb-1.5 text-[12.5px] text-ink-soft">其他匹配</p>
                  <div className="overflow-x-auto rounded border border-line">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-lamp hover:bg-lamp">
                          <TableHead className="text-[#f3efe4]">书名</TableHead>
                          <TableHead className="text-[#f3efe4]">所在记录</TableHead>
                          <TableHead className="text-[#f3efe4]">书架号</TableHead>
                          <TableHead className="text-[#f3efe4]">位置</TableHead>
                          <TableHead className="text-[#f3efe4]">置信度</TableHead>
                          <TableHead className="text-[#f3efe4]">匹配分</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {others.map((m, j) => (
                          <TableRow key={`${m.record_id}-${m.index}-${j}`}>
                            <MatchCells m={m} />
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
              {!r.best && (
                <p className="text-[13px] text-[#a86a00]">
                  没有找到这本书，可先去工作台识别更多书架。
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
