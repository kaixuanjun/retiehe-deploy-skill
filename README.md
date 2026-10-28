# retiehe-deploy-skill

把静态前端项目安全部署到[热铁盒（Retinbox）网页托管](https://docs.retiehe.com/host/auto-deploy.html)的 Agent 技能（Claude Code / DSH 等支持 `SKILL.md` 的技能目录）。

官方文档给的是 `deno -Ar https://host.retiehe.com/cli deploy`，那是**整站镜像同步**——会删掉远端"本地没有"的文件。只要你的站点上还挂着别的项目（博客、小工具、旧 demo），跑它就会一起清掉。本技能改用官方后端 API **增量写子目录**，只增不删。

## 它解决什么

| 场景 | 官方 CLI | 本技能 |
|---|---|---|
| 独占站点，一个项目 | ✅ 可用 | ✅ 可用 |
| 多项目共用站点 | ❌ 会删掉其他项目 | ✅ 只写目标子目录 |
| 部署到 `/项目名/` 子路径 | 不直接支持 | ✅ 含路径改写 |
| 站点资源被指向不可达 CDN | 无解 | ✅ 内联注入绕开 |
| 失败排查 | 报错即止 | 附症状→根因对照表 |

## 安装

```powershell
# Windows
git clone https://github.com/kaixuanjun/retiehe-deploy-skill.git
Copy-Item -Recurse retiehe-deploy-skill "$env:USERPROFILE\.dsh\skills\retiehe-deploy"
```

```bash
# macOS / Linux（DSH / Claude Code 的技能目录）
git clone https://github.com/kaixuanjun/retiehe-deploy-skill.git
cp -r retiehe-deploy-skill ~/.dsh/skills/retiehe-deploy
```

装好后在对话里提到「热铁盒 / Retinbox / rth1.xyz / 部署静态站」即会自动触发。

## 直接当命令行工具用

技能里的上传器可以脱离 Agent 单独跑：

```bash
export RTH_API_KEY=xxxx
node scripts/rth-upload.mjs --domain mysite --srcdir ./dist --dest myapp --verify
```

- `--domain`：免费域名只填子域名（`mysite` → `mysite.rth1.xyz`）
- `--srcdir`：本地目录
- `--dest`：远端子目录，留空即站点根
- `--dry-run`：只打印计划
- `--verify`：上传后校验（会识别平台的"软 404"，不会把根页当成功）

脚本会自动探测 API 节点（接口分散在 `api.retiehe.com` / `api-overseas` / `api-eo` 三台机器上，每台只认一部分路径），并自动区分文本（`/host/site/changes`）与二进制（`/host/site/binary`，multipart）。

## 内容

```
SKILL.md                    技能入口：决策、硬约束、流程、排查速查
references/api.md           端点表、写/删/二进制上传、限制
references/html-rewriting.md 子目录路径改写、CDN 改写绕法
references/verification.md  无头浏览器验收方法
references/troubleshooting.md 症状 → 根因 → 处理
scripts/rth-upload.mjs      通用增量上传器（零依赖，Node 20+）
```

## 关键事实（文档没写的）

1. 所有 API 必须带 `User-Agent: Mozilla/5.0 (win32) RTHHostHelper/6.2.2`，否则一律 `403`。
2. 上传接口的 `key` 字段是**远端相对路径**，不是 API 密钥。
3. 站点会把返回 HTML 里的 `<link>` / `<script src>` 改写成 `cdn.rthe.cn` 缓存地址；该 CDN 在部分网络不可达，页面会白屏无样式。绕过方式：改成内联脚本 `document.write` 注入。
4. 站点没有真正的 404：不存在的路径 `200` 返回站点根 `index.html`，"返回 200"不能作为部署成功的证据。
5. 官方 CLI 的 `deploy` 会删除远端多余文件，多项目站点禁用。

## License

MIT
