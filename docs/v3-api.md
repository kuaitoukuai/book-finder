# 架上寻书 V3 — API 契约

V3 在 V2 基础上新增：用户注册登录、识别记录按用户隔离、识别前裁剪（camera crop）、
多本书同时搜索（含最高置信度推荐）、服务端日志落盘。

所有 `/api/**` 接口（除 `/api/register`、`/api/login`、`/api/health`）都需要认证：
请求头 `Authorization: Bearer <token>`。
图片等需要 `<img>` 标签直接加载的资源，允许用查询参数 `?token=<token>` 代替请求头。

## 认证

### POST /api/register
请求 JSON：`{"username": "...", "password": "..."}`
- username：2~32 字符，字母/数字/下划线/中文
- password：≥6 位
响应 200：`{"token": "...", "username": "..."}`
冲突 409：`{"detail": "用户名已存在"}`

### POST /api/login
请求 JSON：`{"username": "...", "password": "..."}`
响应 200：`{"token": "...", "username": "..."}`
失败 401：`{"detail": "用户名或密码错误"}`

### POST /api/auth/wechat
微信小程序登录：小程序端 `wx.login()` 拿 code 发给本接口换 openid 登录。
请求 JSON：`{"code": "..."}`
- 服务端调微信 `jscode2session` 换 openid，按 openid 查用户；
  不存在则自动创建无密码用户（username 为 `wx_` + openid 前 8 位，冲突追加序号），
  该用户不能用密码登录。
响应 200：`{"token": "...", "username": "..."}`
- 未配置 503：config.json 缺 `wechat_appid`/`wechat_secret` → `{"detail": "微信登录未配置"}`
- 失败 401：微信返回 errcode → `{"detail": "微信登录失败: <errmsg>"}`

### GET /api/me
响应 200：`{"username": "..."}`

token 为服务端签名的 HMAC 令牌（含过期时间，默认 30 天），无状态校验。

## 识别（含裁剪）

### POST /api/recognize  （multipart/form-data）
字段：
- `image`：图片文件（必填）
- `tiles`：`"1"`（默认，切块识别）/ `"0"`（整图单次）
- `name`：记录显示名（可空，默认取文件名）
- `crop`：可空。归一化裁剪框 `"x0,y0,x1,y1"`（0~1，相对原图）。
  服务端先按 crop 裁剪原图再切块识别；保存的 image.jpg 为裁剪后的图，
  返回的 bbox 均相对裁剪后图片。用于"只拍/只识别单层书架"的场景：
  客户端在拍照后让用户框选一层书架（含架标），上传原图+crop 即可，
  减少上下半层干扰、降低 API 消耗。

响应：`text/event-stream`（SSE），事件序列与 V2 相同：
- `event: meta` → `{"tiles_total": n, "width": w, "height": h}`（宽高为裁剪后；
  tiles="1" 且多切块时 n 含 1 个整图框架块）
- `event: tile` → `{"tile": [x0,y0,x1,y1], "pass": "frame|detail", "count": n, "error": null, "done": i, "total": n}`
- `event: books` → `{"books": [...], "tiles": [...], "shelf": "整架号",
  "stats": {"frame_count": n, "detail_count": n, "filled": n}}`
- `event: done` → 完整记录 JSON：
  `{"id", "name", "width", "height", "image_url", "shelf", "books", "tiles", "stats", "created_at"}`
- `event: error` → `{"error": "..."}`

book 对象：`{"index", "title", "author", "shelf", "confidence", "bbox":[x1,y1,x2,y2]}`
（框架补漏的书另有 `"source": "frame"`）

两遍识别：tiles="1" 时服务端并行发一个整图调用（框架块），其结果不直接进书籍列表，
只用于补漏（切块漏掉的书以 confidence×0.8 + source="frame" 补入）与 stats 验证；
架标以切块书投票为准，整图架标仅在切块完全未读到时兜底；
碎片合并后处理会把误拆出的作者名/卷数窄条并回相邻书。

## 记录（按用户隔离）

### GET /api/results
响应：`[{"id", "name", "count", "shelf", "created_at"}]`（仅当前用户，新的在前）

### GET /api/results/{rid}
响应：完整记录 JSON（同 done 事件）。只能访问本人的记录，否则 404。

### DELETE /api/results/{rid}
删除本人一条记录（含图片与结果 JSON）。只能删本人的记录，否则 404。
响应 200：`{"ok": true}`。**不可逆操作。**

### POST /api/results/delete_all
删除当前用户的全部记录。**不可逆操作，前端调用前必须二次确认。**
响应 200：`{"ok": true, "deleted": n}`

### GET /results/{rid}/image.jpg
记录图片（裁剪后）。支持 `?token=`。

### GET /api/export?ids=rid1,rid2
导出 Excel（.xlsx），仅导出本人记录。列：图片名称、书架号、序号、书名、作者、置信度、x1..y2。

### DELETE /api/results/{rid}
删除单条记录（图片与识别结果一起删除，不可恢复），仅限本人记录。
响应 200：`{"ok": true}`
记录不存在或非本人 404：`{"detail": "..."}`

### POST /api/results/delete_all
删除当前用户全部识别记录（不可恢复）。
响应 200：`{"ok": true, "deleted": n}`

## 多书搜索

### POST /api/search
请求 JSON：`{"queries": ["书名1", "书名2", ...]}`（1~50 个）
在当前用户所有记录的书籍中做模糊匹配（书名包含/相似度）。
响应 200：
```json
{
  "results": [
    {
      "query": "书名1",
      "best": {"record_id", "record_name", "shelf", "index", "title",
               "confidence", "score"} ,
      "matches": [ {"record_id", "record_name", "shelf", "index", "title",
                    "confidence", "score"}, ... ]
    }
  ]
}
```
- `score`：匹配置信分（0~1，综合相似度与识别置信度）
- `best`：matches 中置信度最高的一条，置信度相同取 score 高者（即"推荐的那一册"）；无匹配时为 `null`
- matches 按 score 降序，最多 20 条

## 其他

### GET /api/health
`{"ok": true, "model": "...", "key_set": true}`

## 错误格式
FastAPI 默认：`{"detail": "..."}`，SSE 流内错误用 `event: error`。
