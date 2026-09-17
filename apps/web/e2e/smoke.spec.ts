import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// 需要先启动：server(8000) + web(5173)
const BASE = process.env.E2E_BASE ?? "http://localhost:5173";
const API = process.env.E2E_API ?? "http://127.0.0.1:8000";

const TEST_PASSWORD = "pass123"
/**
 * 新注册的账号名下没有任何识别记录，第 3 个用例（?load=）必然 skip。
 * 想真正跑到那条路径，先手工造一条记录，再用环境变量复用该账号：
 *   E2E_USERNAME=e2e_seed E2E_PASSWORD=pass123
 */
const FIXED_USER = process.env.E2E_USERNAME ?? ""
const FIXED_PASSWORD = process.env.E2E_PASSWORD ?? TEST_PASSWORD

/**
 * 登录一个测试用户并把令牌写进 localStorage。
 *
 * 之前三个用例都是匿名访问受保护路由：App 里的 RequireAuth 会直接 <Navigate to="/login" />，
 * 于是"上架 · 书架照片"等断言目标根本不存在，用例必挂；同时 /api/results 无鉴权返回 401，
 * resp.json() 拿到的是 {detail} 而不是数组，items.length 为 undefined，
 * test.skip 判断失效后 items[0] 直接是 undefined。
 */
async function loginAsTestUser(page: Page, request: APIRequestContext) {
  const username = FIXED_USER || `e2e_${Date.now()}`;
  const resp = FIXED_USER
    ? await request.post(`${API}/api/login`, {
        data: { username, password: FIXED_PASSWORD },
      })
    : await request.post(`${API}/api/register`, {
        data: { username, password: TEST_PASSWORD },
      });
  expect(resp.ok(), `登录测试用户失败：${resp.status()} ${await resp.text()}`).toBeTruthy();
  const body = (await resp.json()) as { token: string; username: string };
  await page.goto(BASE);
  await page.evaluate(
    ({ token, username: name }) => {
      localStorage.setItem("v3_token", token);
      localStorage.setItem("v3_username", name);
    },
    { token: body.token, username: body.username },
  );
  return body.token;
}

test.describe("架上寻书 冒烟测试", () => {
  test("首页加载：三张卡片与导航", async ({ page, request }) => {
    await loginAsTestUser(page, request);
    await page.goto(BASE);
    await expect(page.getByText("上架 · 书架照片")).toBeVisible();
    await expect(page.getByText("检索 · 要找的书")).toBeVisible();
    await expect(page.getByRole("link", { name: "记录", exact: true })).toBeVisible();
  });

  test("历史记录页可打开", async ({ page, request }) => {
    await loginAsTestUser(page, request);
    await page.goto(`${BASE}/history`);
    await expect(page.getByText("馆藏 · 历史识别记录")).toBeVisible();
  });

  test("?load= 链接载入历史并标红", async ({ page, request }) => {
    const token = await loginAsTestUser(page, request);
    const headers = { Authorization: `Bearer ${token}` };

    const resp = await request.get(`${API}/api/results`, { headers });
    expect(resp.ok(), `拉取历史记录失败：${resp.status()}`).toBeTruthy();
    const items = (await resp.json()) as { id: string }[];
    test.skip(
      !Array.isArray(items) || items.length === 0,
      `账号 ${FIXED_USER || "（本次新建的临时账号）"} 名下没有识别记录，?load= 路径未覆盖；` +
        "请先用真实账号跑一次识别，再以 E2E_USERNAME/E2E_PASSWORD 复用该账号重跑。",
    );

    const first = items[0];
    // 取该记录里置信度最高的非空书名做搜索词
    const detailResp = await request.get(`${API}/api/results/${first.id}`, { headers });
    const detail = (await detailResp.json()) as {
      books: { title: string; confidence: number }[];
    };
    const book = (detail.books ?? [])
      .filter((b) => b.title && b.title.length >= 3)
      .sort((a, b) => b.confidence - a.confidence)[0];
    test.skip(!book, "记录中没有可搜索的书名");

    await page.goto(`${BASE}/?load=${first.id}&q=${encodeURIComponent(book.title)}`);
    // 命中行置顶标红
    await expect(page.locator("tr.bg-match-bg").first()).toBeVisible();
    // 图片区标题显示命中数
    await expect(page.getByText(/命中 \d+/).first()).toBeVisible();
    // canvas 存在且已绘制（尺寸大于 0）
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
  });
});
