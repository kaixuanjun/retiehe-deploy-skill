# 验证：必须看真实渲染

`curl`/`Invoke-WebRequest` 返回 200 只证明文件在服务器上，不证明页面能跑。资源可能全部指向不可达的 CDN。

## 无头浏览器最小验证

用 headless Chromium/Edge + CDP（本项目在 `tools/cdp.mjs` 有一份零依赖实现：`launch/goto/evaluate/shot/mouse/close`）。要点：

1. **覆盖 UA**，否则站点对无头 UA 直接返回 `ERR_HTTP2_PROTOCOL_ERROR`：
   ```js
   await cdp.send('Network.setUserAgentOverride', {
     userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
     acceptLanguage: 'zh-CN,zh;q=0.9',
   });
   ```
2. **记录资源请求**，确认 CSS/JS 来自 `<domain>.rth1.xyz` 而不是 `cdn.rthe.cn`：
   ```js
   cdp.on('Network.responseReceived', e => /\.(css|js)/.test(e.response.url) && log(e.response.status, e.response.url));
   ```
3. **查运行时状态**，不是查 DOM 文本：
   ```js
   { css: document.styleSheets.length, mod: typeof SomeGlobal, loading: readyState, err: window.__errors }
   ```
4. **截图人眼确认**布局/字体/颜色，再判断"部署成功"。

## 不要用回源拦截冒充验证

开发机连不上 CDN 时，可以临时用 `Fetch.enable` + `Fetch.fulfillRequest` 把 `https://cdn.rthe.cn/*` 回源到站点源站，用来区分"代码问题"和"网络问题"。但**最终验收必须是不做任何拦截的直连**，否则测的是你自己搭的链路。

## 顺带检查

- 站点上其他项目是否仍可访问（避免误删）：对它们的 URL 各来一次 200 检查。
- 探测文件、临时页（`_probe.txt`、`_p.html`）用完 `operation:"delete"` 清掉。
