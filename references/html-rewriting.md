# HTML 改写与子目录部署

## 1. 服务器会改写 HTML 里的资源引用

托管在返回 HTML 前，把所有 `<link rel=… href>` 与 `<script src>` 换成：

```
https://cdn.rthe.cn/cached-<hash>/<domain>/<path>
```

图片另有 `-avif` 变体。后果：

- 用户网络访问不到 `cdn.rthe.cn` 时，页面白屏无样式（实测某些网络 80/443 全部超时）。
- 相对路径、`https://<domain>.rth1.xyz/...`、`//<domain>.rth1.xyz/...` **都会被改写**，换域名写法没用。

## 2. 唯一有效的绕法：内联 JS 注入

服务器不解析 JS 字符串，所以把标签交给浏览器插入即可：

```html
<script>document.write('<link rel="stylesheet" href="/sub/css/app.css">')</script>
<script>document.write('<script src="/sub/js/app.js"><\/script>')</script>
```

- `<\/script>` 必须转义，否则 HTML 解析器提前结束外层脚本。
- `document.write` 在解析期同步插入，**保持出现顺序**，适合有依赖顺序的脚本链。
- 等价的 `createElement` + `appendChild` 也可以，但要自己串顺序（`onload` 链或动态 `import`）。

批量替换（`<sub>` 是站点子目录）：

```js
html = html
  .replace(/<link rel="(stylesheet|icon)" href="([^"]+)">/g,
    (_, rel, href) => `<script>document.write('<link rel="${rel}" href="${href}">')<\/script>`)
  .replace(/<script src="([^"]+)"><\/script>/g,
    (_, src) => `<script>document.write('<script src="${src}"><\\/script>')<\/script>`);
```

## 3. 子目录部署必须改写的路径

把项目放到 `https://<domain>.rth1.xyz/<sub>/` 时：

| 位置 | 改写 |
|---|---|
| HTML 静态资源 | `href="/css/` → `href="/<sub>/css/`；`src="/js/` → `src="/<sub>/js/` |
| JS 里写死的站内路径 | 默认起始页、路由正则、`fetch('/api/...')` |
| 子页面（iframe 内）里的 `/js/xxx.js` | 同样加前缀，否则 404 后父页面永远等不到握手 |
| favicon | 站点 CSP 是 `img-src blob: https:`，`data:` 图标被拦，改成实体文件 |

典型症状：子页面加载协议依赖一个"握手"脚本（父等子页 `postMessage` 才隐藏 loading），前缀没改 → 一直转圈。

## 4. 没有后端时的降级

静态托管没有 Node/PHP 运行时（除非写云函数），`server.mjs` 那类反向代理、`/api/*` 一律 404。做法：

- 把依赖后端的地址抽成可配置全局（如 `window.APP_PROXY_PREFIX`），空值时直接嵌原地址。
- 页面文案同步改掉，别承诺"网址会经本地代理载入"。
- 直接 `<iframe>` 外站会受目标 `X-Frame-Options` / `frame-ancestors` 限制，多数大站禁止嵌入——要在交付说明里写清楚。

## 5. 缓存

- HTML：`Cache-Control: private, max-age=1`，改完刷新即可。
- CSS/JS：`max-age=14400`，但 URL 带内容哈希，内容变了 URL 就变，不会读到旧文件。
- 站点响应头：`Server: retinbox`、`Strict-Transport-Security`、`upgrade-insecure-requests`（页面内 `http://` 资源会被升级）。
