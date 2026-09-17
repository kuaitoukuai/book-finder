import { describe, expect, it } from "vitest";
import { levenshtein, normalize, similarity, splitQueries } from "@/lib/matching";

describe("normalize", () => {
  it("处理 undefined/null", () => {
    expect(normalize(undefined)).toBe("");
    expect(normalize(null)).toBe("");
  });
  it("去书名号与标点", () => {
    expect(normalize("《幽默社交》！")).toBe("幽默社交");
  });
  it("数字输入", () => {
    expect(normalize(123)).toBe("123");
  });
});

describe("similarity 边界", () => {
  it("undefined 书名不得分", () => {
    expect(similarity("社交", undefined)).toBe(0);
  });
  it("空查询不得分", () => {
    expect(similarity("", "幽默社交")).toBe(0);
    expect(similarity(null, "幽默社交")).toBe(0);
  });
  it("完全相同 = 1", () => {
    expect(similarity("《幽默社交》", "幽默社交")).toBe(1);
    expect(similarity("幽默 社交", "幽默社交")).toBe(1);
  });
  it("包含关系 ≥ 0.8", () => {
    expect(similarity("社交恐惧", "社交恐惧心理学")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("洞察社交关系", "洞察社交")).toBeGreaterThanOrEqual(0.8);
  });
  it("无关书名接近 0", () => {
    expect(similarity("书", "社交恐惧心理学")).toBeLessThan(0.3);
    expect(similarity("社交", "经济")).toBeLessThan(0.3);
  });
  it("模糊相似度落在合理区间", () => {
    const s = similarity("社交沟通", "线上社交超级沟通术");
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.7);
  });
});

describe("levenshtein", () => {
  it("空串", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
  it("长字符串性能", () => {
    const a = "社".repeat(5000), b = "交".repeat(5000);
    const t0 = Date.now();
    levenshtein(a, b);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("splitQueries", () => {
  it("多分隔符", () => {
    expect(splitQueries("幽默社交，社交恐惧；心理学\n经济学")).toEqual(
      ["幽默社交", "社交恐惧", "心理学", "经济学"]);
  });
  it("空输入", () => {
    expect(splitQueries("")).toEqual([]);
    expect(splitQueries("，。；")).toEqual([]);
  });
});
