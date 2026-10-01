// 预览渲染实测 v2：排除懒加载干扰，区分「真 code bug」与「等待不足」
import { createRequire } from 'node:module';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['C:/Users/Dancing/AppData/Roaming/npm/node_modules/playwright', 'playwright']) {
  try { chromium = require(p).chromium; break; } catch (e) {}
}
if (!chromium) { console.error('FATAL: 无 playwright'); process.exit(2); }

const BASE = 'http://127.0.0.1:8800';
const SHOT = 'E:/myClaudCodeWorkspace/xhs-note-publish/docs/_verify';
const log = []; const say = (s) => { log.push(s); console.log(s); };
fs.mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const imgNet = [];
page.on('response', (r) => { if (/\.(png|jpe?g|webp)(\?|$)/i.test(r.url())) imgNet.push({ u: r.url(), s: r.status() }); });

try {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="password"], input[name="password"]', '888888');
  await page.click('button[type="submit"], input[type="submit"], button');
  await page.waitForTimeout(800);
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ===== A) 左侧列表缩略图：先排除"懒加载"这个解释 =====
  // 把 loading=lazy 全改 eager，并滚动全程，给足 5s。若仍是占位图 => 确定是 src 写错
  await page.evaluate(async () => {
    document.querySelectorAll('.note-thumb').forEach((i) => { i.loading = 'eager'; });
    const sc = document.querySelector('#noteList') || document.scrollingElement;
    for (let y = 0; y <= sc.scrollHeight; y += 400) { sc.scrollTop = y; await new Promise(r => setTimeout(r, 40)); }
    sc.scrollTop = 0;
  });
  // 关键：等所有缩略图真正 complete（不靠固定 sleep 猜）
  let wa = 'OK';
  try {
    await page.waitForFunction(() => {
      const t = [...document.querySelectorAll('.note-thumb')];
      return t.length > 0 && t.every(i => i.complete);
    }, null, { timeout: 25000 });
  } catch (e) { wa = 'TIMEOUT'; }
  await page.waitForTimeout(1200);
  say(`[A] 等待全部缩略图 complete: ${wa}`);

  const thumbs = await page.$$eval('.note-thumb', (els) => els.map((e) => ({
    src: e.getAttribute('src'), cur: e.currentSrc, nw: e.naturalWidth, complete: e.complete,
    title: (e.closest('.note-item')?.querySelector('.note-title')?.innerText || '').trim().slice(0, 36),
  })));
  const srcSet = [...new Set(thumbs.map(t => t.src))];
  const placeholderN = thumbs.filter(t => t.src === '/static/placeholder.png').length;
  // ★ 注意：字段名是 nw（见 $$eval 的 map），不是 naturalWidth —— 写错会静默全判 BAD
  const realLoadedN = thumbs.filter(t => t.complete && t.nw > 1 && t.src !== '/static/placeholder.png').length;
  const stillBad = thumbs.filter(t => !(t.complete && t.nw > 1) && t.src !== '/static/placeholder.png');
  say(`[A] 列表缩略图 共${thumbs.length}张 | src取值种类=${srcSet.length}`);
  say(`[A] 未配图的(占位图)=${placeholderN} / 真图加载成功=${realLoadedN} / 真图仍异常=${stillBad.length}`);
  for (const b of stillBad.slice(0, 6)) say(`     BAD nw=${b.nw} complete=${b.complete} src=${b.src.slice(0, 60)} | ${b.title}`);
  say(`[A] 结论: ${realLoadedN > 0 && stillBad.length === 0 ? '★ 缩略图已可正常显示' : (placeholderN === thumbs.length ? '★ 全部为占位图 => src 缺前缀' : '部分异常(见上)')}`);

  // 反证：API 里的 images[0] 拼上 /uploads/ 前缀后，HTTP 是能取到的
  const apiFirst = await page.evaluate(async () => {
    const r = await fetch('/api/notes'); const j = await r.json();
    return j.notes.slice(0, 5).map(n => ({ id: n.id, first: (n.images || [])[0] || '' }));
  });
  say('[A-反证] 直接用 API 的 images[0] 拼 /uploads/ 请求:');
  for (const x of apiFirst) {
    const probe = await page.evaluate(async (u) => {
      try { const r = await fetch(u); return { s: r.status, t: r.headers.get('content-type') }; }
      catch (e) { return { s: -1, t: String(e) }; }
    }, '/uploads/' + x.first);
    say(`    id=${x.id} /uploads/${(x.first || '(空)').slice(0, 24)}... -> ${probe.s} ${probe.t}`);
  }

  await page.screenshot({ path: SHOT + '/01-list.png' });

  // ===== B) 预览面板：强制 eager + 滚动 + 等全部 complete =====
  const out = [];
  for (const key of ['喇叭', '打脸']) {
    await page.locator('.note-item', { hasText: key }).first().click();
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
      document.querySelectorAll('#previewBody img').forEach((i) => { i.loading = 'eager'; });
      const sc = document.querySelector('.preview-pane, #previewBody')?.closest('[style*=overflow], .preview, main') || document.scrollingElement;
      for (let y = 0; y <= sc.scrollHeight; y += 300) { sc.scrollTop = y; await new Promise(r => setTimeout(r, 60)); }
      sc.scrollTop = 0;
    });
    // 等待所有图 complete（最多 15s）
    try {
      await page.waitForFunction(
        () => [...document.querySelectorAll('#previewBody img')].every(i => i.complete),
        null, { timeout: 15000 });
    } catch (e) { say(`[B] 「${key}」等图 complete 超时（可能仍有未加载）`); }

    const pv = await page.evaluate(() => {
      const uniq = []; const seen = new Set();
      for (const e of document.querySelectorAll('#previewBody img, #previewCover img')) {
        const k = e.getAttribute('src'); if (seen.has(k)) continue; seen.add(k);
        const r = e.getBoundingClientRect();
        uniq.push({ src: e.getAttribute('src'), nw: e.naturalWidth, complete: e.complete,
                    w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && r.height > 0 });
      }
      return {
        title: (document.querySelector('#previewTitle')?.innerText || '').trim(),
        bodyLen: (document.querySelector('#previewBody')?.innerText || '').trim().length,
        coverBg: document.querySelector('#previewCover')?.style.backgroundImage || '',
        imgs: uniq,
      };
    });
    const good = pv.imgs.filter(i => i.complete && i.nw > 1).length;
    const bads = pv.imgs.filter(i => !(i.complete && i.nw > 1));
    say(`[B] 「${key}」 ${pv.title} | 正文${pv.bodyLen}字 | 图${pv.imgs.length}张 正常${good} 异常${bads.length}`);
    say(`    cover = ${pv.coverBg.replace(/^url\(|\)$/g, '').slice(0, 60)}`);
    for (const i of pv.imgs) say(`      ${i.complete && i.nw > 1 ? 'OK  ' : 'BAD '} nw=${i.nw} ${i.w}x${i.h} vis=${i.vis} ${i.src.slice(0, 52)}`);
    out.push({ key, ...pv });
    await page.screenshot({ path: SHOT + `/02-preview-${key}.png` });
  }

  // ===== C) 网络层汇总 =====
  const bad404 = imgNet.filter(x => x.s >= 400);
  say(`[C] 图片请求 ${imgNet.length} 个，>=400 共 ${bad404.length} 个`);
  const noPrefix = bad404.filter(x => !x.u.includes('/uploads/'));
  const withPrefix = bad404.filter(x => x.u.includes('/uploads/'));
  say(`[C] 其中「缺 /uploads/ 前缀」的 404 = ${noPrefix.length} 个  ← 直接证据`);
  say(`[C] 其中「/uploads/ 路径下」的 404 = ${withPrefix.length} 个`);
  for (const x of noPrefix.slice(0, 3)) say(`     ${x.s} ${x.u}`);
  for (const x of withPrefix.slice(0, 3)) say(`     ${x.s} ${x.u}`);

  const allPrevOk = out.every(o => o.imgs.every(i => i.complete && i.nw > 1));
  const thumbsAllGood = realLoadedN > 0 && stillBad.length === 0;
  const verdict = (allPrevOk && thumbsAllGood && withPrefix.length === 0 && noPrefix.length === 0) ? 'PASS' : 'FAIL';
  fs.writeFileSync('C:/Users/Dancing/AppData/Local/Temp/preview_render_result.json',
    JSON.stringify({ log, thumbs, placeholderN, realLoadedN, previews: out,
                     netImgTotal: imgNet.length, netBad404: bad404.length,
                     noPrefix404: noPrefix.length, withPrefix404: withPrefix.length, verdict }, null, 2), 'utf8');
  say('VERDICT: ' + verdict);
} catch (e) { say('[ERR] ' + (e?.stack || e)); }
finally { await browser.close(); }
