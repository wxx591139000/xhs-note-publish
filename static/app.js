// 桌面端管理逻辑
let allNotes = [];
let currentFilter = 'all';
let currentPurposeFilter = 'all';   // all / xhs / idlefish / gzh / common
let coverFiles = [];
let imageFiles = [];   // 文件名数组
let currentId = null;
let currentPurpose = 'common';   // xhs / idlefish / gzh / common
// 排序：newest=按编写时间新的在前(默认) / oldest=最早在前 / queue=队列顺序(后端原序)
let currentSort = localStorage.getItem('xhsSort') || 'newest';

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

function purposeOf(n) {
  return (n.meta && n.meta.purpose) || 'common';
}

function filteredNotes() {
  let notes = allNotes;
  if (currentFilter === 'pending') notes = notes.filter(n => n.status === 'pending');
  else if (currentFilter === 'drafted') notes = notes.filter(n => n.status === 'drafted');
  else if (currentFilter === 'published') notes = notes.filter(n => n.status === 'published');
  // 用途/平台筛选：all=所有分类都显示
  if (currentPurposeFilter !== 'all') notes = notes.filter(n => purposeOf(n) === currentPurposeFilter);
  return sortNotes(notes);
}

// 状态分组权重：待发布 → 草稿 → 已发布（保留原「已发布沉底」的队列语义）
const STATUS_RANK = { pending: 0, drafted: 1, published: 2 };

// 排序：先在状态分组内，再按规则排。
// queue=保持后端原序（分组内按 position）；newest/oldest=按编写时间(created_at)
function sortNotes(notes) {
  const arr = notes.slice();
  if (currentSort === 'queue') return arr;
  const dir = currentSort === 'oldest' ? 1 : -1;   // newest 默认倒序
  arr.sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 3, rb = STATUS_RANK[b.status] ?? 3;
    if (ra !== rb) return ra - rb;                              // 状态分组优先
    const ta = a.created_at || 0, tb = b.created_at || 0;
    if (ta !== tb) return (ta - tb) * dir;                      // 编写时间
    return ((a.id || 0) - (b.id || 0)) * dir;                   // 同秒用 id 兜底
  });
  return arr;
}

// 编写时间显示（列表用，短格式：今天只给时分，其余给月-日）
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `今天 ${p(d.getHours())}:${p(d.getMinutes())}`
                 : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
        <div class="note-meta">${fmtTime(n.created_at)} · ${n.images.length} 图 · ${stripImgSlots(n.body).length} 字 · ${tagsText(n.tags_list)}</div>
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

// ---------- 图位标记 [[图N]] ----------
// 正文里用 `[[图1]]` 指定「此处插入第 1 张配图」（N 对应 images 顺序，从 1 开始）。
// 支持写法：[[图1]] / [[图 1]] / [[图片1]] / [[图1|图注文字]]
// 用途：把「配图插在正文哪一段之后」的策划排布固化下来，预览按它渲染。
const IMG_SLOT_SRC = '\\[\\[\\s*图\\s*片?\\s*(\\d+)\\s*(?:\\|\\s*([^\\]]*?)\\s*)?\\]\\]';

// 剥离全部图位标记（复制 / 导出 / 字数统计用 —— 发布到平台时正文里不该出现标记）
function stripImgSlots(s) {
  return (s || '').replace(new RegExp(IMG_SLOT_SRC, 'g'), '')
    .replace(/[ \t]+\n/g, '\n')     // 去掉标记留下的行尾空格
    .replace(/\n{3,}/g, '\n\n')     // 压缩多余空行
    .trim();
}

// 把正文按图位标记切成片段，供预览按位置渲染
// 返回 [{kind:'text', text} | {kind:'img', n, caption, ok}]
function splitByImgSlots(body, imageCount) {
  const src = body || '';
  const re = new RegExp(IMG_SLOT_SRC, 'g');
  const out = [];
  let last = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) });
    const n = parseInt(m[1], 10);
    out.push({ kind: 'img', n, caption: (m[2] || '').trim(), ok: n >= 1 && n <= imageCount });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
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
  if (p === 'gzh') return '<span class="note-badge badge-gzh">📣 公众号</span>';
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
// 完整显示：封面 + 标题 + 全文（不截断）+ 配图（按 [[图N]] 指定位置插入）
//   · 自适应展开：卡片随内容变高，图片按容器宽度等比缩放（width:100%; height:auto）
//   · 未在正文里指定位置的图，排在末尾并明确提示「未指定位置」
function updatePreview() {
  $('#previewTitle').textContent = $('#fTitle').value || '笔记标题';
  const tags = $('#fTags').value.split(',').map(t => t.trim()).filter(Boolean);
  $('#previewTags').innerHTML = tags.map(t => `<span>#${esc(t)}</span>`).join('');

  const body = $('#fBody').value || '';
  const cover = coverFiles[0];
  $('#previewCover').style.backgroundImage = cover ? `url('/uploads/${cover}')` : '';

  const box = $('#previewBody');
  if (!body.trim() && !imageFiles.length) {
    box.innerHTML = '<div class="preview-empty">正文预览…</div>';
    return;
  }

  const used = new Set();
  const html = splitByImgSlots(body, imageFiles.length).map(p => {
    if (p.kind === 'text') {
      const t = p.text.replace(/^\n+|\n+$/g, '');
      return t ? `<div class="preview-text">${esc(t)}</div>` : '';
    }
    // 图号超出范围 → 明确报错，不静默吞掉（静默会让作者以为图放对了）
    if (!p.ok) {
      return `<div class="preview-slot-bad">⚠️ 正文里的 [[图${p.n}]] 找不到对应图片`
        + `（当前共 ${imageFiles.length} 张配图）</div>`;
    }
    used.add(p.n);
    // 第 1 张已作为封面显示在卡片顶部，正文里不再重复渲染
    if (p.n === 1 && cover) {
      return '<div class="preview-slot-note">[[图1]] 已作为封面显示在上方</div>';
    }
    const f = imageFiles[p.n - 1];
    return `<figure class="preview-fig">`
      + `<img src="/uploads/${f}" alt="${esc(p.caption)}" loading="lazy">`
      + (p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : '')
      + `</figure>`;
  }).join('');

  // 正文未引用到的图 → 末尾兜底，并说清楚它们是"没指定位置"而不是"被丢了"
  const rest = imageFiles.map((f, i) => ({ f, n: i + 1 }))
    .filter(x => !used.has(x.n) && !(x.n === 1 && cover));
  const restHtml = rest.length
    ? `<div class="preview-slot-note">以下 ${rest.length} 张未在正文里指定位置，暂列末尾`
      + `（想放到正文中间，就在对应位置写 <code>[[图N]]</code>）</div>`
      + rest.map(x => `<figure class="preview-fig"><img src="/uploads/${x.f}" alt="" loading="lazy"></figure>`).join('')
    : '';

  box.innerHTML = (html || '<div class="preview-empty">（正文为空）</div>') + restHtml;
}

// 在正文光标处插入下一个可用的图位标记
function insertImgSlot() {
  const ta = $('#fBody');
  const used = new Set();
  splitByImgSlots(ta.value, imageFiles.length).forEach(p => { if (p.kind === 'img') used.add(p.n); });
  let next = 1;
  while (used.has(next)) next++;
  const token = `\n[[图${next}]]\n`;
  const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
  const e = ta.selectionEnd == null ? s : ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + token + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + token.length;
  ta.focus();
  updatePreview();
}
$('#btnInsertSlot').addEventListener('click', insertImgSlot);

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
document.querySelectorAll('.list-filters .chip[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.list-filters .chip[data-filter]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderList();
  });
});

// 用途/平台筛选
document.querySelectorAll('.list-filters .chip[data-pfilter]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.list-filters .chip[data-pfilter]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentPurposeFilter = chip.dataset.pfilter;
    renderList();
  });
});

// 排序（按编写时间）
function syncSortUI() {
  document.querySelectorAll('#sortRow .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.sort === currentSort));
}
document.querySelectorAll('#sortRow .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    currentSort = chip.dataset.sort;
    localStorage.setItem('xhsSort', currentSort);
    syncSortUI();
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
if (!['newest', 'oldest', 'queue'].includes(currentSort)) currentSort = 'newest';
syncSortUI();
loadNotes();
resetEditor();