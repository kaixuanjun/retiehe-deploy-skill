#!/usr/bin/env node
/**
 * 增量上传静态文件到热铁盒（Retinbox）网页托管。
 *
 * 只写文件，不删除远端已有内容，因此可以安全地部署到多项目共用站点的子目录。
 *
 *   RTH_API_KEY=xxxx node rth-upload.mjs --domain kaixuanjun --srcdir .deploy/livemockup --dest livemockup
 *
 * 参数：
 *   --domain <子域名>   免费域名只填子域名，如 kaixuanjun（对应 kaixuanjun.rth1.xyz）
 *   --srcdir <目录>     本地要上传的目录
 *   --dest <前缀>       远端目录前缀，留空表示站点根目录
 *   --dry-run           只打印将写入的路径
 *   --verify            上传后检查 https://<domain>.rth1.xyz/<dest>/ 是否 200
 *
 * 环境变量：
 *   RTH_API_KEY         必填
 *   RTH_API             可选，默认 https://api-overseas.retiehe.com/backend
 */
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.RTH_API_KEY;
const UA = 'Mozilla/5.0 (win32) RTHHostHelper/6.2.2';

/* 后端的接口不是同一个 host 全都有：实测 api.retiehe.com 有 /api-key-v2/verification
   但 /host/* 返回 501，api-overseas / api-eo 则相反。所以逐个探测，各取所需。 */
const BASES = [
  process.env.RTH_API,
  'https://api-overseas.retiehe.com/backend',
  'https://api-eo.retiehe.com/backend',
  'https://api.retiehe.com/backend',
].filter(Boolean);

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const domain = arg('domain');
const srcdir = path.resolve(arg('srcdir'));
const dest = arg('dest').replace(/^\/+|\/+$/g, '');
const dryRun = flag('dry-run');

if (!KEY) {
  console.error('缺少环境变量 RTH_API_KEY');
  process.exit(1);
}
if (!domain || !fs.existsSync(srcdir) || !fs.statSync(srcdir).isDirectory()) {
  console.error('用法：--domain <子域名> --srcdir <本地目录> [--dest <远端前缀>] [--dry-run] [--verify]');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  'Accept-Language': 'zh-CN',
  'User-Agent': UA,
};

/* 网关偶发 502/503/504 与 429，退避重试几次再放弃 */
async function send(url, init = {}, attempt = 0) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 3) {
    const wait = 800 * 2 ** attempt;
    console.warn(`  ${res.status} 重试中（${wait}ms）…`);
    await new Promise((r) => setTimeout(r, wait));
    return send(url, init, attempt + 1);
  }
  return res;
}

async function json(url, init = {}) {
  const res = await send(url, init);
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${init.method || 'GET'} ${url} -> ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

/* 从多个 base 里找出能用的那个；501 = 该 host 没有这组接口，直接换下一个 */
async function pickBase(pathAndQuery, validate) {
  const tried = [];
  for (const base of BASES) {
    try {
      const out = await json(`${base}${pathAndQuery}`);
      if (!validate || validate(out)) return { base, out };
      tried.push(`${base} -> 响应不符合预期`);
    } catch (e) {
      tried.push(`${base} -> ${e.status || ''} ${e.message.slice(0, 80)}`);
    }
  }
  throw new Error(`所有 API 节点都失败：\n${tried.join('\n')}`);
}

function walk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, base, acc);
    else if (e.isFile()) acc.push({ abs, rel: path.relative(base, abs).split(path.sep).join('/') });
  }
  return acc;
}

const isBinary = (buf) => buf.includes(0);

const { out: verified } = await pickBase(
  `/api-key-v2/verification?key=${encodeURIComponent(KEY)}`,
  (o) => Boolean(o.username)
);
const username = verified.username;

const { base: API, out: sites } = await pickBase(
  `/host/sites?username=${encodeURIComponent(username)}`,
  (o) => Array.isArray(o.results)
);
if (!sites.results.some((s) => s.domain === domain)) {
  console.error(`密钥下没有站点 ${domain}；已有：${sites.results.map((s) => s.domain).join(', ')}`);
  process.exit(1);
}
console.log(`API ${API} · username ${username} · domain ${domain}`);

const files = walk(srcdir);
let written = 0;
const pending = [];

for (const f of files) {
  const buf = fs.readFileSync(f.abs);
  const remote = [dest, f.rel].filter(Boolean).join('/');
  if (isBinary(buf)) {
    if (dryRun) {
      console.log(`[binary] ${remote} (${buf.length}B)`);
      continue;
    }
    /* 字段名来自 CLI 源码：content=文件本体，key=远端相对路径（不是 API 密钥！），
       domain + username 定位站点。写错 key 会上传成功但文件落在错误路径。
       FormData 是一次性流，重试时要重建。 */
    let res;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const fd = new FormData();
      fd.append('content', new File([buf], path.basename(f.rel)));
      fd.append('domain', domain);
      fd.append('key', remote);
      fd.append('username', username);
      res = await fetch(`${API}/host/site/binary`, { method: 'POST', headers, body: fd });
      if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 3) break;
      const wait = 800 * 2 ** attempt;
      console.warn(`  ${res.status} 重试中（${wait}ms）…`);
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!res.ok) throw new Error(`binary ${remote} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    written++;
    console.log(`binary  ${remote} (${buf.length}B)`);
    continue;
  }
  pending.push({ path: remote, content: buf.toString('utf8') });
}

for (let i = 0; i < pending.length; i += 25) {
  const batch = pending.slice(i, i + 25);
  if (dryRun) {
    batch.forEach((c) => console.log(`[text]   ${c.path} (${c.content.length}B)`));
    continue;
  }
  const out = await json(`${API}/host/site/changes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      domain,
      changes: batch.map((c) => ({ operation: 'write', path: c.path, content: c.content })),
    }),
  });
  if (!out.success) throw new Error(`写入失败：${JSON.stringify(out.errorLog)}`);
  written += batch.length;
  console.log(`text    ${batch.length} 个文件（累计 ${written}）`);
}

console.log(`${dryRun ? '[dry-run] 待写入' : '已写入'} ${written} 个文件 → ${domain}/${dest || ''}`);

if (flag('verify') && !dryRun) {
  /* 站点没有真正的 404：任何不存在的路径都会 200 返回站点根 index.html。
     所以必须和根页对比，否则"200 验证通过"是假的。 */
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
  const url = `https://${domain}.rth1.xyz/${dest ? `${dest}/` : ''}`;
  const [target, root] = await Promise.all([
    fetch(url, { headers: { 'User-Agent': BROWSER_UA } }),
    fetch(`https://${domain}.rth1.xyz/`, { headers: { 'User-Agent': BROWSER_UA } }),
  ]);
  const body = await target.text();
  const rootBody = await root.text();
  console.log(`verify  ${url} -> ${target.status} (${body.length}B)`);
  if (!target.ok) process.exit(1);
  if (body === rootBody) {
    console.error('verify  返回内容和站点根页完全相同 → 这是"软 404"回退，目标路径其实没有内容');
    process.exit(1);
  }
}
