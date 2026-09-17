import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { BookTable } from "@/components/BookTable";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { ShelfViewer } from "@/components/ShelfViewer";
import { UploadZone } from "@/components/UploadZone";
import { fetchResultDetail } from "@/lib/api";
import { useFinder } from "@/store/finder";

function Section({ callno, title, children }: {
  callno: string; title: string; children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 border-line bg-card py-0 shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="callno">{callno}</span>
        <h2 className="font-serif-cn text-[17px] tracking-[2px] text-lamp-deep">{title}</h2>
      </div>
      <CardContent className="px-5 py-4">{children}</CardContent>
    </Card>
  );
}

/** 与 SearchPanel / SearchPage 一致的单条书名上限；URL 里的 q 也必须先截断，
 *  否则一个超长 q 会让每个书名都跑一次 O(len(q)*len(title)) 的相似度计算，界面直接卡死 */
const MAX_SHARE_QUERY_LEN = 200;

export function WorkspacePage() {
  const images = useFinder((s) => s.images);
  const addImage = useFinder((s) => s.addImage);
  const setQuery = useFinder((s) => s.setQuery);
  const [params] = useSearchParams();
  const [loadErr, setLoadErr] = useState("");

  // ?load=<历史id>&q=<书名> 分享链接
  useEffect(() => {
    const rid = params.get("load");
    const q = params.get("q");
    if (q) setQuery(q.slice(0, MAX_SHARE_QUERY_LEN));
    if (rid) {
      // 原来 catch 里什么都不做：链接失效/记录被删时用户完全无感知
      fetchResultDetail(rid)
        .then(addImage)
        .catch((e) => setLoadErr(`载入记录 ${rid} 失败：${
          e instanceof Error ? e.message : e}（记录可能已删除或不属于当前账号）`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      {loadErr && (
        <p className="rounded border border-[#e5b7b3] bg-white px-3 py-2 text-[13px] text-[#b3261e]">
          {loadErr}
        </p>
      )}
      <Section callno="A·01" title="上架 · 书架照片">
        <UploadZone />
        <HistoryPanel />
      </Section>

      <Section callno="B·02" title="检索 · 要找的书">
        <SearchPanel />
      </Section>

      {images.length > 0 && (
        <Section callno="C·03" title="书目 · 识别结果">
          <BookTable />
        </Section>
      )}

      {images.map((img, i) => (
        <ShelfViewer key={img.id} img={img} imgIdx={i} />
      ))}
    </div>
  );
}
