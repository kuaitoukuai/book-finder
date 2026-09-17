/** 书名模糊匹配（移植自 v1 app.js，含对抗性边界处理） */

export function normalize(s: unknown): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/[《》〈〉「」『』【】\[\]()（）\-—_·:：,，.。!！?？'’"“”\s]/g, "");
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

export function similarity(query: unknown, title: unknown): number {
  const q = normalize(query), t = normalize(title);
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (t.includes(q) || q.includes(t)) {
    const shorter = Math.min(q.length, t.length);
    const longer = Math.max(q.length, t.length);
    return Math.max(0.8, shorter / longer);
  }
  return 1 - levenshtein(q, t) / Math.max(q.length, t.length);
}

export function splitQueries(raw: string): string[] {
  return raw.split(/[,，、;；。.\n]+/).map((s) => s.trim()).filter(Boolean);
}
