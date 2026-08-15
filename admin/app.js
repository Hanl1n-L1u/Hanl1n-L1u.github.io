// 博客后台前端逻辑
let articles = [];
let editingId = null;

const $ = (id) => document.getElementById(id);
const listView = $('listView');
const editView = $('editView');

function msg(text, ok = true) {
  const el = $('msg');
  el.textContent = text;
  el.className = 'show ' + (ok ? 'ok' : 'err');
  setTimeout(() => (el.className = ''), 3000);
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j;
}

async function loadStatus() {
  try {
    const j = await api('/api/status');
    $('gitStatus').textContent = j.status;
  } catch { $('gitStatus').textContent = '无法连接后台'; }
}

async function loadList() {
  const j = await api('/api/articles');
  articles = j.articles;
  const list = $('list');
  if (!articles.length) {
    list.innerHTML = '<div class="empty">还没有文章，点击右上角"写新文章"开始 🚀</div>';
    return;
  }
  list.innerHTML = articles.map((a, i) => `
    <div class="card list-item" draggable="true" data-id="${esc(a.id)}" data-index="${i}" ondragstart="onDragStart(event)" ondragover="onDragOver(event)" ondragend="onDragEnd(event)">
      <span class="drag-handle">⠿</span>
      <div class="info">
        <div class="title">${esc(a.title)}<span class="tag">${esc(a.tag || '')}</span></div>
        <div class="sub">${esc(a.date)} · ${esc(a.summary || '（无摘要）')}</div>
      </div>
      <div class="actions">
        <button class="btn ghost small" onclick="editArticle('${esc(a.id)}')">编辑</button>
        <button class="btn danger small" onclick="deleteArticle('${esc(a.id)}')">删除</button>
      </div>
    </div>`).join('');
}

// ── 拖拽排序 ──
let dragId = null;

function onDragStart(e) {
  dragId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  if (target.dataset.id === dragId) return;
  const list = document.getElementById('list');
  const dragging = document.querySelector('.list-item.dragging');
  if (!dragging) return;
  const rect = target.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;
  if (after) {
    if (target.nextElementSibling !== dragging) list.insertBefore(dragging, target.nextElementSibling);
  } else {
    if (target !== dragging) list.insertBefore(dragging, target);
  }
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dragId = null;
  saveOrder();
}

async function saveOrder() {
  const ids = [...document.querySelectorAll('#list .list-item')].map((el) => el.dataset.id);
  if (!ids.length) return;
  try {
    const j = await api('/api/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids }),
    });
    msg('🔀 顺序已保存并推送');
    loadList();
    loadStatus();
  } catch (err) {
    msg('❌ 保存顺序失败: ' + err.message, false);
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function newArticle() {
  editingId = null;
  $('f-title').value = '';
  $('f-date').value = '';
  $('f-tag').value = '';
  $('f-id').value = '';
  $('f-summary').value = '';
  $('f-content').value = '';
  $('btnDelete').style.display = 'none';
  listView.style.display = 'none';
  editView.style.display = 'block';
  $('f-title').focus();
}

function editArticle(id) {
  const a = articles.find((x) => x.id === id);
  if (!a) return msg('文章不存在', false);
  editingId = id;
  $('f-title').value = a.title || '';
  $('f-date').value = a.date || '';
  $('f-tag').value = a.tag || '';
  $('f-id').value = a.id || '';
  $('f-summary').value = a.summary || '';
  $('f-content').value = Array.isArray(a.content) ? a.content.join('\n') : (a.content || '');
  $('btnDelete').style.display = 'inline-flex';
  listView.style.display = 'none';
  editView.style.display = 'block';
}

function showList() {
  editView.style.display = 'none';
  listView.style.display = 'block';
  loadList();
}

$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const isNew = !editingId;
  const idInput = $('f-id').value.trim();
  const payload = {
    id: editingId || idInput || null,
    isNew,
    title: $('f-title').value.trim(),
    date: $('f-date').value.trim(),
    tag: $('f-tag').value.trim(),
    summary: $('f-summary').value.trim(),
    content: $('f-content').value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0),
  };
  if (!payload.title) return msg('标题不能为空', false);
  try {
    await api('/api/articles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    msg('✅ 已保存并推送到 GitHub！');
    showList();
    loadStatus();
  } catch (err) {
    msg('❌ 保存失败: ' + err.message, false);
  }
});

async function deleteArticle(id) {
  if (!id) id = editingId;
  const a = articles.find((x) => x.id === id);
  const name = a ? a.title : '这篇文章';
  if (!confirm(`确定删除「${name}」？此操作会同步到线上。`)) return;
  try {
    await api('/api/articles/' + encodeURIComponent(id), { method: 'DELETE' });
    msg('🗑 已删除并推送');
    showList();
    loadStatus();
  } catch (err) {
    msg('❌ 删除失败: ' + err.message, false);
  }
}

loadList();
loadStatus();
setInterval(loadStatus, 15000);
