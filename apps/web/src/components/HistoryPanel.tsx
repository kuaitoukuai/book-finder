import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fetchResultDetail, fetchResults, type ResultMeta } from "@/lib/api";
import { useFinder } from "@/store/finder";

export function HistoryPanel() {
  const [items, setItems] = useState<ResultMeta[]>([]);
  const [picked, setPicked] = useState("");
  const [msg, setMsg] = useState("");
  const images = useFinder((s) => s.images);
  const addImage = useFinder((s) => s.addImage);

  const refresh = () => fetchResults().then(setItems).catch(() => {});
  useEffect(() => { refresh(); }, []);
  // 新识别完成后刷新列表
  useEffect(() => { refresh(); }, [images.length]);

  async function load() {
    if (!picked) return;
    if (images.some((im) => im.id === picked)) {
      setMsg("该记录已在页面上，未重复载入");
      return;
    }
    try {
      const data = await fetchResultDetail(picked);
      addImage(data);
      setMsg("");
    } catch (e) {
      setMsg(`载入失败：${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[13px]">
      <Select value={picked} onValueChange={(v) => setPicked(v ?? "")}>
        <SelectTrigger className="w-[320px] max-w-full bg-white">
          <SelectValue placeholder="— 调取历史识别记录 —" />
        </SelectTrigger>
        <SelectContent>
          {items.map((it) => (
            <SelectItem key={it.id} value={it.id}>
              {it.id} · {it.name}（{it.count} 本）
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={load} disabled={!picked}>
        载入
      </Button>
      {msg && <span className="text-[#a86a00]">{msg}</span>}
    </div>
  );
}
