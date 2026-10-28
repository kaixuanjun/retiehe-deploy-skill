---
name: retiehe-deploy
description: Deploy a static front-end project (or a subdirectory of one) to Retinbox / 热铁盒 web hosting (docs.retiehe.com, *.rth1.xyz) with an API key — including incremental sub-path deploys that do not wipe other projects on a shared site. Use when the user mentions 热铁盒 / Retinbox / rth1.xyz / host.retiehe.com, gives an RTH_API_KEY, or asks to deploy static files to their hosting.
---

# 热铁盒（Retinbox）网页托管部署

官方文档：<https://docs.retiehe.com/host/auto-deploy.html>。它描述的 `deno -Ar https://host.retiehe.com/cli deploy` 是**整站镜像同步**，会删除远端"本地没有"的文件。**站点上还有别的项目时，绝不能跑它。** 用本技能里的 API 增量写。

## 先做判断

```
站点上是否已有别的项目？（GET /host/site/content，看 hashes 里有没有不属于本项目的路径）
├─ 否，站点专属于这个项目 → 官方 CLI 可用（deno ... deploy --site <子域名> --outdir <相对目录>）
└─ 是 / 想部署到子目录 → 走下面的 API 增量流程（推荐，本技能主线）
```

不确定时一律走 API 流程：它只写文件，最坏情况是多几个文件，不会删掉别人的站。

## 三条硬约束（违反就失败）

1. **每个请求都要带 `User-Agent: Mozilla/5.0 (win32) RTHHostHelper/6.2.2`**。缺了全部 `403 Forbidden`，curl / Node / PowerShell / Deno 默认 UA 都过不去。报 403 时先查这个，不要怀疑密钥。
2. **认证是 `Authorization: Bearer <API_KEY>`**。`init` 向导只负责写 `.env` 和往 `package.json` 加 `npm run deploy`，不是必需品。
3. **`path` 用 `/` 分隔、不带前导斜杠**，子目录直接写进路径（如 `livemockup/css/app.css`）。子目录站点按目录提供静态服务，`https://<子域名>.rth1.xyz/<子目录>/` 会打开其中的 `index.html`。

另外两个容易踩的：接口分在不同 host（`api.retiehe.com` 有验密钥但 `/host/*` 返 501，`api-overseas` / `api-eo` 相反，要自动探测）；站点**没有真 404**，不存在的路径会 200 返回站点根页，所以"200"不等于部署成功。

## 标准流程

1. **暂存 + 改写**：把要部署的静态产物复制到临时目录（如 `.deploy/<子目录>/`），并把 HTML 里的根绝对路径 `/css/`、`/js/`、`/assets/` 改写成 `/<子目录>/...`。同时检查前端代码里写死的站内路径常量（默认页、正则、跳转），一并改。参见 [references/html-rewriting.md](references/html-rewriting.md)。
2. **上传**：`RTH_API_KEY=... node scripts/rth-upload.mjs --domain <子域名> --srcdir .deploy/<子目录> --dest <子目录>`
3. **验证**：HTTP 200 + 长度只是最低门槛，必须用无头浏览器看真实渲染（见下）。

## 验证（不能只 curl）

托管返回的 HTML 里，资源引用会被服务端改写成 `https://cdn.rthe.cn/cached-<hash>/...`。这意味着：

- 页面能否工作取决于 `cdn.rthe.cn` 在**用户网络**是否可达。开发机连不上时 `curl` 一样 200，但浏览器里白屏无样式。
- 所以验证要跑真实浏览器：`document.styleSheets.length`、`typeof <主模块全局>`、关键 DOM 是否渲染、控制台是否报错，再截图人眼看。
- 无头 UA 会被站点直接打成 `ERR_HTTP2_PROTOCOL_ERROR`，先 `Network.setUserAgentOverride` 成桌面 Chrome UA。

细节见 [references/verification.md](references/verification.md)。

## 何时读哪个文件

| 需要 | 文件 |
|---|---|
| API 端点、请求体、返回、限制 | [references/api.md](references/api.md) |
| HTML 资源改写、子目录路径改写、`document.write` 绕法 | [references/html-rewriting.md](references/html-rewriting.md) |
| 无头浏览器验证步骤 | [references/verification.md](references/verification.md) |
| 报错/白屏/转圈的排查表 | [references/troubleshooting.md](references/troubleshooting.md) |

## 排查速查

| 现象 | 处理 |
|---|---|
| 403 | 补 `RTHHostHelper/6.2.2` UA |
| 501 | 走错 host 了：换 `api-overseas` / `api-eo`（或 `api.retiehe.com` 仅用于验密钥） |
| 部署后站点别的项目消失 | 用了官方 CLI 的镜像同步；改 API 增量写 |
| 白屏 / 裸 HTML | 资源被指向 `cdn.rthe.cn` 且不可达 → `document.write` 注入 |
| 无头浏览器 `ERR_HTTP2_PROTOCOL_ERROR` | 覆盖桌面 UA |
| 内嵌子页一直转圈 | 子页里的 `/js/agent.js` 等根绝对路径在子目录下 404 |
| URL 返回 200 但内容是根页 | 站点软 404，该路径其实不存在（比对根页内容即可确认） |
| 改了文件还是旧的 | HTML 缓存 `max-age=1`，稍等强刷；带哈希的 CSS/JS 不会旧 |
| 单文件被跳过 | >5MB 走 `/host/site/binary`；>1000 文件 CLI 会拒绝 |
| 偶发 502/503 | 网关抖动，退避重试 |
