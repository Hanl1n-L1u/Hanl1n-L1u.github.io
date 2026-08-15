#!/usr/bin/env node
/**
 * 网站生成器：articles.json + index.html 模板 → 完整 index.html
 * 用法: node admin/build.mjs [--push]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const INDEX = path.join(REPO, 'index.html');
const TEMPLATE = path.join(__dirname, 'index.template.html');
const DATA = path.join(__dirname, 'articles.json');

// ── 读取数据 ──
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
// 按数组顺序输出（支持后台拖拽排序；新文章默认追加到末尾）
const articles = data.articles || [];

// ── 生成文章卡片 ──
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const cards = articles
  .map((a) => {
    const hasBody = (a.content && a.content.length > 0) || (a.bodyHtml && a.bodyHtml.trim());
    const dataAttr = hasBody ? ` data-article="${esc(a.id)}"` : '';
    return `                <article class="post-card fade-in"${dataAttr}>
                    <div class="post-meta">
                        <span>${esc(a.date)}</span>
                        <span class="tag">${esc(a.tag || '随笔')}</span>
                    </div>
                    <h3>${esc(a.title)}</h3>
                    <p>${esc(a.summary || '')}</p>
                </article>`;
  })
  .join('\n\n');

// ── 生成文章正文 ──
function renderContent(a) {
  if (a.bodyHtml && a.bodyHtml.trim()) return a.bodyHtml.trim();
  // 兼容旧格式：content 数组（每项一个 <p>）
  return (a.content || []).map((p) => `        <p>${p}</p>`).join('\n');
}

const bodies = articles
  .filter((a) => (a.content && a.content.length > 0) || (a.bodyHtml && a.bodyHtml.trim()))
  .map((a) => {
    return `    <div id="article-${esc(a.id)}" hidden>
${renderContent(a)}
    </div>`;
  })
  .join('\n\n');

// ── 合成 index.html ──
let html = fs.readFileSync(TEMPLATE, 'utf8');

if (!html.includes('<!-- __POSTS_GRID__ -->') || !html.includes('<!-- __ARTICLE_BODIES__ -->')) {
  console.error('✗ 模板占位符缺失！index.html 需要包含 __POSTS_GRID__ 和 __ARTICLE_BODIES__');
  process.exit(1);
}

html = html.replace('<!-- __POSTS_GRID__ -->', cards);
html = html.replace('<!-- __ARTICLE_BODIES__ -->', bodies);
fs.writeFileSync(INDEX, html, 'utf8');

console.log(`✓ 已生成 index.html（${articles.length} 篇文章）`);

// ── 可选：git 提交推送 ──
if (process.argv.includes('--push')) {
  const msg = process.argv.includes('--push') && process.argv[process.argv.indexOf('--push') + 1]
    ? process.argv[process.argv.indexOf('--push') + 1]
    : '更新文章';
  execSync(`git add index.html && git commit -m "${msg.replace(/"/g, '\\"')}" && git push origin main`, {
    cwd: REPO,
    stdio: 'inherit',
  });
  console.log('✓ 已提交并推送');
}
