// 像素级取证：证明缩略图/预览图真的渲染出了各自的配图（当前模型看不了图，用代码取像素证据）
import { createRequire } from 'node:module';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['C:/Users/Dancing/AppData/Roaming/npm/node_modules/playwright', 'playwright']) {
  try { chromium = require(p).chromium; break; } catch (e) {}
}
if (!chromium) { console.error('FATAL: 无 playwright'); process.exit(2); }

const BASE = 'http://127.0.0.1:8800';
const OUT = 'C:/Users/Dancing/AppData/Local/Temp/pixel_proof.json';
const log = []; const say = (s) => { log.push(s); console.log(s); };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

// 把一组 <img> 的渲染像素取样出来
const sampleFn = async (sel, n) => page.evaluate(async ({ sel, n }) => {
  const imgs = [...document.querySelectorAll(sel)].slice(0, n);
  const out = [];
  for (const im of imgs) {
    if (!im.complete || im.naturalWidth < 2) {
      out.push({ src: im.getAttribute('src'), loaded: false, nw: im.naturalWidth }); continue;
    }
    const c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, 48, 48);
    const d = ctx.getImageData(0, 0, 48, 48).data;
    const colors = new Set();
    let rs = 0, gs = 0, bs = 0, np = 0;
    for (let i = 0; i < d.length; i += 4) {
      colors.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; np++;
    }
    // 像素指纹：用于判断两张图是否"长得一样"
    const fp = [...colors].sort().join('|').length + ':' + Math.round(rs / np) + ',' + Math.round(gs / np) + ',' + Math.round(bs / np);
    out.push({ src: im.getAttribute('src'), loaded: true, nw: im.naturalWidth,
               colors: colors.size, avgR: Math.round(rs / np), avgG: Math.round(gs / np), avgB: Math.round(bs / np), fp });
  }
  return out;
}, { sel, n });

try {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="password"], input[name="password"]', '888888');
  await page.click('button[type="submit"], input[type="submit"], button');
  await page.waitForTimeout(700);
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' });

  await page.evaluate(async () => {
    document.querySelectorAll('.note-thumb').forEach(i => i.loading = 'eager');
    const sc = document.querySelector('#noteList') || document.scrollingElement;
    for (let y = 0; y <= sc.scrollHeight; y += 400) { sc.scrollTop = y; await new Promise(r => setTimeout(r, 30)); }
    sc.scrollTop = 0;
  });
  await page.waitForFunction(() => {
    const t = [...document.querySelectorAll('.note-thumb')];
    return t.length > 0 && t.every(i => i.complete);
  }, null, { timeout: 25000 });
  await page.waitForTimeout(1000);

  // ===== 对照组：占位图本身 =====
  const ph = await page.evaluate(async () => {
    const im = new Image(); im.src = '/static/placeholder.png';
    await im.decode();
    const c = document.createElement('canvas'); c.width = 48; c.height = 48;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(im, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    const s = new Set(); let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return { colors: s.size, avgR: Math.round(r / n), avgG: Math.round(g / n), avgB: Math.round(b / n) };
  });
  say(`[对照] placeholder.png 像素: 颜色种类=${ph.colors} 均值RGB=(${ph.avgR},${ph.avgG},${ph.avgB})`);
  say(`         -> 颜色种类 <=3 说明它就是纯灰/纯色底图`);

  // ===== A) 列表缩略图 =====
  const th = await sampleFn('.note-thumb', 60);
  const loadedTh = th.filter(x => x.loaded);
  const richTh = loadedTh.filter(x => x.colors > 8);
  const uniqFp = new Set(loadedTh.map(x => x.fp));
  say(`[A] 缩略图: 已加载 ${loadedTh.length}/${th.length} 张`);
  say(`[A] 其中「颜色种类>8」(非纯色占位) = ${richTh.length} 张`);
  say(`[A] 像素指纹去重后 = ${uniqFp.size} 种  -> 越接近 ${loadedTh.length} 说明每张显示的都是"各自不同的图"`);
  say(`[A] 颜色种类分布(前12): ${loadedTh.slice(0, 12).map(x => x.colors).join(', ')}`);
  const minC = Math.min(...loadedTh.map(x => x.colors));
  const maxC = Math.max(...loadedTh.map(x => x.colors));
  say(`[A] 颜色种类范围: min=${minC} max=${maxC}`);
  for (const x of loadedTh.slice(0, 6)) say(`      colors=${String(x.colors).padStart(4)} avgRGB=(${x.avgR},${x.avgG},${x.avgB}) ${x.src.slice(0, 48)}`);
  const target = loadedTh.filter(x => /85d99dd|f857a85/.test(x.src));
  for (const t of target) say(`      ★目标笔记缩略图 colors=${t.colors} avgRGB=(${t.avgR},${t.avgG},${t.avgB}) ${t.src.slice(0, 48)}`);

  // ===== B) 预览面板 =====
  const pvAll = [];
  for (const key of ['喇叭', '打脸']) {
    await page.locator('.note-item', { hasText: key }).first().click();
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      document.querySelectorAll('#previewBody img').forEach(i => i.loading = 'eager');
      const sc = document.querySelector('#previewBody')?.closest('.pane, [style*=overflow]') || document.scrollingElement;
      for (let y = 0; y <= sc.scrollHeight; y += 260) { sc.scrollTop = y; await new Promise(r => setTimeout(r, 50)); }
      sc.scrollTop = 0;
    });
    try { await page.waitForFunction(() => [...document.querySelectorAll('#previewBody img')].every(i => i.complete), null, { timeout: 20000 }); } catch (e) {}
    const body = await sampleFn('#previewBody img', 20);
    const lb = body.filter(x => x.loaded);
    const rich = lb.filter(x => x.colors > 8);
    say(`[B] 「${key}」正文配图 ${lb.length} 张，颜色种类>8 = ${rich.length} 张`);
    for (const x of lb) say(`      colors=${String(x.colors).padStart(4)} ${x.nw}px avgRGB=(${x.avgR},${x.avgG},${x.avgB}) ${x.src.slice(0, 48)}`);
    pvAll.push({ key, imgs: lb });
  }

  const passA = loadedTh.length >= 30 && richTh.length === loadedTh.length && uniqFp.size >= loadedTh.length * 0.9;
  const passB = pvAll.every(p => p.imgs.length === 5 && p.imgs.every(i => i.colors > 8));
  const verdict = (passA && passB) ? 'PASS' : 'FAIL';
  say('');
  say(`判据A(缩略图全为彩色真图且互不相同): ${passA}`);
  say(`判据B(两篇预览各5张均为彩色真图): ${passB}`);
  say('PIXEL VERDICT: ' + verdict);
  fs.writeFileSync(OUT, JSON.stringify({ log, placeholder: ph, thumbs: th, previews: pvAll, passA, passB, verdict }, null, 2), 'utf8');
} catch (e) { say('[ERR] ' + (e?.stack || e)); }
finally { await browser.close(); }
