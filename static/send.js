// 发货话术（按笔记）：每篇笔记可配多个网盘链接，发货链接存进笔记 meta.delivery
const $ = (s) => document.querySelector(s);
const PAN_OPTIONS = ['百度网盘', '夸克网盘', '阿里云盘', '腾讯微云', 'UC网盘', '其他'];

let NOTE = null;
let LINKS = [];

function esc(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('unauth');
  }
  return res.json();
}

async function loadNotes() {
  const data = await api('/api/notes');
  return data.notes || [];
}

function deliveryOf(n) {
  return (n.meta && n.meta.delivery) || {};
}

function currentCfg() {
  return {
    文件: $('#sFile').value.trim(),
    备注: $('#sNote').value.trim(),
    链接: LINKS.filter(l => l.链接.trim()).map(l => ({盘: l.盘, 链接: l.链接.trim(), 提取码: l.提取码.trim()})),
  };
}

function renderPicker(notes) {
  $('#sNoteBar').textContent = '';
  $('#sEditor').style.display = 'none';
  $('#sPicker').style.display = 'block';
  $('#sPickerList').innerHTML = notes.map(n => {
    const d = deliveryOf(n);
    const cnt = (d.链接 || []).filter(x => x && x.链接).length;
    const plat = (n.meta && n.meta.purpose) || 'common';
    const tag = plat === 'idlefish' ? '🐟闲鱼' : plat === 'xhs' ? '📕小红书' : '🔀通用';
    return `<a class="s-pick-item" href="/send?id=${n.id}">
      <div class="s-pick-title">${esc(n.title) || '(无标题)'} <span class="s-pick-tag">${tag}</span></div>
      <div class="s-pick-sub">${n.status === 'published' ? '已发布' : '待发布'} · 网盘链接 ${cnt} 个</div>
    </a>`;
  }).join('') || '<div class="m-empty">暂无笔记</div>';
}

function openNote(n) {
  NOTE = n;
  const d = deliveryOf(n);
  $('#sNoteBar').textContent = '📌 ' + (n.title || '(无标题)');
  $('#sPicker').style.display = 'none';
  $('#sEditor').style.display = 'block';
  $('#sFile').value = d.文件 || n.title || '';
  $('#sNote').value = d.备注 || '';
  LINKS = (d.链接 && d.链接.length)
    ? d.链接.map(x => ({盘: x.盘 || '百度网盘', 链接: x.链接 || '', 提取码: x.提取码 || ''}))
    : [{盘: '百度网盘', 链接: '', 提取码: ''}];
  renderLinks();
  renderPhrases();
}

function renderLinks() {
  $('#sLinks').innerHTML = LINKS.map((l, i) => `
    <div class="s-link-row">
      <select onchange="LINKS[${i}].盘=this.value">
        ${PAN_OPTIONS.map(p => `<option ${p === l.盘 ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <input class="s-link-url" type="text" placeholder="网盘链接（可带 ?pwd= 等参数）" value="${esc(l.链接)}" oninput="LINKS[${i}].链接=this.value">
      <input class="s-link-pwd" type="text" placeholder="提取码" value="${esc(l.提取码)}" oninput="LINKS[${i}].提取码=this.value">
      <button class="btn btn-ghost" onclick="removeLink(${i})">✕</button>
    </div>`).join('');
}

function addLink() {
  LINKS.push({盘: '百度网盘', 链接: '', 提取码: ''});
  renderLinks();
}

function removeLink(i) {
  LINKS.splice(i, 1);
  renderLinks();
}

async function saveNote() {
  if (!NOTE) return;
  const cfg = currentCfg();
  if (!cfg.链接.length) {
    $('#sHint').textContent = '⚠️ 至少填一个网盘链接再保存';
    return;
  }
  const meta = Object.assign({}, NOTE.meta || {});
  meta.delivery = cfg;
  const payload = {
    title: NOTE.title || '',
    body: NOTE.body || '',
    tags: NOTE.tags || '',
    cover: NOTE.cover || '',
    images: NOTE.images || [],
    meta: meta,
  };
  const res = await api('/api/notes/' + NOTE.id, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  NOTE = res.note || NOTE;
  $('#sHint').textContent = '✅ 已保存到这篇笔记';
  renderPhrases();
}

function phrases() {
  const cfg = currentCfg();
  const file = cfg.文件 || '购买的商品';
  const linkLines = cfg.链接.map(l => `${l.盘}：${l.链接}${l.提取码 ? '（提取码：' + l.提取码 + '）' : ''}`);
  const noteText = cfg.备注;
  const std = `收到你的订单啦，这就发你👇

【${file}】
${linkLines.join('\n')}
${noteText ? '\n' + noteText : ''}

虚拟素材请及时确认收货～使用中有任何问题直接找我，售后我都在。
方便的话给个好评呀🙏`;
  const mini = `${file}
${linkLines.join('\n')}
有问题随时找我。`;
  return [
    {name: '标准发货（拍下后发）', text: std},
    {name: '极简发货（老客/催单）', text: mini},
    {name: '拍前咨询（还没拍）', text: '你好～这款是虚拟素材，先拍下付款后发你网盘链接哈。下单前可以先把需求发我，帮你确认能不能用。'},
    {name: '售后 / 收货确认', text: '收到就好～使用中遇到问题，直接把截图或说明发我，我帮你排查。'},
    {name: '好评引导', text: '方便的话给个好评呀，你的反馈是我更新的动力🙏'},
  ];
}

function renderPhrases() {
  $('#sList').innerHTML = phrases().map((p, i) => `
    <div class="s-card">
      <div class="s-card-head"><span class="s-card-name">${esc(p.name)}</span>
        <button class="btn btn-primary" onclick="copyPhrase(${i})">📋 复制</button></div>
      <pre class="s-card-text">${esc(p.text)}</pre>
    </div>`).join('');
}

async function copyPhrase(i) {
  const text = phrases()[i].text;
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
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  $('#sHint').textContent = ok ? '✅ 已复制，去闲鱼粘贴即可' : '❌ 复制失败，请长按文本手动复制';
}

['sFile', 'sNote'].forEach(id => {
  document.getElementById(id).addEventListener('input', renderPhrases);
});
document.getElementById('sAddLink').addEventListener('click', addLink);
document.getElementById('sSave').addEventListener('click', saveNote);

(async function init() {
  const notes = await loadNotes();
  const id = new URLSearchParams(location.search).get('id');
  if (id) {
    const n = notes.find(x => String(x.id) === String(id));
    if (n) { openNote(n); return; }
  }
  renderPicker(notes);
})();
