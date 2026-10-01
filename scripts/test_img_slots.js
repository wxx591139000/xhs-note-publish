/**
 * 图位标记 [[图N]] 回归测试（桌面 app.js + 手机 mobile.js）
 * ------------------------------------------------------------------
 * 直接从 static/app.js 与 static/mobile.js 抽取**线上实际运行的**
 * IMG_SLOT_SRC / stripImgSlots / splitByImgSlots，喂构造数据断言。
 * —— 不重写实现，避免"测试与实现各写一份"。
 *
 * 跑法：  node scripts/test_img_slots.js
 * 退出码：0=全过，1=有失败
 *
 * 用例覆盖：
 *   1. 四种合法写法都能识别（[[图1]] / [[图 1]] / [[图片1]] / [[图1|说明]]）
 *   2. 按标记切分出的 text/img 片段顺序正确
 *   3. 图号越界 → ok=false（不静默吞掉，预览层要能报错）
 *   4. stripImgSlots 剥离干净（不留标记、不留多余空行）
 *   5. ★ 双端一致：app.js 与 mobile.js 的 stripImgSlots 同输入同输出
 *      （两处各有一份实现，是真会漂移的地方；手机端复制文案必须与桌面端口径一致）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILES = {
  desktop: path.join(__dirname, '..', 'static', 'app.js'),
  mobile: path.join(__dirname, '..', 'static', 'mobile.js'),
};

function extract(src, anchor, file) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error(path.basename(file) + ' 中找不到锚点: ' + anchor);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('括号不匹配: ' + anchor);
}

// 桌面端：抽 IMG_SLOT_SRC + stripImgSlots + splitByImgSlots
function loadDesktop() {
  const src = fs.readFileSync(FILES.desktop, 'utf8');
  const c0 = src.indexOf('const IMG_SLOT_SRC');
  const lineEnd = src.indexOf('\n', c0);
  const code = [
    src.slice(c0, lineEnd + 1),
    extract(src, 'function stripImgSlots(s)', FILES.desktop),
    extract(src, 'function splitByImgSlots(body, imageCount)', FILES.desktop),
  ].join('\n');
  return new Function('return (function(){' + code
    + '\nreturn {stripImgSlots:stripImgSlots, splitByImgSlots:splitByImgSlots};})()')();
}

// 手机端：只抽 stripImgSlots
function loadMobile() {
  const src = fs.readFileSync(FILES.mobile, 'utf8');
  const code = extract(src, 'function stripImgSlots(s)', FILES.mobile);
  return new Function('return (function(){' + code
    + '\nreturn {stripImgSlots:stripImgSlots};})()')();
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + label); }
  else { fail++; console.log('  [FAIL] ' + label + (extra ? '  → ' + extra : '')); }
}

console.log('图位标记 [[图N]] 回归测试\n' + '='.repeat(52));
const D = loadDesktop();
const M = loadMobile();

// 1. 四种写法
console.log('\n[1] 合法写法识别');
const cases = [
  ['[[图1]]', 1],
  ['[[图 1]]', 1],
  ['[[图片1]]', 1],
  ['[[图 12]]', 12],
  ['[[图1|封面说明]]', 1],
  ['[[图2|第二张的图注]]', 2],
];
for (const [token, n] of cases) {
  const segs = D.splitByImgSlots('前文\n' + token + '\n后文', 20);
  const img = segs.find(s => s.kind === 'img');
  check(`${token} → 图号 ${n}`, !!img && img.n === n && img.ok, JSON.stringify(segs));
}

// 2. 片段顺序
console.log('\n[2] 片段切分顺序');
let segs = D.splitByImgSlots('第一段\n[[图2]]\n第二段\n[[图3]]\n第三段', 5);
check('文本/图片交替且顺序正确',
  segs.map(s => s.kind).join(',') === 'text,img,text,img,text',
  segs.map(s => s.kind).join(','));
check('图片片段图号依次为 2,3', segs.filter(s => s.kind === 'img').map(s => s.n).join(',') === '2,3');
check('文本片段内容无损',
  segs[0].text.includes('第一段') && segs[2].text.includes('第二段') && segs[4].text.includes('第三段'),
  JSON.stringify(segs.filter(s => s.kind === 'text').map(s => s.text)));

// 3. 越界
console.log('\n[3] 图号越界');
segs = D.splitByImgSlots('文字\n[[图9]]\n文字', 2);
let img = segs.find(s => s.kind === 'img');
check('[[图9]] 在只有 2 张图时 ok=false（预览层可据此报错）', img && img.ok === false, JSON.stringify(img));
check('[[图0]] 视为越界（图号从 1 开始）',
  D.splitByImgSlots('[[图0]]', 3).find(s => s.kind === 'img').ok === false);
segs = D.splitByImgSlots('文字\n[[图2]]\n文字', 2);
check('边界：[[图2]] 恰好等于图数时 ok=true', segs.find(s => s.kind === 'img').ok === true);

// 4. 无标记
console.log('\n[4] 无标记时的行为');
segs = D.splitByImgSlots('就是一段普通正文，没有任何标记。', 3);
check('整段作为单个 text 片段', segs.length === 1 && segs[0].kind === 'text', JSON.stringify(segs));
check('stripImgSlots 对无标记文本原样返回（仅 trim）',
  D.stripImgSlots('  普通正文  ') === '普通正文');

// 5. 剥离
console.log('\n[5] stripImgSlots 剥离');
const src = '第一段\n[[图2]]\n第二段\n[[图 3|注]]\n第三段';
const out = D.stripImgSlots(src);
check('剥离后不含任何 [[', !out.includes('[['), JSON.stringify(out));
check('剥离后不含残留的"图N"字样', !/图\s*\d/.test(out), JSON.stringify(out));
check('剥离后正文三段都保留',
  out.includes('第一段') && out.includes('第二段') && out.includes('第三段'), JSON.stringify(out));
check('剥离后不产生 3 连空行', !/\n{3,}/.test(out), JSON.stringify(out));
check('剥离后无行尾空格', !/[ \t]+\n/.test(out), JSON.stringify(out));
check('全是标记时返回空串', D.stripImgSlots('[[图1]]\n[[图2]]') === '',
  JSON.stringify(D.stripImgSlots('[[图1]]\n[[图2]]')));

// 6. 非标记不误伤
console.log('\n[6] 不误伤正常正文');
const normal = '【价格】3元/时\n[01:10] 开头\n【常见问题】\n普通[方括号]内容';
check('中文方括号【】不受影响', D.stripImgSlots(normal) === normal);
check('时间戳 [01:10] 不受影响', D.stripImgSlots('[01:10] 开头') === '[01:10] 开头');
check('单方括号 [方括号] 不受影响', D.stripImgSlots('普通[方括号]内容') === '普通[方括号]内容');

// 7. 双端一致
console.log('\n[7] ★ 双端一致（app.js vs mobile.js）');
const inputs = [
  src, '[[图1]]', '[[图 1]]', '[[图片1]]', '[[图1|说明]]', '', '   ',
  normal, '文字[[图1]]文字', '[[图1]][[图2]]', 'a\n\n\n\nb\n[[图1]]\nc',
  '文字 [[图 1]] 内联', '[[图99]]', '没有标记的一段',
];
let mismatch = null;
for (const s of inputs) {
  const a = D.stripImgSlots(s), b = M.stripImgSlots(s);
  if (a !== b) { mismatch = { input: s, desktop: a, mobile: b }; break; }
}
console.log('  组合数 = ' + inputs.length);
check('两端 stripImgSlots 输出完全一致', mismatch === null,
  mismatch ? `input=${JSON.stringify(mismatch.input)} 桌面=${JSON.stringify(mismatch.desktop)} 手机=${JSON.stringify(mismatch.mobile)}` : '');

console.log('\n' + '='.repeat(52));
console.log('结果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
