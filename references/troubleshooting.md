# 排查表

| 现象 | 根因 | 处理 |
|---|---|---|
| 所有 API `403 Forbidden` | 缺 `User-Agent: Mozilla/5.0 (win32) RTHHostHelper/6.2.2` | 每个请求都带上；403 时先怀疑 UA，不要先怀疑密钥 |
| 某个接口 `501 Not Implemented` | 走错 host：`api.retiehe.com` 只有验密钥，`/host/*` 只在 `api-overseas` / `api-eo` | 逐 host 探测，见 [api.md](api.md) |
| 上传成功但 URL 404/内容是根页 | 站点软 404：不存在的路径返回站点根 `index.html`（200） | 比对根页内容；确认 `key` 写的是远端相对路径 |
| `400 Bad Request`（binary 上传） | 给 FormData 手塞了 `Content-Type`，或 `key` 传成了 API 密钥 | 不设 Content-Type；`key` = 远端相对路径 |
| 偶发 `502`/`503`/`429` | 网关抖动 | 退避重试（FormData 要重建） |
| `deploy` 后站点上其他项目消失 | 官方 CLI 是镜像同步，会删掉"远端有、本地没有"的文件 | 改用 `/host/site/changes` 增量写；已删的只能凭备份/远端旧清单恢复 |
| 页面白屏、只剩裸 HTML | 资源被改写成 `cdn.rthe.cn`，当前网络不可达 | `document.write` 注入资源标签；验证时确认请求来自源站 |
| 页面有样式但脚本全挂 | 脚本顺序被破坏（改成动态插入时用了 async） | 用 `document.write` 保序，或串行 `onload` |
| 无头浏览器 `net::ERR_HTTP2_PROTOCOL_ERROR` | 站点拦无头 UA | `Network.setUserAgentOverride` 成桌面 Chrome UA |
| iframe 内页面一直转圈 | 子页里 `/js/agent.js` 之类根绝对路径在子目录下 404，父页等不到握手 | 所有子页 HTML 的绝对路径都要加子目录前缀 |
| 改了文件刷新还是旧的 | HTML `max-age=1`；也可能拿的是 CDN 缓存 | 等 1 秒强刷；确认响应头 `Cache-Control` |
| 某个文件没上传/被跳过 | CLI 单文件 >5MB 静默跳过 | 走 `/host/site/binary`（multipart：`content`/`domain`/`key`/`username`） |
| CLI 报 `Too many files` | >1000 文件 | 分批，或自己用 API 分批写 |
| `deno` 装不上 | 官网脚本依赖 GitHub，国内超时 | `npm install -g deno`（需 ≥2.8） |
| 站内 `data:` 图片（favicon）不显示 | CSP `img-src blob: https:` | 换成实体文件 |
| 页面里 `http://` 资源被强制跳 https | 站点 `upgrade-insecure-requests` | 直接用 https 地址 |
| 站内页面拿不到 `/api/*` | 静态托管无后端 | 前端降级 / 抽成可配置；要后端就写云函数 |
| 想确认远端到底有什么 | — | `GET /host/site/content?domain=&username=` 看 `hashes` 键名 |
