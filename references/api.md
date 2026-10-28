# API 参考

**接口分散在不同 host 上，每个 host 只认一部分路径**（实测 2026-02）：

| host | `/api-key-v2/verification` | `/host/*` |
|---|---|---|
| `https://api-overseas.retiehe.com/backend` | 501 | ✅ |
| `https://api-eo.retiehe.com/backend` | 501 | ✅ |
| `https://api.retiehe.com/backend` | ✅ | 501 |

所以脚本要逐个探测：验密钥用 `api.retiehe.com`，文件操作用 `api-overseas` / `api-eo`。
`501 Not Implemented` = "这个 host 没有这组接口"，不是语法错误，换下一个 host 即可（`scripts/rth-upload.mjs` 已内置探测）。

公共请求头（缺一不可）：

```
Authorization: Bearer <API_KEY>
User-Agent: Mozilla/5.0 (win32) RTHHostHelper/6.2.2
Accept-Language: zh-CN
Content-Type: application/json
```

缺少那个 UA 时所有接口返回 `403 Forbidden`。

## 端点

| 用途 | 请求 | 返回 |
|---|---|---|
| 验密钥 / 取 username | `GET /api-key-v2/verification?key=<API_KEY>` | `{"username":"15922..."}` |
| 站点列表 | `GET /host/sites?username=<username>` | `{"results":[{"domain":"kaixuanjun","hasSsl":true,"isOwner":true}]}` |
| 远端文件清单 | `GET /host/site/content?domain=<domain>&username=<username>` | `{"hashes":{"path/file.html":"<sha>"}}`（大站点几百 KB～数 MB） |
| 写 / 删文件 | `POST /host/site/changes` | `{"errorLog":null,"hashes":{...},"success":true}` |
| 二进制上传 | `POST /host/site/binary`（multipart） | 同上 |

## 写文件

```js
await fetch('https://api-overseas.retiehe.com/backend/host/site/changes', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${KEY}`,
    'User-Agent': 'Mozilla/5.0 (win32) RTHHostHelper/6.2.2',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    username,
    domain: 'kaixuanjun',
    changes: [{ operation: 'write', path: 'livemockup/index.html', content: html }],
  }),
});
```

- `path` 不带前导 `/`，目录层级用 `/` 分隔；父目录会自动创建。
- 一次可以带多个 `changes`，整批原子提交。
- `content` 是字符串；二进制走 `/host/site/binary`，见下。

## 二进制上传（multipart）

字段名容易搞错，**`key` 是远端相对路径，不是 API 密钥**（来自 CLI 源码 `Pd()`）：

| 字段 | 值 |
|---|---|
| `content` | 文件本体（`File`/`Blob`，带文件名） |
| `domain` | 子域名 |
| `key` | 远端相对路径，如 `livemockup/shot.png` |
| `username` | 账号 username |

```js
const fd = new FormData();
fd.append('content', new File([buf], 'shot.png'));
fd.append('domain', domain);
fd.append('key', 'livemockup/shot.png');
fd.append('username', username);
await fetch(`${API}/host/site/binary`, { method: 'POST', headers, body: fd });
```

- 不要给 FormData 请求设 `Content-Type`，让 fetch 自己生成 boundary；硬塞 `application/json` 会得到 `400`。
- FormData 是一次性流，重试要重建。
- 上传的图片会按 `?` 参数/UA 转成 AVIF（响应 `Content-Type: image/avif`，体积小一半），URL 后缀保持 `.png` 不影响。

## 删除文件

```js
changes: [{ operation: 'delete', path: 'livemockup/_probe.txt' }]
```

删除不可撤销；**不要**用它清理"远端有本地没有"的文件来模拟镜像同步——那正是官方 CLI 会毁掉别人站点的那一步。

## 限制

| 项 | 限制 |
|---|---|
| 单次部署文件数 | CLI 侧 >1000 报 `Too many files`（API 层未验证上限，仍建议分批） |
| 单文件大小 | CLI 侧 >5MB 静默跳过；更大走 binary 接口 |
| 站点总容量 | 未在文档中说明，实测 6.8MB / 104 文件正常 |
| 网关抖动 | 偶发 `502`/`503`/`429`，退避重试即可（`rth-upload.mjs` 重试 3 次） |

## 站点没有真正的 404

访问任何**不存在**的路径，站点会 `200` 返回**站点根 `index.html`**（软 404）。
所以"验证 URL 返回 200"证明不了部署成功——必须比对内容，或核对标题/关键字符串，或直接上浏览器看渲染。

## 官方 CLI 的行为（逆向 `https://dl.retiehe.com/host-cli/bundle.mjs`）

1. `GET /host/site/content` 拉远端清单；
2. 计算"远端有、本地没有"的文件 → 批量 `{operation:"delete"}`；
3. 上传本地文件（文本走 `changes`，二进制走 `binary`）。

第 2 步对多项目共用的站点是破坏性的，所以文档里 `deno ... deploy --site X --outdir .` 的用法只适合独占站点。
