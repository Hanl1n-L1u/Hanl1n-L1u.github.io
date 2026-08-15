// 从 index.html 生成模板（文章部分 → 占位符），用 div 深度计数精确匹配
const fs = require('fs');
const path = require('path');

const REPO = 'C:\\Users\\liuha\\.openclaw\\workspace\\liuhanlin-blog';
const INDEX = path.join(REPO, 'index.html');
const TEMPLATE = path.join(REPO, 'admin', 'index.template.html');

let c = fs.readFileSync(INDEX, 'utf8');

// 1. 精确替换 posts-grid 块（div 深度计数）
const gridOpen = '<div class="posts-grid">';
const gStart = c.indexOf(gridOpen);
if (gStart === -1) { console.error('✗ 找不到 posts-grid'); process.exit(1); }
let depth = 0;
let gEnd = -1;
for (let i = gStart; i < c.length; i++) {
  if (c.startsWith('<div', i)) { depth++; i += 3; }
  else if (c.startsWith('</div>', i)) {
    depth--;
    if (depth === 0) { gEnd = i + '</div>'.length; break; }
    i += 5;
  }
}
if (gEnd === -1) { console.error('✗ posts-grid 未闭合'); process.exit(1); }
c = c.slice(0, gStart) + gridOpen + '\n                <!-- __POSTS_GRID__ -->\n            </div>' + c.slice(gEnd);

// 2. 替换 article bodies → 占位符
const bodyStart = c.indexOf('<!-- Article bodies -->');
const scriptStart = c.indexOf('<script>', bodyStart);
if (bodyStart === -1 || scriptStart === -1) { console.error('✗ 找不到 Article bodies / script'); process.exit(1); }
c = c.slice(0, bodyStart) + '<!-- Article bodies -->\n    <!-- __ARTICLE_BODIES__ -->\n' + c.slice(scriptStart);

fs.writeFileSync(TEMPLATE, c, 'utf8');
console.log('✓ 模板已重建');

// 校验：模板中不应再有 post-card 或 article- div
const t = fs.readFileSync(TEMPLATE, 'utf8');
console.log('__POSTS_GRID__:', t.includes('__POSTS_GRID__'));
console.log('__ARTICLE_BODIES__:', t.includes('__ARTICLE_BODIES__'));
console.log('残留 post-card:', t.includes('post-card fade-in'));
console.log('残留 article-div:', /id="article-/.test(t));
