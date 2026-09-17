# 架上寻书 V3 — 微信小程序端

原生小程序（无 npm 依赖），配合 V3 FastAPI 后端使用。API 契约见 `docs/v3-api.md`。

## 目录结构

```
miniprogram/
├── app.js / app.json / app.wxss   # 入口、页面与 tabBar 注册
├── project.config.json            # appid 为 touristappid（测试号）
├── sitemap.json
├── utils/
│   ├── config.js                  # ★ 后端地址 BASE_URL，唯一需要改的配置
│   └── request.js                 # 请求封装：自动带 token、401 跳登录、SSE 文本解析
└── pages/
    ├── login/                     # 登录 / 注册切换
    ├── index/                     # 识别：选图/内置相机 → 框选裁剪 → 上传识别 → 结果
    ├── history/                   # 记录列表，多选导出 Excel
    ├── historyDetail/             # 记录详情：图片 + 书籍列表
    ├── search/                    # 多行书名搜索，best 高亮
    └── me/                        # 用户名、退出登录、关于
```

## 导入微信开发者工具

1. 打开微信开发者工具 → 导入项目 → 选择本目录（`apps/miniprogram`）。
2. appid 已填 `touristappid`（测试号），无需真实小程序账号即可预览。
3. 基础库选择 3.x（project.config.json 中 libVersion 为 3.8.0）。

## 配置后端地址

改 `utils/config.js` 中的 `BASE_URL`：

- 开发者工具 + 本机后端：保持 `http://127.0.0.1:8000`，
  并在「详情 → 本地设置」勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。
- 真机调试：改成电脑局域网 IP（如 `http://192.168.1.100:8000`），手机与电脑连同一 Wi-Fi；
  后端需监听 `0.0.0.0`（如 `uvicorn main:app --host 0.0.0.0 --port 8000`）。
- 正式上线：必须使用 HTTPS 域名并在小程序后台配置 request / uploadFile / downloadFile 合法域名。

## 微信一键登录

登录页默认展示「微信一键登录」（POST /api/auth/wechat），账号密码登录作为备选。要真正可用需同时满足：

1. 后端配置微信登录凭据（未配置时接口返回 503）：
   - `wechat_appid`（AppID 非密钥）可写在 `apps/server/config.json`，或用环境变量 `WECHAT_APPID`；
   - `wechat_secret`（AppSecret）**只能**通过环境变量 `WECHAT_SECRET` 提供，
     `config.json` 中的 `wechat_secret` 已废弃并被后端忽略。
2. `project.config.json` 的 `appid` 从 `touristappid` 换成同一个小程序的真实 AppID。
   **touristappid 下 wx.login 拿到的 code 无法通过真实 code2session**，
   微信登录会报 401，此时请使用账号密码登录（开发者工具内可正常测试）。

## 使用流程

1. 注册 / 登录（微信一键登录或账号密码），token 存本地缓存。
2. 「识别」页：拍照/相册选图，或用内置 `<camera>` 直接拍摄。
3. 进入裁剪界面：拖动四角调整框选范围，拖动框体整体移动；
   建议框选一层书架并包含书架号标签。「全图」可放弃裁剪。
4. 确认后客户端先用 Canvas 裁剪出局部图上传（此时不再传 crop）；
   若客户端裁剪失败，则上传原图并把归一化 crop 传给后端兜底。
5. 识别完成展示整架号和书籍列表（书名 + 置信度）。
6. 「记录」页可查看历史、勾选后导出 Excel；「搜索」页每行一个书名批量查找。

## 已知限制

- **SSE 降级**：wx.request / wx.uploadFile 不支持流式读取，识别过程没有实时进度条；
  客户端在响应文本中解析最后一个 `event: done` 作为结果，包含 `event: error` 则报错。
- 客户端裁剪基于 Canvas 2D，超大图会先缩到 2048px 以内再导出；裁剪失败时退回原图上传，
  由后端按 crop 参数裁剪兜底。
- tabBar 采用纯文字配置（无图标），如需图标请自行添加 `iconPath` / `selectedIconPath`。
- 内置相机需要用户在系统中授予相机权限，未授权时可改用相册选图。
