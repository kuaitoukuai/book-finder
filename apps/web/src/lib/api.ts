import axios from "axios";
import { useAuth } from "@/store/auth";

export interface Book {
  index: number;
  title: string;
  author?: string;
  shelf?: string;
  bbox: [number, number, number, number];
  confidence: number;
  matched?: boolean;
  score?: number;
  matchQuery?: string;
}

export interface TileInfo {
  tile: number[];
  count: number;
  error?: string | null;
}

export interface ShelfImage {
  id: string;
  name: string;
  width: number;
  height: number;
  image_url: string;
  shelf?: string;
  books: Book[];
  tiles: TileInfo[];
  created_at?: string;
}

export interface ResultMeta {
  id: string;
  name: string;
  count: number;
  shelf?: string;
  created_at?: string;
}

export interface SearchMatch {
  record_id: string;
  record_name: string;
  shelf?: string;
  index: number;
  title: string;
  confidence: number;
  score: number;
}

export interface QueryResult {
  query: string;
  best: SearchMatch | null;
  matches: SearchMatch[];
}

export interface ProviderInfo {
  name: string;
  label: string;
  model: string;
  note: string;
  available: boolean;
}

export type RecognizeEvent =
  | { type: "meta"; tiles_total: number; width: number; height: number }
  | { type: "tile"; count: number; error: string | null; done: number; total: number }
  | { type: "books"; books: Book[]; tiles: TileInfo[]; shelf?: string }
  | { type: "done"; result: ShelfImage }
  | { type: "error"; error: string };

export const api = axios.create({ baseURL: "/api", timeout: 60000 });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function handle401() {
  // 只清登录态：App 里的 RequireAuth 会自动 <Navigate to="/login" replace />。
  // 用 window.location.href 跳转会整页刷新、丢掉 SPA 状态；且生产模式（FastAPI 托管 dist）
  // 直接刷新 /login 依赖服务端的 history fallback，否则会拿到静态资源的 404。
  useAuth.getState().logout();
}

api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err.response?.status === 401) handle401();
    return Promise.reject(err);
  },
);

function authHeaders(): Record<string, string> {
  const token = useAuth.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * <img> 等无法带请求头的资源，用 ?token= 鉴权。
 * 注意：后端只放行 /results/ 前缀的 ?token=，其它接口必须走 Authorization 请求头，
 * 否则会 401（这是有意为之，避免令牌扩散到各处 URL）。
 */
export function withToken(url: string): string {
  const token = useAuth.getState().token;
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

/**
 * SSE 识别：用 fetch 流式读取（axios 对 SSE 支持差）；crop 为归一化框 "x0,y0,x1,y1"，整图传 null。
 * signal 用于取消：abort 后 fetch/reader.read() 抛 AbortError，本函数会主动 reader.cancel()
 * 关闭响应流，服务端才能停止后续切块（否则会继续烧 API 额度）。
 */
export async function recognizeStream(
  file: File,
  useTiles: boolean,
  crop: string | null,
  onEvent: (e: RecognizeEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const fd = new FormData();
  fd.append("image", file);
  fd.append("tiles", useTiles ? "1" : "0");
  fd.append("name", file.name);
  if (crop) fd.append("crop", crop);

  const resp = await fetch("/api/recognize", {
    method: "POST",
    headers: authHeaders(),
    body: fd,
    signal,
  });
  if (resp.status === 401) handle401();
  if (!resp.ok) {
    let msg = resp.statusText;
    try {
      msg = (await resp.json()).detail || msg;
    } catch { /* 非 JSON 响应 */ }
    throw new Error(msg);
  }
  // resp.body 在 HTTP/1.0、或被代理缓冲后可能为 null，不能用非空断言
  if (!resp.body) {
    throw new Error("服务端未返回可读的响应流，无法读取识别进度");
  }
  const reader = resp.body.getReader();
  try {
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const ev = chunk.match(/^event: (\w+)\ndata: (.*)$/s);
        if (!ev) {
          // 静默跳过会造成"识别完了但界面没反应"且无从排查，至少留一条 warn
          console.warn("[SSE] 无法解析的事件块，已跳过:", chunk.slice(0, 200));
          continue;
        }
        const [, type, data] = ev;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          // 单条畸形事件跳过，不中断整个流
          console.warn("[SSE] data 不是合法 JSON，已跳过:", type, data.slice(0, 200));
          continue;
        }
        onEvent(type === "done" ? { type, result: parsed } : { type, ...parsed } as RecognizeEvent);
      }
    }
  } finally {
    // 提前退出（取消 / 组件卸载）时关闭流，服务端工作线程才能及时收工
    await reader.cancel().catch(() => {});
  }
}

export async function fetchResults(): Promise<ResultMeta[]> {
  return (await api.get<ResultMeta[]>("/results")).data;
}

export async function fetchResultDetail(id: string): Promise<ShelfImage> {
  return (await api.get<ShelfImage>(`/results/${encodeURIComponent(id)}`)).data;
}

/** 与后端对齐的导出上限：最多 200 条，ids 拼接后不超过 4000 字符 */
export const MAX_EXPORT_IDS = 200;
const MAX_EXPORT_IDS_LEN = 4000;
/** blob 回收延时：没有"下载完成"事件可监听，只能延后回收避免打断慢速下载 */
const REVOKE_DELAY_MS = 10_000;

/** 勾选记录导出 Excel：fetch 取 blob 后触发浏览器下载 */
export async function exportExcel(ids: string[]): Promise<void> {
  const list = ids.filter((s) => !!s);
  if (list.length === 0) throw new Error("请先勾选要导出的记录");
  if (list.length > MAX_EXPORT_IDS) {
    throw new Error(`一次最多导出 ${MAX_EXPORT_IDS} 条记录，当前选中 ${list.length} 条`);
  }
  const qs = list.map(encodeURIComponent).join(",");
  if (qs.length > MAX_EXPORT_IDS_LEN) {
    throw new Error("导出参数过长，请减少勾选的记录数量");
  }
  const resp = await fetch(`/api/export?ids=${qs}`, {
    headers: authHeaders(),
  });
  if (resp.status === 401) handle401();
  if (!resp.ok) {
    let msg = resp.statusText;
    try {
      msg = (await resp.json()).detail || msg;
    } catch { /* 非 JSON 响应 */ }
    throw new Error(msg);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `书架记录_${new Date().toISOString().slice(0, 10)}.xlsx`;
  // 部分浏览器（含隐私模式）不允许点击未挂载到 DOM 的节点
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export async function searchBooks(queries: string[]): Promise<QueryResult[]> {
  return (await api.post<{ results: QueryResult[] }>("/search", { queries })).data.results;
}

/** 列出可用的视觉模型供应商（供"重新识别"对话框勾选） */
export async function fetchProviders(): Promise<ProviderInfo[]> {
  return (await api.get<{ providers: ProviderInfo[] }>("/providers")).data.providers;
}

export interface ReidentifyResult {
  result: ShelfImage;
  counts: Record<string, number>;
  failed: Record<string, string>;
}

/** 对某条记录（该图）重新识别，可选多个供应商并智能融合，覆盖保存原记录 */
export async function reidentify(
  rid: string,
  providers: string[],
  useTiles: boolean,
): Promise<ReidentifyResult> {
  return (await api.post<ReidentifyResult>("/reidentify", { rid, providers, use_tiles: useTiles })).data;
}

/** 多书搜索"找到/未找到"汇总导出 Excel：fetch 取 blob 后触发下载 */
export async function exportSearchResults(queries: string[]): Promise<void> {
  if (queries.length === 0) throw new Error("没有可导出的书名");
  const resp = await fetch("/api/search/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ queries }),
  });
  if (resp.status === 401) handle401();
  if (!resp.ok) {
    let msg = resp.statusText;
    try {
      msg = (await resp.json()).detail || msg;
    } catch { /* 非 JSON 响应 */ }
    throw new Error(msg);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `查书结果_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** 删除单条记录（404 表示不存在或非本人） */
export async function deleteResult(rid: string): Promise<void> {
  await api.delete(`/results/${encodeURIComponent(rid)}`);
}

/** 删除当前用户全部识别记录（不可逆），返回删除条数 */
export async function deleteAllResults(): Promise<number> {
  return (await api.post<{ ok: boolean; deleted: number }>("/results/delete_all")).data.deleted;
}
