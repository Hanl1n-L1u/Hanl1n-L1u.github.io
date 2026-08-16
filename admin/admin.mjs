#!/usr/bin/env node
/**
 * 博客后台管理服务
 * 用法: node admin/admin.mjs [端口]
 * 默认 http://localhost:8888
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DATA = path.join(__dirname, 'articles.json');
const PORT = parseInt(process.argv[2] || '8888', 10);

function readData() {
  return JSON.parse(fs.readFileSync(DATA, 'utf8'));
}
function writeData(d) {
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2) + '\n', 'utf8');
}
function build() {
  execSync('node admin/build.mjs', { cwd: REPO, stdio: 'pipe' });
}
function gitPush(msg) {
  const safe = String(msg).replace(/"/g, '\\"').replace(/`/g, '');
  execSync(`git add index.html admin/articles.json && git commit -m "${safe}" && git push origin main`, {
    cwd: REPO, stdio: 'pipe',
  });
}
function gitStatus() {
  try {
    const out = execSync('git status --short --branch', { cwd: REPO, encoding: 'utf8' });
    return out.trim();
  } catch { return 'n/a'; }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}function readBody(req) {
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  if (p === '/app.js') {
    const js = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(js);
  }
  if (p === '/favicon.svg') {
    const svg = fs.readFileSync(path.join(REPO, 'favicon.svg'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    return res.end(svg);
  }

  // ── API ──
  try {
    if (p === '/api/articles' && req.method === 'GET') {
      const data = readData();
      return json(res, 200, { ok: true, articles: data.articles });
    }
    if (p === '/api/status' && req.method === 'GET') {
      return json(res, 200, { ok: true, status: gitStatus() });
    }
    if (p === '/api/stats' && req.method === 'GET') {
      try {
        const j = await fetchStats();
        return json(res, 200, { ok: true, ...j });
      } catch (e) {
        return json(res, 502, { ok: false, error: '统计服务不可用: ' + String(e.message || e) });
      }
    }
    if (p === '/api/articles' && req.method === 'POST') {
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
    return json(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`博客后台已启动: http://localhost:${PORT}`);
  console.log(`   仓库: ${REPO}`);
  console.log(`   Ctrl+C 停止`);
});
