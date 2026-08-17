#!/usr/bin/env node
/**
 * 博客后台管理服务
 * 用法: node admin/admin.mjs [端口]
 * 默认 http://localhost:8888
 *
 * 身份验证：
 *   - 环境变量 ADMIN_PASSWORD 或 admin/.admin-pass 文件（自动生成并提示）
 *   - 写操作 API 需要登录 token（Bearer）
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DATA = path.join(__dirname, 'articles.json');
const PORT = parseInt(process.argv[2] || '8888', 10);

// ── 身份验证配置 ──
const PASSWORD = (() => {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const passFile = path.join(__dirname, '.admin-pass');
  try {
    const existing = fs.readFileSync(passFile, 'utf8').trim();
    if (existing) return existing;
  } catch {}
  const generated = crypto.randomBytes(9).toString('base64url');
  try {
    fs.writeFileSync(passFile, generated + '\n', { mode: 0o600 });
    console.log('⚠ 已生成后台密码并写入 admin/.admin-pass（请妥善保管）');
  } catch {
    console.log('⚠ 无法写入密码文件，请设置环境变量 ADMIN_PASSWORD');
  }
  return generated;
})();

// 内存会话：token -> 过期时间戳（12 小时）
const sessions = new Map();
const SESSION_TTL = 12 * 60 * 60 * 1000;

function issueToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}
function validToken(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  const exp = sessions.get(m[1]);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(m[1]); return false; }
  return true;
}
function requireAuth(req, res) {
  if (validToken(req)) return true;
  json(res, 401, { ok: false, error: '未登录或登录已过期' });
  return false;
}

function readData() {
  return JSON.parse(fs.readFileSync(DATA, 'utf8'));
}
function writeData(d) {
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2) + '\n', 'utf8');
}
function build() {
  execFileSync(process.execPath, ['admin/build.mjs'], { cwd: REPO, stdio: 'pipe' });
}
function gitPush(msg) {
  // 用参数数组方式调用 git，避免 shell 拼接注入
  execFileSync('git', ['add', 'index.html', 'admin/articles.json'], { cwd: REPO, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', msg], { cwd: REPO, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'main'], { cwd: REPO, stdio: 'pipe' });
}
function gitStatus() {
  try {
    const out = execFileSync('git', ['status', '--short', '--branch'], { cwd: REPO, encoding: 'utf8' });
    return out.trim();
  } catch { return 'n/a'; }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); }
    });
  });
}

// 不蒜子统计（带 60s 缓存：后台刷新不重复打点，避免污染统计数据）
let statsCache = null;
let statsCacheAt = 0;
const STATS_URL = 'https://liuhanlin.xyz';

// 网站在线状态探测（带 30s 缓存）
let siteStatusCache = null;
let siteStatusAt = 0;
async function checkSiteStatus() {
  if (siteStatusCache && Date.now() - siteStatusAt < 30000) return siteStatusCache;
  try {
    const r = await fetch(STATS_URL, { redirect: 'follow' });
    siteStatusCache = { status: r.status };
  } catch (e) {
    siteStatusCache = { status: 0, error: String(e.message || e).slice(0, 80) };
  }
  siteStatusAt = Date.now();
  return siteStatusCache;
}

async function fetchStats() {
  if (statsCache && Date.now() - statsCacheAt < 60000) return statsCache;
  const r = await fetch('https://cdn.busuanzi.cc/api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ url: STATS_URL, referrer: '' }),
  });
  if (!r.ok) throw new Error('统计服务返回 ' + r.status);
  const j = await r.json();
  statsCache = j;
  statsCacheAt = Date.now();
  return j;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // ── 静态页面：管理界面 ──
  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
    // no-store：禁止浏览器缓存后台页面（避免旧版 favicon/代码残留）
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  if (p === '/app.js') {
    const js = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(js);
  }
  if (p === '/favicon.png') {
    const png = fs.readFileSync(path.join(REPO, 'favicon.png'));
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return res.end(png);
  }

  // ── API ──
  try {
    if (p === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (typeof body.password === 'string' && body.password === PASSWORD) {
        return json(res, 200, { ok: true, token: issueToken() });
      }
      return json(res, 401, { ok: false, error: '密码错误' });
    }
    if (p === '/api/articles' && req.method === 'GET') {
      const data = readData();
      return json(res, 200, { ok: true, articles: data.articles });
    }
    if (p === '/api/status' && req.method === 'GET') {
      return json(res, 200, { ok: true, status: gitStatus() });
    }
    if (p === '/api/site-status' && req.method === 'GET') {
      const s = await checkSiteStatus();
      return json(res, 200, { ok: true, status: s.status });
    }
    if (p === '/api/stats' && req.method === 'GET') {
      try {
        const j = await fetchStats();
        return json(res, 200, { ok: true, ...j });
      } catch (e) {
        console.error('stats fetch error:', e);
        return json(res, 502, { ok: false, error: '统计服务暂不可用' });
      }
    }
    if (p === '/api/articles' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readBody(req);
      const data = readData();
      const now = new Date();
      const date = body.date || `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
      const article = {
        id: String(body.id || Date.now().toString(36)),
        date,
        tag: body.tag || '随笔',
        title: body.title || '未命名',
        summary: body.summary || '',
        content: Array.isArray(body.content) ? body.content : String(body.content || '').split(/\r?\n/).filter((l) => l.trim()),
      };
      if (body.isNew) {
        data.articles.push(article);
      } else {
        const idx = data.articles.findIndex((a) => a.id === body.id);
        if (idx >= 0) data.articles[idx] = article;
        else data.articles.push(article);
      }
      writeData(data);
      build();
      const msg = body.isNew ? `Add article: ${article.title}` : `Update article: ${article.title}`;
      try { gitPush(msg); } catch (e) { console.error('push 失败:', e.message); }
      return json(res, 200, { ok: true, article, push: gitStatus() });
    }
    if (p === '/api/reorder' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const body = await readBody(req);
      const order = Array.isArray(body.order) ? body.order : [];
      const data = readData();
      const byId = new Map(data.articles.map((a) => [a.id, a]));
      const reordered = order.map((id) => byId.get(id)).filter(Boolean);
      // 补上可能遗漏的文章（如新建但未拖过的）
      for (const a of data.articles) {
        if (!reordered.some((x) => x.id === a.id)) reordered.push(a);
      }
      data.articles = reordered;
      writeData(data);
      build();
      try { gitPush('Reorder articles'); } catch (e) { console.error('push 失败:', e.message); }
      return json(res, 200, { ok: true, push: gitStatus() });
    }
    if (p.startsWith('/api/articles/') && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      const id = decodeURIComponent(p.split('/').pop());
      const data = readData();
      const idx = data.articles.findIndex((a) => a.id === id);
      if (idx < 0) return json(res, 404, { ok: false, error: '文章不存在' });
      const [removed] = data.articles.splice(idx, 1);
      writeData(data);
      build();
      try { gitPush(`Delete article: ${removed.title}`); } catch (e) { console.error('push 失败:', e.message); }
      return json(res, 200, { ok: true, push: gitStatus() });
    }
    return json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error('API error:', e);
    return json(res, 500, { ok: false, error: '服务器内部错误' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`博客后台已启动: http://127.0.0.1:${PORT}`);
  console.log(`   仓库: ${REPO}`);
  console.log(`   Ctrl+C 停止`);
});
