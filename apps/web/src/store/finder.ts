import { create } from "zustand";
import { similarity, splitQueries } from "@/lib/matching";
import type { Book, ShelfImage } from "@/lib/api";

export interface SelectedBook {
  imgIdx: number;
  bookIdx: number;
  /** 每次定位自增，用于触发 ShelfViewer 的滚动/闪烁副作用 */
  nonce: number;
}

interface FinderState {
  images: ShelfImage[];
  query: string;
  simThreshold: number;   // 0.5 ~ 1
  confThreshold: number;  // 0 ~ 1
  fontScale: number;      // 标注文字大小倍率 0.15 ~ 1.5
  selected: SelectedBook | null;
  addImage: (img: ShelfImage) => void;
  removeImages: (rids: string[]) => void;
  setQuery: (q: string) => void;
  setSimThreshold: (v: number) => void;
  setConfThreshold: (v: number) => void;
  setFontScale: (v: number) => void;
  updateTitle: (imgIdx: number, bookIdx: number, title: string) => void;
  replaceImage: (imgIdx: number, img: ShelfImage) => void;
  locate: (imgIdx: number, bookIdx: number) => void;
  clearSelected: () => void;
}

/** 后端返回脏数据（books 缺失/非数组）时不至于整页崩溃 */
function booksOf(img: ShelfImage): Book[] {
  return Array.isArray(img?.books) ? img.books : [];
}

function applySearch(images: ShelfImage[], query: string,
                     simTh: number, confTh: number) {
  const queries = splitQueries(query);
  for (const img of images) {
    for (const b of booksOf(img)) {
      b.matched = false; b.score = 0; b.matchQuery = "";
      if (b.confidence < confTh) continue;
      for (const q of queries) {
        const s = similarity(q, b.title);
        if (s >= simTh && s > (b.score ?? 0)) {
          b.matched = true; b.score = s; b.matchQuery = q;
        }
      }
    }
  }
}

const OVERRIDE_KEY = "v3_title_overrides";

type TitleOverrides = Record<string, Record<number, string>>;

function loadOverrides(): TitleOverrides {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // localStorage 被手改成 null/"123"/[] 时不能直接当对象用，否则后面取属性会抛
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as TitleOverrides;
    }
    return {};
  } catch {
    return {};
  }
}

function saveOverride(rid: string, bookIndex: number, title: string) {
  const all = loadOverrides();
  all[rid] = { ...all[rid], [bookIndex]: title };
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all));
  } catch { /* 存储满/被禁用等异常忽略，行内修改只是本地增强 */ }
}

/** 载入记录时把本地行内修改合并回来（后端不落库，刷新不丢失） */
function applyOverrides(img: ShelfImage) {
  const o = loadOverrides()[img.id];
  if (!o) return;
  for (const b of booksOf(img)) {
    if (o[b.index] !== undefined) b.title = o[b.index];
  }
}

/** 记录被删除后，本地修改缓存一并清掉 */
function purgeOverrides(rids: string[]) {
  const all = loadOverrides();
  let dirty = false;
  for (const rid of rids) {
    if (rid in all) {
      delete all[rid];
      dirty = true;
    }
  }
  if (!dirty) return;
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all));
  } catch { /* 忽略 */ }
}

export const useFinder = create<FinderState>((set, get) => ({
  images: [],
  query: "",
  simThreshold: 0.75,
  confThreshold: 0,
  fontScale: 0.4,
  selected: null,

  addImage: (img) => {
    const { images, query, simThreshold, confThreshold } = get();
    if (images.some((im) => im.id === img.id)) return; // 防重复载入
    applyOverrides(img);
    const next = [...images, img];
    applySearch(next, query, simThreshold, confThreshold);
    set({ images: next });
  },

  removeImages: (rids) => {
    if (!rids.length) return;
    const dead = new Set(rids);
    const { images } = get();
    purgeOverrides(rids);
    // 删除后 images 下标移位，selected 的 imgIdx/bookIdx 全部失效，直接清掉
    set({ images: images.filter((im) => !dead.has(im.id)), selected: null });
  },

  setQuery: (q) => {
    const { images, simThreshold, confThreshold } = get();
    applySearch(images, q, simThreshold, confThreshold);
    set({ query: q, images: [...images] });
  },
  setSimThreshold: (v) => {
    const { images, query, confThreshold } = get();
    applySearch(images, query, v, confThreshold);
    set({ simThreshold: v, images: [...images] });
  },
  setConfThreshold: (v) => {
    const { images, query, simThreshold } = get();
    applySearch(images, query, simThreshold, v);
    set({ confThreshold: v, images: [...images] });
  },

  setFontScale: (v) => set({ fontScale: v }),

  updateTitle: (imgIdx, bookIdx, title) => {
    const { images, query, simThreshold, confThreshold } = get();
    const img = images[imgIdx];
    const b = booksOf(img)[bookIdx];
    if (!img || !b) return;
    b.title = title;
    saveOverride(img.id, b.index, title);
    applySearch(images, query, simThreshold, confThreshold);
    set({ images: [...images] });
  },

  replaceImage: (imgIdx, img) => {
    const { images, query, simThreshold, confThreshold } = get();
    if (!images[imgIdx]) return;
    if (img.id && img.id !== images[imgIdx].id) return; // 只允许替换同一条记录
    applyOverrides(img); // 把本地行内修改合并回新结果
    const next = [...images];
    next[imgIdx] = img;
    applySearch(next, query, simThreshold, confThreshold);
    set({ images: next, selected: null });
  },

  locate: (imgIdx, bookIdx) =>
    set({ selected: { imgIdx, bookIdx, nonce: Date.now() } }),
  clearSelected: () => set({ selected: null }),
}));

export function matchSummary(images: ShelfImage[], query: string) {
  const queries = splitQueries(query);
  let hits = 0;
  const hitQueries = new Set<string>();
  for (const img of images) {
    for (const b of booksOf(img)) {
      if (b.matched) { hits++; hitQueries.add(b.matchQuery ?? ""); }
    }
  }
  const missed = queries.filter((q) => !hitQueries.has(q));
  return { hits, covered: hitQueries.size, total: queries.length, missed };
}

export function totalBooks(images: ShelfImage[]): number {
  return images.reduce((n, im) => n + booksOf(im).length, 0);
}

export function sortedBooks(images: ShelfImage[]) {
  const rows: { imgIdx: number; bookIdx: number; book: Book; img: ShelfImage }[] = [];
  images.forEach((img, imgIdx) =>
    booksOf(img).forEach((book, bookIdx) => rows.push({ imgIdx, bookIdx, book, img })));
  rows.sort((a, b) => Number(b.book.matched ?? false) - Number(a.book.matched ?? false));
  return rows;
}
