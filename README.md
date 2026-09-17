# 架上寻书 v2

拍一张书架照片，AI 识别所有书脊书名；输入要找的书名，在照片上用红框标出它的位置。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui |
| 状态/路由/HTTP | Zustand 5 + React Router 7 + Axios（SSE 用原生 fetch 流） |
| 表单 | react-hook-form + zod |
| 后端 | FastAPI + uv（DeepSeek `deepseek-flash` 视觉识别） |
| 测试 | Vitest（前端单测）+ pytest（后端）+ Playwright（端到端） |

## 目录

```
apps/
├── server/   FastAPI 后端（识别、切块合并、结果落盘）
└── web/      React 前端
```

## 开发

```bash
# 首次安装
cd apps/server && uv sync && cd ../..
pnpm install

# 启动（两个终端）
pnpm dev:server     # FastAPI → http://127.0.0.1:8000
pnpm dev:web        # Vite    → http://localhost:5173（已配 /api 代理）
```

浏览器打开 http://localhost:5173

## 测试

```bash
pnpm test                        # Vitest + pytest
pnpm --filter web run test:e2e   # Playwright 冒烟（需两个服务都在运行）
```

## 生产模式

```bash
pnpm build                       # 构建前端到 apps/web/dist
pnpm dev:server                  # FastAPI 直接托管 dist，单端口 8000
```

## 配置

密钥**只从环境变量读取**，`apps/server/config.json` 只保留非敏感项（`base_url` / `model` / `wechat_appid`），
模板见 `apps/server/config.example.json`。

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek 视觉接口密钥（`sk-...`）。**不设置时识别接口会直接报错**，不会静默失败 |
| `BOOKFINDER_SECRET` | 建议 | 令牌签名密钥。不设置则每次启动生成临时密钥，**重启后所有用户需重新登录** |
| `WECHAT_APPID` / `WECHAT_SECRET` | 可选 | 微信小程序登录，不设置时 `/api/auth/wechat` 返回 503 |
| `DEEPSEEK_BASE_URL` | 可选 | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 可选 | 默认 `deepseek-flash` |
| `BOOKFINDER_ENV` | 可选 | 设为 `prod` 时关闭 `/docs`、`/redoc`、`/openapi.json` |

Windows（cmd）示例：

```bat
set DEEPSEEK_API_KEY=sk-你的密钥
set BOOKFINDER_SECRET=一串至少32位的随机字符串
set BOOKFINDER_ENV=prod
uv run main.py
```

PowerShell 示例：

```powershell
$env:DEEPSEEK_API_KEY = "sk-你的密钥"
$env:BOOKFINDER_SECRET = [System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")
uv run main.py
```

> ⚠️ **安全提示**：早期版本把 DeepSeek API Key 明文写在 `apps/server/config.json` 里，现已改为环境变量。
> 如果那份 Key 曾经出现在任何被共享/备份/提交的目录中，请到 DeepSeek 控制台**吊销并重新申请**。

## 分享链接

`http://localhost:5173/?load=<识别记录id>&q=<书名>` — 直接打开某次识别并搜索。
