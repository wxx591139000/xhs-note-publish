/**
 * 队列排序回归测试（双端：桌面 app.js + 手机 mobile.js）
 * ------------------------------------------------------------------
 * 直接从 static/app.js 与 static/mobile.js 抽取**线上实际运行的**
 * sortNotes / filtered / fmtTime / purposeOf 函数体，喂同一组构造数据断言。
 * —— 不重写实现，避免"测试与实现各写一份"。
 *
 * 跑法：  node scripts/test_queue_sort.js
 * 退出码：0=全过，1=有失败
 *
 * 用例覆盖：
 *   1. newest  : 状态分组不倒退（待发布→草稿→已发布）+ 组内按编写时间倒序
 *   2. oldest  : 组内按编写时间正序
 *   3. queue   : 严格保持后端返回原序（零行为回归）
 *   4. 最新编写的待发布笔记位于列表首位（本次需求的核心诉求）
 *   5. 同秒创建用 id 兜底，保证稳定排序
 *   6. 与状态/平台筛选联动后仍保持所选排序
 *   7. ★ 双端一致性：同输入同排序下，桌面与手机输出的 id 序列必须完全相同
 *      （防止"只改了一端"，这是两端各有一份 sortNotes 后的真实漂移风险）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILES = {
  desktop: path.join(__dirname, '..', 'static', 'app.js'),
  mobile: path.join(__dirname, '..', 'static', 'mobile.js'),
};

// ---- 构造数据：刻意打乱顺序，且含"同秒创建"边界 ----
const T = 1786000000;
const fixtures = [
  { id: 1, status: 'published', created_at: T + 100, position: 1, title: '已发布-早', meta: { purpose: 'xhs' }, images: [], tags_list: [] },
  { id: 2, status: 'pending', created_at: T + 300, position: 5, title: '待发布-新', meta: { purpose: 'xhs' }, images: [], tags_list: [] },
  { id: 3, status: 'drafted', created_at: T + 200, position: 3, title: '草稿-中', meta: { purpose: 'idlefish' }, images: [], tags_list: [] },
  { id: 4, status: 'pending', created_at: T + 300, position: 6, title: '待发布-同秒大id', meta: { purpose: 'common' }, images: [], tags_list: [] },
  { id: 5, status: 'published', created_at: T + 400, position: 7, title: '已发布-晚', meta: { purpose: 'xhs' }, images: [], tags_list: [] },
  { id: 6, status: 'pending', created_at: T + 50, position: 2, title: '待发布-旧', meta: { purpose: 'xhs' }, images: [], tags_list: [] },
];

// ---- 按锚点 + 括号配对抽取函数体（不重写实现）----
function loadApi(file, filteredName) {
  const src = fs.readFileSync(file, 'utf8');
  const extract = (anchor) => {
    const i = src.indexOf(anchor);
    if (i < 0) throw new Error(path.basename(file) + ' 中找不到锚点: ' + anchor);
    let depth = 0, started = false;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (c === '{') { depth++; started = true; }
      else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
    }
    throw new Error('括号不匹配: ' + anchor);
  };
  const code = [
    extract('function purposeOf(n)'),
    extract('const STATUS_RANK'),
    extract('function sortNotes(notes)'),
    extract('function fmtTime(ts)'),
    extract('function ' + filteredName + '('),
  ].join('\n');

  // 两端筛选变量名不同（桌面 currentPurposeFilter / 手机 currentPlat），
  // sandbox 同时提供两个，setter 一起改，使同一套用例可跑两端。
  const sandbox = {
    allNotes: fixtures, currentFilter: 'all',
    currentPurposeFilter: 'all', currentPlat: 'all', currentSort: 'newest',
  };
  const api = new Function('sandbox', 'with(sandbox){' + code +
    '\nreturn {filtered:function(){return ' + filteredName + '();},'
    + ' fmtTime:fmtTime,'
    + ' setSort:function(s){currentSort=s}, setFilter:function(f){currentFilter=f},'
    + ' setPlat:function(p){currentPurposeFilter=p;currentPlat=p}};}'
  )(sandbox);
  return api;
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + label); }
  else { fail++; console.log('  [FAIL] ' + label + (extra ? '  → ' + extra : '')); }
}
const ids = (arr) => arr.map((x) => x.id);
const rank = { pending: 0, drafted: 1, published: 2 };

function runSuite(tag, api) {
  console.log('\n' + '━'.repeat(52) + '\n【' + tag + '】');

  // 1. newest
  console.log('\n[1] newest（默认，最新在前）');
  api.setSort('newest');
  let a = api.filtered();
  let grouped = true, timeDesc = true;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1], q = a[i];
    if (rank[p.status] > rank[q.status]) grouped = false;
    if (rank[p.status] === rank[q.status] && p.created_at < q.created_at) timeDesc = false;
  }
  check('状态分组不倒退（待发布→草稿→已发布）', grouped, JSON.stringify(ids(a)));
  check('组内按编写时间倒序', timeDesc, JSON.stringify(ids(a)));
  check('首位 = 最新编写的待发布笔记', a[0].id === 4, '实际 id=' + a[0].id);
  check('同秒创建时 id 大的在前（稳定排序）', a[0].id === 4 && a[1].id === 2, JSON.stringify(ids(a).slice(0, 2)));

  // 2. oldest
  console.log('\n[2] oldest（最早在前）');
  api.setSort('oldest');
  a = api.filtered();
  let timeAsc = true;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1], q = a[i];
    if (rank[p.status] === rank[q.status] && p.created_at > q.created_at) timeAsc = false;
  }
  check('组内按编写时间正序', timeAsc, JSON.stringify(ids(a)));
  check('首位 = 最早编写的待发布笔记', a[0].id === 6, '实际 id=' + a[0].id);

  // 3. queue
  console.log('\n[3] queue（队列顺序，原行为）');
  api.setSort('queue');
  a = api.filtered();
  check('严格保持后端返回原序（零回归）',
    JSON.stringify(ids(a)) === JSON.stringify(ids(fixtures)),
    JSON.stringify(ids(a)) + ' vs ' + JSON.stringify(ids(fixtures)));

  // 4. 与筛选联动
  console.log('\n[4] 与筛选联动');
  api.setSort('newest');
  api.setFilter('pending');
  a = api.filtered();
  check('筛选「待发布」后仍最新在前', a[0].id === 4 && a[a.length - 1].id === 6, JSON.stringify(ids(a)));
  api.setPlat('xhs');
  a = api.filtered();
  check('叠加平台筛选（小红书）后结果正确',
    ids(a).every((i) => fixtures.find((f) => f.id === i).meta.purpose === 'xhs'), JSON.stringify(ids(a)));
  api.setFilter('all'); api.setPlat('all');

  // 5. 时间格式化
  console.log('\n[5] 编写时间格式化');
  const now = Math.floor(Date.now() / 1000);
  check('当天显示为「今天 HH:MM」', /^今天 \d{2}:\d{2}$/.test(api.fmtTime(now)), api.fmtTime(now));
  check('往日显示为「MM-DD HH:MM」', /^\d{2}-\d{2} \d{2}:\d{2}$/.test(api.fmtTime(now - 86400 * 3)), api.fmtTime(now - 86400 * 3));
  check('空值返回空串', api.fmtTime(0) === '', JSON.stringify(api.fmtTime(0)));

  api.setSort('newest');
}

console.log('队列排序回归测试（桌面 + 手机）\n' + '='.repeat(52));
const desktop = loadApi(FILES.desktop, 'filteredNotes');
const mobile = loadApi(FILES.mobile, 'filtered');

runSuite('桌面 static/app.js', desktop);
runSuite('手机 static/mobile.js', mobile);

// 7. 双端一致性
console.log('\n' + '━'.repeat(52) + '\n【双端一致性】');
let mismatches = [];
for (const s of ['newest', 'oldest', 'queue']) {
  for (const f of ['all', 'pending', 'drafted', 'published']) {
    for (const p of ['all', 'xhs', 'idlefish', 'common']) {
      desktop.setSort(s); desktop.setFilter(f); desktop.setPlat(p);
      mobile.setSort(s); mobile.setFilter(f); mobile.setPlat(p);
      const d = JSON.stringify(ids(desktop.filtered()));
      const m = JSON.stringify(ids(mobile.filtered()));
      if (d !== m) mismatches.push(`sort=${s} filter=${f} plat=${p}: 桌面${d} vs 手机${m}`);
    }
  }
}
console.log('  组合数 = ' + (3 * 4 * 4) + '（3 排序 × 4 状态 × 4 平台）');
check('桌面与手机输出完全一致（同输入同排序）', mismatches.length === 0, mismatches.slice(0, 3).join(' | '));

console.log('\n' + '='.repeat(52));
console.log('结果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
