// 桌面端管理逻辑
let allNotes = [];
let currentFilter = 'all';
let coverFiles = [];
let imageFiles = [];   // 文件名数组
let currentId = null;
let currentPurpose = 'common';   // xhs / idlefish / common

const $ = (s) => document.querySelector(s);
const STATUS_LABEL = { pending: '待发布', drafted: '草稿', published: '已发布' };

// ---------- 加载列表 ----------
async function loadNotes() {
  const res = await fetch('/api/notes');
  if (res.status === 401) { location.href = '/login'; return; }
  const data = await res.json();
  allNotes = data.notes;
  renderList();
}

function filteredNotes() {
  if (currentFilter === 'pending') return allNotes.filter(n => n.status === 'pending');
  if (currentFilter === 'drafted') return allNotes.filter(n => n.status === 'drafted');
  if (currentFilter === 'published') return allNotes.filter(n => n.status === 'published');
  return allNotes;
}

function renderList() {
  const list = $('#noteList');
  const notes = filteredNotes();
  if (!notes.length) {
    list.innerHTML = '<div class="muted" style="text-align:center;padding:30px">暂无笔记</div>';
    return;
  }
  list.innerHTML = notes.map(n => `
    <div class="note-item ${n.id === currentId ? 'selected' : ''}" data-id="${n.id}">
      <img class="note-thumb" src="${n.images[0] || '/static/placeholder.png'}" onerror="this.src='/static/placeholder.png'">
      <div class="note-info">
        <div class="note-title">${esc(n.title) || '(无标题)'}
          <span class="note-badge badge-${n.status}">${STATUS_LABEL[n.status] || n.status}</span>
          ${purposeBadge(n)}
        </div>
        <div class="note-meta">${n.images.length} 图 · ${(n.body || '').length} 字 · ${tagsText(n.tags_list)}</div>
      </div>
      <div class="note-ops">
        <button class="btn btn-sm" onclick="editNote(${n.id})">编辑</button>
        <button class="btn btn-sm" onclick="deleteNote(${n.id})">删除</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.note-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.note-ops')) return;
      const id = +el.dataset.id;
      openPreview(id);
    });
  });
}

function esc(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function tagsText(tags) {
  if (!tags || !tags.length) return '';
  return tags.map(t => '#' + t).join(' ');
}

// ---------- 闲鱼宝贝信息(meta)：文本 ↔ 对象 ----------
// 文本格式：每行「键:值」，如 "价格:128\n成色:9成新"
function metaToText(meta) {
  meta = meta || {};
  return Object.entries(meta).map(([k, v]) => `${k}:${v}`).join('\n');
}
function textToMeta(text) {
  const m = {};
  (text || '').split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) m[k] = v;
    }
  });
  return m;
}

// 用途徽标文案
function purposeBadge(n) {
  const p = (n.meta && n.meta.purpose) || 'common';
  if (p === 'idlefish') return '<span class="note-badge badge-idlefish">🐟 闲鱼</span>';
  if (p === 'xhs') return '<span class="note-badge badge-xhs">📕 小红书</span>';
  return '';
}

// 用途选择器 UI 同步
function syncPurposeUI() {
  document.querySelectorAll('#purposeRow .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.purpose === currentPurpose));
}
// 用途选择器事件
document.querySelectorAll('#purposeRow .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    currentPurpose = chip.dataset.purpose;
    syncPurposeUI();
  });
});

// ---------- 编辑 ----------
function editNote(id) {
  const n = allNotes.find(x => x.id === id);
  if (!n) return;
  currentId = id;
  $('#editorTitle').textContent = '编辑笔记';
  $('#noteId').value = id;
  $('#fTitle').value = n.title;
  $('#fBody').value = n.body;
  $('#fTags').value = n.tags;
  $('#fMeta').value = metaToText(n.meta);
  currentPurpose = (n.meta && n.meta.purpose) || 'common';
  syncPurposeUI();
  imageFiles = n.images.slice();
  renderImages();
  updatePreview();
}

function resetEditor() {
  currentId = null;
  $('#editorTitle').textContent = '新建笔记';
  $('#noteId').value = '';
  $('#fTitle').value = '';
  $('#fBody').value = '';
  $('#fTags').value = '';
  $('#fMeta').value = '';
  currentPurpose = 'common';
  syncPurposeUI();
  coverFiles = [];
  imageFiles = [];
  renderImages();
  updatePreview();
}

function openPreview(id) {
  const n = allNotes.find(x => x.id === id);
  if (!n) return;
  currentId = id;
  $('#editorTitle').textContent = '编辑笔记';
  $('#noteId').value = id;
  $('#fTitle').value = n.title;
  $('#fBody').value = n.body;
  $('#fTags').value = n.tags;
  $('#fMeta').value = metaToText(n.meta);
  currentPurpose = (n.meta && n.meta.purpose) || 'common';
  syncPurposeUI();
  imageFiles = n.images.slice();
  renderImages();
  updatePreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- 图片 ----------
function renderImages() {
  const grid = $('#imageGrid');
  if (!imageFiles.length) {
    grid.innerHTML = '';
    $('#coverThumb').innerHTML = '';
    coverFiles = [];
    return;
  }
  grid.innerHTML = imageFiles.map((f, i) => `
    <div class="thumb ${i === 0 ? 'cover-mark' : ''}" onclick="setCover(${i})">
      <img src="/uploads/${f}">
      <button class="del" onclick="event.stopPropagation();removeImage(${i})">×</button>
    </div>
  `).join('');
  // 封面 = 第一张
  coverFiles = imageFiles.slice(0, 1);
  $('#coverThumb').innerHTML = coverFiles.length
    ? `<div class="thumb cover-mark"><img src="/uploads/${coverFiles[0]}"></div>` : '';
  updatePreview();
}

function setCover(i) {
  // 把第 i 张移到最前作为封面
  if (i <= 0) return;
  const f = imageFiles.splice(i, 1)[0];
  imageFiles.unshift(f);
  renderImages();
}

function removeImage(i) {
  imageFiles.splice(i, 1);
  renderImages();
}

async function uploadFiles(files, mode) {
  for (const f of files) {
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (res.status === 401) { location.href = '/login'; return; }
    const data = await res.json();
    if (data.error) { alert(data.error); continue; }
    imageFiles.push(data.name);
  }
  renderImages();
}

// 事件：封面/配图上传
$('#dropCover').addEventListener('click', () => $('#coverFile').click());
$('#coverFile').addEventListener('change', (e) => uploadFiles(e.target.files, 'cover'));
$('#dropImages').addEventListener('click', () => $('#imagesFile').click());
$('#imagesFile').addEventListener('change', (e) => uploadFiles(e.target.files, 'images'));

// 拖拽上传
['#dropCover', '#dropImages'].forEach(sel => {
  const el = $(sel);
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  });
});

// ---------- 预览 ----------
function updatePreview() {
  $('#previewTitle').textContent = $('#fTitle').value || '笔记标题';
  $('#previewBody').textContent = $('#fBody').value || '正文预览…';
  const tags = $('#fTags').value.split(',').map(t => t.trim()).filter(Boolean);
  $('#previewTags').innerHTML = tags.map(t => `<span>#${esc(t)}</span>`).join('');
  const cover = coverFiles[0];
  $('#previewCover').style.backgroundImage = cover ? `url('/uploads/${cover}')` : '';
}
['#fTitle', '#fBody', '#fTags'].forEach(sel => $(sel).addEventListener('input', updatePreview));

// ---------- 保存 / 删除 ----------
async function saveNote() {
  const payload = {
    title: $('#fTitle').value.trim(),
    body: $('#fBody').value,
    tags: $('#fTags').value.trim(),
    images: imageFiles,
    cover: imageFiles[0] || '',
    meta: Object.assign(textToMeta($('#fMeta').value), { purpose: currentPurpose }),
  };
  if (!payload.title && !payload.body && !imageFiles.length) {
    alert('请至少填写标题或上传一张图'); return;
  }
  let res;
  if (currentId) {
    res = await fetch(`/api/notes/${currentId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  } else {
    res = await fetch('/api/notes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  }
  if (res.status === 401) { location.href = '/login'; return; }
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  resetEditor();
  await loadNotes();
  toast('已保存 ✔');
}

async function deleteNote(id) {
  if (!confirm('确定删除这条笔记？')) return;
  const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  if (res.status === 401) { location.href = '/login'; return; }
  if (currentId === id) resetEditor();
  await loadNotes();
  toast('已删除');
}

$('#btnSave').addEventListener('click', saveNote);
$('#btnReset').addEventListener('click', resetEditor);

// ---------- 筛选 ----------
document.querySelectorAll('.list-filters .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.list-filters .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderList();
  });
});

// ---------- 二维码 ----------
$('#btnQr').addEventListener('click', async () => {
  const img = $('#qrImg');
  img.src = '/api/qr?t=' + Date.now();
  $('#qrModal').classList.add('show');
  $('#qrUrl').textContent = '网址见二维码';
});
$('#btnCloseQr').addEventListener('click', () => $('#qrModal').classList.remove('show'));

// 手机端已登录时，直接显示手机页地址
$('#qrModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('show'); });

// ---------- 改密码 ----------
$('#btnPwd').addEventListener('click', () => { $('#pwdModal').classList.add('show'); });
$('#btnClosePwd').addEventListener('click', () => $('#pwdModal').classList.remove('show'));
$('#btnPwdSave').addEventListener('click', async () => {
  const p1 = $('#pNew').value, p2 = $('#pNew2').value;
  if (p1.length < 4) { alert('密码至少 4 位'); return; }
  if (p1 !== p2) { alert('两次输入不一致'); return; }
  const res = await fetch('/api/settings', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: p1}) });
  if (res.status === 401) { location.href = '/login'; return; }
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  $('#pNew').value = ''; $('#pNew2').value = '';
  $('#pwdModal').classList.remove('show');
  toast('密码已更新 ✔');
});

// ---------- 自动化 ----------
async function loadAutoInfo() {
  const res = await fetch('/api/auto/token');
  if (res.status === 401) { location.href = '/login'; return; }
  const data = await res.json();
  $('#autoToken').value = data.token;
  $('#autoScriptUrl').value = location.origin + '/xhs_auto.js';
}
$('#btnAuto').addEventListener('click', async () => {
  await loadAutoInfo();
  $('#autoModal').classList.add('show');
});
$('#btnCloseAuto').addEventListener('click', () => $('#autoModal').classList.remove('show'));
$('#btnCopyToken').addEventListener('click', () => {
  const t = $('#autoToken');
  t.select();
  navigator.clipboard.writeText(t.value);
  toast('Token 已复制');
});
$('#btnCopyScript').addEventListener('click', () => {
  const t = $('#autoScriptUrl');
  t.select();
  navigator.clipboard.writeText(t.value);
  toast('脚本地址已复制');
});
$('#btnRegenToken').addEventListener('click', async () => {
  if (!confirm('重新生成后，手机上旧 token 会失效，确定？')) return;
  const res = await fetch('/api/auto/token', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({regenerate:true}) });
  const data = await res.json();
  if (data.token) { $('#autoToken').value = data.token; toast('已生成新 Token，请更新手机脚本'); }
});

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  let el = $('#m-toast-global');
  if (!el) {
    el = document.createElement('div');
    el.id = 'm-toast-global';
    el.className = 'm-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// 初始化
loadNotes();
resetEditor();