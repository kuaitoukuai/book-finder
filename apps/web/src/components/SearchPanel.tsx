import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { matchSummary, useFinder } from "@/store/finder";

const MAX_QUERY_LEN = 200; // 单条书名上限

/** 保留分隔符，逐条截断超长书名；返回是否发生过截断 */
function truncateQueries(text: string): [string, boolean] {
  let truncated = false;
  const out = text.split(/([,，\n])/).map((part) => {
    if (part === "," || part === "，" || part === "\n") return part;
    if (part.length > MAX_QUERY_LEN) {
      truncated = true;
      return part.slice(0, MAX_QUERY_LEN);
    }
    return part;
  });
  return [out.join(""), truncated];
}

export function SearchPanel() {
  const query = useFinder((s) => s.query);
  const sim = useFinder((s) => s.simThreshold);
  const conf = useFinder((s) => s.confThreshold);
  const images = useFinder((s) => s.images);
  const setQuery = useFinder((s) => s.setQuery);
  const setSim = useFinder((s) => s.setSimThreshold);
  const setConf = useFinder((s) => s.setConfThreshold);

  // 输入防抖：本地即时回显，200ms 停笔后才触发全量重算与画布重绘
  const [draft, setDraft] = useState(query);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => { setDraft(query); }, [query]); // 外部载入（分享链接）
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft === query) return;
      const [text, wasTruncated] = truncateQueries(draft);
      setTruncated(wasTruncated);
      if (wasTruncated) setDraft(text);
      setQuery(text);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const summary = matchSummary(images, query);

  return (
    <div>
      <Textarea
        rows={2}
        aria-label="要查找的书名"
        placeholder={"输入书名，多本用逗号或换行分隔。例如：\n社交恐惧心理学，幽默社交"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      {truncated && (
        <p className="mt-1 text-xs text-[#a86a00]">
          单条书名最长 {MAX_QUERY_LEN} 字符，超出部分已截断
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
        <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          匹配松紧
          <span className="min-w-[42px] font-mono font-bold text-lamp-deep">
            {Math.round(sim * 100)}%
          </span>
          <Slider
            className="w-40" min={50} max={100} step={1}
            value={[Math.round(sim * 100)]}
            onValueCommitted={(v) => setSim((Array.isArray(v) ? v[0] : v) / 100)}
            aria-label="匹配相似度阈值"
          />
          <span className="text-[11.5px] opacity-75">越往右越严格</span>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          识别置信度
          <span className="min-w-[42px] font-mono font-bold text-lamp-deep">
            {Math.round(conf * 100)}%
          </span>
          <Slider
            className="w-40" min={0} max={100} step={1}
            value={[Math.round(conf * 100)]}
            onValueCommitted={(v) => setConf((Array.isArray(v) ? v[0] : v) / 100)}
            aria-label="识别置信度过滤"
          />
          <span className="text-[11.5px] opacity-75">过滤低质量识别</span>
        </label>
      </div>

      {query.trim() && (
        <div className="mt-3 text-sm leading-7" aria-live="polite">
          {images.length === 0 ? (
            <span className="text-[#a86a00]">请先在上面上传并识别书架照片</span>
          ) : (
            <>
              <span className="font-bold text-match">找到 {summary.hits} 本</span>
              <span>（覆盖 {summary.covered}/{summary.total} 个书名）</span>
              {summary.missed.length > 0 && (
                <span className="block text-[#a86a00]">
                  未找到：{summary.missed.join("、")} — 可把"匹配松紧"往左调再试
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
