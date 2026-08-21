// 手机端发布逻辑
let allNotes = [];
let currentFilter = 'pending';
let currentPlat = 'all';   // all / xhs / idlefish / common
const $ = (s) => document.querySelector(s);

async function loadNotes() {
  const res = await fetch('/api/notes');
  if (res.status === 401) { location.href = '/login?next=/m'; return; }
  const data = await res.json();
  allNotes = data.notes;
  render();
}

function purposeOf(n) { return (n.meta && n.meta.purpose) || 'common'; }

function filtered() {
  let arr = allNotes;
  if (currentFilter === 'pending') arr = arr.filter(n => n.status === 'pending');
  if (currentFilter === 'drafted') arr = arr.filter(n => n.status === 'drafted');
  if (currentFilter === 'published') arr = arr.filter(n => n.status === 'published');
  if (currentPlat !== 'all') arr = arr.filter(n => purposeOf(n) === currentPlat);
  return arr;
}

function esc(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function render() {
  const list = filtered();
  $('#mEmpty').style.display = list.length ? 'none' : 'block';
  const el = $('#mList');
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = list.map(n => {
    const cover = n.images[0];
    const gallery = n.images.slice(1).map((f, gi) => `<img src="/uploads/${f}" loading="lazy" onclick="openImg(${n.id}, ${gi + 1})">`).join('');
    const tags = (n.tags_list || []).map(t => `<span>#${esc(t)}</span>`).join('');
    const plat = purposeOf(n);
    const platBadge = plat === 'idlefish' ? '<span class="m-status-pending plat-fish">🐟 闲鱼</span>'
      : plat === 'xhs' ? '<span class="m-status-pending plat-xhs">📕 小红书</span>' : '';
    const showItem = plat === 'idlefish' || plat === 'common';
    const showNote = plat === 'xhs' || plat === 'common';
    return `
    <div class="m-card">
      ${cover ? `<div class="m-cover" style="background-image:url('/uploads/${cover}')" onclick="openImg(${n.id}, 0)"></div>` : ''}
      <div class="m-body">
        <div class="m-title">${esc(n.title) || '(无标题)'}
          ${n.status !== 'published' ? `<span class="m-status-${n.status}">${n.status === 'drafted' ? '草稿' : '待发布'}</span>` : ''}
          ${platBadge}
        </div>
        <div class="m-text">${esc(n.body)}</div>
        ${tags ? `<div class="m-tags">${tags}</div>` : ''}
      </div>
      ${gallery ? `<div class="m-gallery">${gallery}</div>` : ''}
      <div class="m-actions">
        ${showItem ? `<button class="btn btn-primary" onclick="copyItem(${n.id})">🐟 复制宝贝文案</button>` : ''}
        ${showNote ? `<button class="btn btn-ghost" onclick="copyNote(${n.id})">📋 复制文案</button>` : ''}
        ${showNote ? `<button class="btn btn-ghost" onclick="copyTitle(${n.id})">✏️ 复制标题</button>` : ''}
        ${n.images.length ? `<button class="btn btn-ghost" onclick="downloadImages(${n.id})">📥 下载图(${n.images.length})</button>` : ''}
        ${n.status === 'published'
          ? `<button class="btn btn-ghost" onclick="revert(${n.id})">↩ 撤回</button>`
          : `<button class="btn btn-ghost" onclick="publish(${n.id})">✔ 已发布</button>`}
      </div>
    </div>`;
  }).join('');
}

// 一键复制闲鱼宝贝文案：标题 + 正文 + 每行「宝贝字段:值」(meta)，供闲鱼"发布宝贝"粘贴
async function copyItem(id) {
  const n = allNotes.find(x => x.id === id);
  if (!n) return;
  const meta = n.meta || {};
  // purpose 是内部用途标记(小红书/闲鱼/通用，用于标签页筛选)，非闲鱼宝贝字段，复制时排除
  const entries = Object.entries(meta).filter(([k, v]) => k && v && k !== 'purpose');
  const parts = [];
  if (n.title) parts.push(n.title);
  if (n.body) parts.push(n.body);
  entries.forEach(([k, v]) => parts.push(`${k}：${v}`));
  const text = parts.join('\n');

  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e) {}
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  toast(ok ? '宝贝文案已复制，去闲鱼「发布宝贝」粘贴 🐟' : '复制失败，请长按手动复制');
}

// 一键复制：标题 + 正文 + 标签
async function copyNote(id) {
  const n = allNotes.find(x => x.id === id);
  if (!n) return;
  const tags = (n.tags_list || []).map(t => '#' + t).join(' ');
  let text = n.title || '';
  if (n.body) text += (text ? '\n\n' : '') + n.body;
  if (tags) text += '\n\n' + tags;

  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e) {}
  if (!ok) {
    // 降级：textarea + execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  toast(ok ? '已复制，去小红书粘贴发布 ✍️' : '复制失败，请长按手动复制');
}

// 一键复制标题（小红书标题是独立输入框）
async function copyTitle(id) {
  const n = allNotes.find(x => x.id === id);
  if (!n) return;
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(n.title || '');
      ok = true;
    }
  } catch (e) {}
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = n.title || '';
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  toast(ok ? '标题已复制，去小红书标题框粘贴 ✏️' : '复制失败，请长按手动复制');
}

async function publish(id) {
  const res = await fetch(`/api/notes/${id}/publish`, { method: 'POST' });
  if (res.status === 401) { location.href = '/login?next=/m'; return; }
  await loadNotes();
  toast('已标记发布 ✔');
}

async function revert(id) {
  const res = await fetch(`/api/notes/${id}/revert`, { method: 'POST' });
  if (res.status === 401) { location.href = '/login?next=/m'; return; }
  await loadNotes();
  toast('已撤回待发布');
}

document.querySelectorAll('#mStatusFilters .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#mStatusFilters .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    render();
  });
});

// 平台筛选（小红书 / 闲鱼 / 通用）
document.querySelectorAll('#mPlatFilters .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#mPlatFilters .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentPlat = chip.dataset.plat;
    render();
  });
});

// 逐张保存图片到相册
// 流程：点"保存此图"下载当前张 → 按钮变"下一张 →" → 你点一下进下一张。
// 全程由你控制节奏，绝不自动跳，杜绝闪屏/漏图。
let saveQueue = [];
let saveIdx = 0;
let saveState = 'save';   // 'save'=可下载当前张, 'next'=等你去下一张

function downloadImages(id) {
  const n = allNotes.find(x => x.id === id);
  if (!n || !n.images.length) return;
  saveQueue = n.images.map((f, i) => ({
    url: `/uploads/${f}`,
    name: `xhs_${n.id}_${i + 1}.${(f.split('.').pop() || 'png')}`,
  }));
  saveIdx = 0;
  showSaveStep();
}

function showSaveStep() {
  if (saveIdx >= saveQueue.length) {
    closeSaveModal();
    toast('图片全部保存完成 ✔');
    return;
  }
  const it = saveQueue[saveIdx];
  $('#mSaveImg').src = it.url;
  $('#mSaveInfo').textContent = `第 ${saveIdx + 1}/${saveQueue.length} 张`;
  saveState = 'save';
  $('#mSaveBtn').textContent = '保存此图';
  $('#mSaveModal').classList.add('show');
}

$('#mSaveBtn').addEventListener('click', () => {
  if (saveState === 'save') {
    // 新鲜用户手势 → 稳定触发这一张的下载/保存
    const it = saveQueue[saveIdx];
    const a = document.createElement('a');
    a.href = it.url;
    a.download = it.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 等你在下载界面操作完，点"下一张"再前进（绝不自动跳）
    saveState = 'next';
    $('#mSaveBtn').textContent = (saveIdx + 1 < saveQueue.length) ? '✔ 保存完成 · 下一张 →' : '✔ 完成';
  } else {
    // 用户主动进下一张
    saveIdx++;
    showSaveStep();
  }
});

function closeSaveModal() {
  $('#mSaveModal').classList.remove('show');
  $('#mSaveImg').src = '';
}

// 点图放大（长按保存的可靠兜底）
function openImg(id, idx) {
  const n = allNotes.find(x => x.id === id);
  if (!n || !n.images[idx]) return;
  $('#mLightboxImg').src = `/uploads/${n.images[idx]}`;
  $('#mLightbox').classList.add('show');
}
function closeLightbox() {
  $('#mLightbox').classList.remove('show');
  $('#mLightboxImg').src = '';
}

let toastTimer;
function toast(msg) {
  let el = $('#m-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'm-toast';
    el.id = 'm-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// 定时刷新（手机端长开页面时自动同步电脑端新增素材）
setInterval(() => { if (document.visibilityState === 'visible') loadNotes(); }, 15000);
loadNotes();