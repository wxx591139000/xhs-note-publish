// 手机端发布逻辑
let allNotes = [];
let currentFilter = 'pending';
let currentPlat = 'all';   // all / xhs / idlefish / gzh / common
// 排序：newest=按编写时间新的在前(默认) / oldest=最早在前 / queue=队列顺序(后端原序)
// 与桌面端共用同一个 localStorage key，两端偏好一致
let currentSort = localStorage.getItem('xhsSort') || 'newest';
if (!['newest', 'oldest', 'queue'].includes(currentSort)) currentSort = 'newest';
const $ = (s) => document.querySelector(s);

async function loadNotes() {
  const res = await fetch('/api/notes');
  if (res.status === 401) { location.href = '/login?next=/m'; return; }
  const data = await res.json();
  allNotes = data.notes;
  render();
}

function purposeOf(n) { return (n.meta && n.meta.purpose) || 'common'; }

// 剥离图位标记 [[图N]]（桌面端用来排「图插在正文哪一段之后」；手机端复制/显示时要去掉，
// 否则粘到小红书/闲鱼/公众号的正文里会带上 [[图2]] 这种内部标记）
function stripImgSlots(s) {
  return (s || '').replace(/\[\[\s*图\s*片?\s*(\d+)\s*(?:\|\s*([^\]]*?)\s*)?\]\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 状态分组权重：待发布 → 草稿 → 已发布（保留原「已发布沉底」的队列语义）
const STATUS_RANK = { pending: 0, drafted: 1, published: 2 };

// 排序：与桌面端 sortNotes 同一套语义。
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

function filtered() {
  let arr = allNotes;
  if (currentFilter === 'pending') arr = arr.filter(n => n.status === 'pending');
  if (currentFilter === 'drafted') arr = arr.filter(n => n.status === 'drafted');
  if (currentFilter === 'published') arr = arr.filter(n => n.status === 'published');
  if (currentPlat !== 'all') arr = arr.filter(n => purposeOf(n) === currentPlat);
  return sortNotes(arr);
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
      : plat === 'xhs' ? '<span class="m-status-pending plat-xhs">📕 小红书</span>'
      : plat === 'gzh' ? '<span class="m-status-pending plat-gzh">📣 公众号</span>' : '';
    const showItem = plat === 'idlefish' || plat === 'common';
    const showNote = plat === 'xhs' || plat === 'gzh' || plat === 'common';
    const showDigest = plat === 'gzh' && !!(n.meta && n.meta.digest);
    return `
    <div class="m-card">
      ${cover ? `<div class="m-cover" style="background-image:url('/uploads/${cover}')" onclick="openImg(${n.id}, 0)"></div>` : ''}
      <div class="m-body">
        <div class="m-title">${esc(n.title) || '(无标题)'}
          ${n.status !== 'published' ? `<span class="m-status-${n.status}">${n.status === 'drafted' ? '草稿' : '待发布'}</span>` : ''}
          ${platBadge}
        </div>
        ${n.created_at ? `<div class="m-note-time">🕒 ${fmtTime(n.created_at)}</div>` : ''}
        <div class="m-text">${esc(stripImgSlots(n.body))}</div>
        ${tags ? `<div class="m-tags">${tags}</div>` : ''}
      </div>
      ${gallery ? `<div class="m-gallery">${gallery}</div>` : ''}
      <div class="m-actions">
        ${showItem ? `<button class="btn btn-primary" onclick="copyItem(${n.id})">🐟 复制宝贝文案</button>` : ''}
        ${showItem ? `<a class="btn btn-ghost" href="/send?id=${n.id}">📦 发货话术</a>` : ''}
        ${showNote ? `<button class="btn btn-ghost" onclick="copyNote(${n.id})">📋 复制文案</button>` : ''}
        ${showNote ? `<button class="btn btn-ghost" onclick="copyTitle(${n.id})">✏️ 复制标题</button>` : ''}
        ${showDigest ? `<button class="btn btn-ghost" onclick="copyDigest(${n.id})">📝 复制摘要</button>` : ''}
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
  if (n.body) parts.push(stripImgSlots(n.body));
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
// 公众号（gzh）不追加 #标签 —— 那是小红书格式，粘到公众号编辑器里无意义
async function copyNote(id) {
  const n = allNotes.find(x => x.id === id);
  if (!n) return;
  const isGzh = purposeOf(n) === 'gzh';
  const tags = isGzh ? '' : (n.tags_list || []).map(t => '#' + t).join(' ');
  let text = n.title || '';
  if (n.body) text += (text ? '\n\n' : '') + stripImgSlots(n.body);
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

// 一键复制摘要（公众号发布时"摘要"是独立字段，限 120 字）
async function copyDigest(id) {
  const n = allNotes.find(x => x.id === id);
  if (!n) return;
  const digest = (n.meta && n.meta.digest) || '';
  if (!digest) { toast('这篇没有填摘要'); return; }
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(digest);
      ok = true;
    }
  } catch (e) {}
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = digest;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  toast(ok ? '摘要已复制，粘到公众号「摘要」框 📝' : '复制失败，请长按手动复制');
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

// 排序（最新在前 / 最早在前 / 队列顺序）
document.querySelectorAll('#mSortRow .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#mSortRow .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentSort = chip.dataset.sort;
    localStorage.setItem('xhsSort', currentSort);
    render();
  });
});
// 初始化：把记住的排序反映到按钮高亮（与桌面端共用同一偏好）
document.querySelectorAll('#mSortRow .chip').forEach(c =>
  c.classList.toggle('active', c.dataset.sort === currentSort));

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
