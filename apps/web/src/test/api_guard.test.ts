import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_EXPORT_IDS, exportExcel, recognizeStream, withToken,
} from "@/lib/api";
import { matchSummary, sortedBooks, totalBooks } from "@/store/finder";
import type { ShelfImage } from "@/lib/api";

/**
 * 本轮前端加固的回归测试（QA 编写）。
 * 只测稳定、无需大量 DOM mock 的目标：
 *   - store/finder 的 booksOf 脏数据守卫（books 缺失/非数组）
 *   - lib/api 的 exportExcel 前置校验（在发请求之前就拦）
 *   - recognizeStream 的 SSE 解析健壮性 / signal 透传 / resp.body 判空
 *   - store/auth 的 localStorage 异常兜底（隐私模式不白屏）
 */

function img(books: unknown, id = "20260101_000000_001"): ShelfImage {
  return {
    id, name: "x.jpg", width: 10, height: 10,
    image_url: `/results/${id}/image.jpg`,
    books,
  } as unknown as ShelfImage;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
describe("booksOf 脏数据守卫（后端返回 books 非数组时不崩）", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["字符串", "not-a-list"],
    ["数字", 123],
    ["对象", { a: 1 }],
  ])("books 为 %s 时 totalBooks 返回 0 而不抛", (_label, books) => {
    const im = img(books);
    expect(() => totalBooks([im])).not.toThrow();
    expect(totalBooks([im])).toBe(0);
    expect(sortedBooks([im])).toEqual([]);
  });

  it("books 为数组时正常统计", () => {
    const im = img([
      { index: 1, title: "A", bbox: [0, 0, 1, 1], confidence: 0.9 },
      { index: 2, title: "B", bbox: [0, 0, 1, 1], confidence: 0.9 },
    ]);
    expect(totalBooks([im])).toBe(2);
    expect(sortedBooks([im])).toHaveLength(2);
  });

  it("matchSummary 在 books 非数组时不抛且计数为 0", () => {
    const im = img("oops");
    expect(() => matchSummary([im], "A")).not.toThrow();
    expect(matchSummary([im], "A").total).toBe(1);
    expect(matchSummary([im], "A").hits).toBe(0);
  });

  it("图片本身为 undefined 也不抛", () => {
    expect(() => totalBooks([undefined as unknown as ShelfImage])).not.toThrow();
    expect(totalBooks([undefined as unknown as ShelfImage])).toBe(0);
  });
});

// --------------------------------------------------------------------------
describe("exportExcel 前置校验（不发请求就拦下）", () => {
  it("空列表直接报错", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    await expect(exportExcel([])).rejects.toThrow("请先勾选要导出的记录");
    expect(f).not.toHaveBeenCalled();
  });

  it("超过 MAX_EXPORT_IDS 条直接报错", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const ids = Array.from({ length: MAX_EXPORT_IDS + 1 },
      (_, i) => `20260101_000000_${String(i).padStart(3, "0")}`);
    await expect(exportExcel(ids)).rejects.toThrow(/一次最多导出 200 条/);
    expect(f).not.toHaveBeenCalled();
  });

  it("ids 拼接超过 4000 字符直接报错", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const ids = Array.from({ length: 200 }, () => "x".repeat(30));
    expect(ids.join(",").length).toBeGreaterThan(4000);
    await expect(exportExcel(ids)).rejects.toThrow("导出参数过长");
    expect(f).not.toHaveBeenCalled();
  });

  it("上限常量与后端对齐", () => {
    expect(MAX_EXPORT_IDS).toBe(200);
  });
});

// --------------------------------------------------------------------------
/** 造一个最小的 SSE 响应：recognizeStream 只读 status/ok/body.getReader() */
function sseResponse(chunks: string[]) {
  let i = 0;
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length
          ? { done: false, value: encoder.encode(chunks[i++]) }
          : { done: true, value: undefined }),
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

describe("recognizeStream SSE 健壮性", () => {
  it("畸形事件块被跳过而不是中断整个流", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([
      'event: meta\ndata: {"tiles_total":1,"width":10,"height":10}\n\n',
      "这不是一个合法的事件块\n\n",                       // 无 data: 字段
      "event: tile\ndata: {坏掉的 json\n\n",                // data 非 JSON
      'event: done\ndata: {"id":"20260101_000000_001"}\n\n',
    ]));

    const seen: string[] = [];
    await recognizeStream(new File(["x"], "a.jpg"), false, null,
      (e) => seen.push(e.type));

    expect(seen).toEqual(["meta", "done"]);
    expect(warn).toHaveBeenCalled();
  });

  it("resp.body 为空时给出明确报错，不静默成功", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, statusText: "OK", body: null,
    } as unknown as Response);
    await expect(
      recognizeStream(new File(["x"], "a.jpg"), false, null, () => {})
    ).rejects.toThrow("无法读取识别进度");
  });

  it("signal 透传给 fetch（取消才能传到服务端）", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([]));
    const ac = new AbortController();
    await recognizeStream(new File(["x"], "a.jpg"), false, null, () => {},
      ac.signal);
    expect(spy.mock.calls[0][1]?.signal).toBe(ac.signal);
  });

  it("非 2xx 时抛出后端 detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, status: 413, statusText: "Payload Too Large",
      json: async () => ({ detail: "图片过大，请压缩到 30MB 以内" }),
    } as unknown as Response);
    await expect(
      recognizeStream(new File(["x"], "a.jpg"), false, null, () => {})
    ).rejects.toThrow("图片过大，请压缩到 30MB 以内");
  });
});

// --------------------------------------------------------------------------
describe("withToken（?token= 只允许 /results/）", () => {
  it("无 token 时原样返回", async () => {
    const { useAuth } = await import("@/store/auth");
    useAuth.setState({ token: null });
    expect(withToken("/results/a/image.jpg")).toBe("/results/a/image.jpg");
  });

  it("有 token 时拼到 URL 上", async () => {
    const { useAuth } = await import("@/store/auth");
    useAuth.setState({ token: "abc.def" });
    expect(withToken("/results/a/image.jpg"))
      .toBe("/results/a/image.jpg?token=abc.def");
  });
});

// --------------------------------------------------------------------------
describe("store/finder loadOverrides 脏数据守卫", () => {
  // localStorage 被手改成 null/123/[] 时，loadOverrides 必须回落成 {} 而不是直接取属性抛错
  it.each([
    ["null", "null"],
    ["数字", "123"],
    ["数组", "[1,2,3]"],
    ["字符串", '"abc"'],
    ["坏 JSON", "{oops"],
  ])("localStorage 里是 %s 时 addImage 不崩", async (_label, raw) => {
    localStorage.setItem("v3_title_overrides", raw);
    vi.resetModules();
    const { useFinder } = await import("@/store/finder");

    const im = {
      id: "r1", name: "x.jpg", width: 1, height: 1,
      image_url: "/results/r1/image.jpg",
      books: [{ index: 1, title: "A", bbox: [0, 0, 1, 1], confidence: 0.9 }],
    } as unknown as ShelfImage;

    expect(() => useFinder.getState().addImage(im)).not.toThrow();
    expect(useFinder.getState().images).toHaveLength(1);
  });

  it("localStorage 里是合法对象时行内修改能被合并回来", async () => {
    localStorage.setItem("v3_title_overrides",
      JSON.stringify({ r1: { 1: "改过的书名" } }));
    vi.resetModules();
    const { useFinder } = await import("@/store/finder");

    const im = {
      id: "r1", name: "x.jpg", width: 1, height: 1,
      image_url: "/results/r1/image.jpg",
      books: [{ index: 1, title: "原书名", bbox: [0, 0, 1, 1], confidence: 0.9 }],
    } as unknown as ShelfImage;

    useFinder.getState().addImage(im);
    expect(useFinder.getState().images[0].books[0].title).toBe("改过的书名");
  });
});

// --------------------------------------------------------------------------
describe("store/auth localStorage 兜底（隐私模式不白屏）", () => {
  it("getItem/setItem/removeItem 抛 SecurityError 时仍能初始化与登出", async () => {
    const boom = () => { throw new Error("SecurityError"); };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);

    vi.resetModules();
    const { useAuth } = await import("@/store/auth");

    // 模块加载时就会读 localStorage：不包 try/catch 这里直接抛，整个应用白屏
    expect(useAuth.getState().token).toBeNull();
    expect(useAuth.getState().username).toBeNull();
    expect(() => useAuth.getState().logout()).not.toThrow();
  });
});
