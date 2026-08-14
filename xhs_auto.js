"ui";
/**
 * ============================================================
 *  小红书笔记发布工具 · AutoX.js 自动填充脚本
 * ============================================================
 * 【作用】从工具拉取"待发布"笔记，模拟真人操作，把标题/正文/图片
 *        自动填进小红书编辑器，然后【存草稿】（默认，最安全）。
 *        人工审核草稿后再发布，规避风控封号风险。
 *
 * 【原理】安卓"无障碍服务"。需要手机安装 AutoX.js 并开启无障碍。
 *
 * 【重要】小红书 UI 版本不同，选择器可能失效。不能运行的控件，
 *        请按日志提示调整下方 findXxx 的文案/坐标。
 *
 * 【先跑 DRY_RUN】首次务必把 DRY_RUN 设成 true 跑一遍，只看日志确认
 *        拉取+下载图片 OK，再改回 false 真自动。见末尾"我的笔记→运行"。
 * ============================================================
 */

var CONFIG = {
  // ---- 必改 ----
  BASE_URL: "https://xhs.zhuanlu.xyz",   // 工具地址（公网）
  TOKEN: "在这里填你的token",             // 桌面端"自动化"里复制的token

  // ---- 一般不用改 ----
  XHS_PACKAGE: "com.xingin.xhs",          // 小红书安卓包名
  IMAGE_DIR: "/sdcard/Download/xhs_auto/",// 临时下载图片目录

  // 模式: "draft"(存草稿,推荐) / "publish"(直接发布,高风险)
  MODE: "draft",

  // 反检测随机化（"自动模拟人工操作，不规律间隔"）
  MIN_NOTE_INTERVAL: 60,     // 相邻两条笔记的最小间隔(秒)
  MAX_NOTE_INTERVAL: 300,    // 相邻两条笔记的最大间隔(秒)
  MAX_NOTES_PER_RUN: 5,      // 单次运行最多填几条（压低频率更安全）
  MAX_IMAGES: 9,             // 单条最多选几张图（小红书上限9）
  TYPING: true,              // true=逐字模拟真人打字，false=瞬间填入

  // 调试
  DRY_RUN: true,             // true=只拉取+下载图片并打印日志，不碰小红书
};

// ============================================================
//  工具函数
// ============================================================
auto.waitFor();                 // 等待无障碍服务就绪
// console.show();              // 需要看日志时打开，会弹悬浮日志窗

function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function log(msg) { console.log(msg); }
function toast2(msg) { toast(msg); }

// 随机等待（模拟人不可预测的节奏）
function humanWait(min, max) { sleep(ri(min, max)); }

// 按"文案"找控件点击，找不到则依次尝试备选文案
function clickText(candidates, timeout) {
  timeout = timeout || 3000;
  if (typeof candidates === "string") candidates = [candidates];
  for (var i = 0; i < candidates.length; i++) {
    var el = text(candidates[i]).findOne(timeout);
    if (el) { el.click(); return true; }
  }
  return false;
}

function clickDesc(candidates, timeout) {
  timeout = timeout || 3000;
  if (typeof candidates === "string") candidates = [candidates];
  for (var i = 0; i < candidates.length; i++) {
    var el = desc(candidates[i]).findOne(timeout);
    if (el) { el.click(); return true; }
  }
  return false;
}

// 逐字填入（模拟真人打字速度）
function typeText(node, s) {
  if (!CONFIG.TYPING) { node.setText(s); return; }
  node.setText("");
  for (var i = 0; i < s.length; i++) {
    node.setText(node.text() + s.charAt(i));
    sleep(ri(30, 120));     // 每字随机 30~120ms
  }
}

// ============================================================
//  1. 拉取待发布笔记
// ============================================================
function fetchNotes() {
  var url = CONFIG.BASE_URL + "/api/auto/notes?token=" + CONFIG.TOKEN;
  log("拉取: " + url);
  var res = http.get(url, { timeout: 15000 });
  if (res.statusCode != 200) { log("拉取失败 status=" + res.statusCode); return []; }
  return (res.body.json() || {}).notes || [];
}

// ============================================================
//  2. 下载图片到手机
// ============================================================
function downloadImages(note) {
  files.ensureDir(CONFIG.IMAGE_DIR);
  var local = [];
  for (var i = 0; i < note.images.length && i < CONFIG.MAX_IMAGES; i++) {
    var url = CONFIG.BASE_URL + "/uploads/" + note.images[i];
    var r = http.get(url, { timeout: 20000 });
    if (r.statusCode != 200) { log("  下载失败: " + note.images[i]); continue; }
    var p = CONFIG.IMAGE_DIR + note.id + "_" + i + ".png";
    files.writeBytes(p, r.body.bytes());
    local.push(p);
    log("  已下载: " + p);
    humanWait(300, 800);
  }
  return local;
}

// ============================================================
//  3. 打开小红书并进入"新建笔记"
// ============================================================
function openEditor() {
  app.launch(CONFIG.XHS_PACKAGE);
  humanWait(2500, 4000);                       // 等 app 启动
  // 底部导航的"发布"入口（不同版本形状不同）
  var ok = clickText(["发布", "+"], 3000) || clickDesc(["发布", "发布笔记"], 3000);
  humanWait(1500, 2500);
  // 弹出的菜单选"新建笔记/上传图文"
  var ok2 = clickText(["新建笔记", "上传图文", "图文笔记"], 3000);
  humanWait(2000, 3000);
  return ok || ok2;
}

// ============================================================
//  4. 填标题 + 点加图 + 选图 + 填正文
// ============================================================
function fillNote(note, localImages) {
  // 4.1 标题（编辑框一般带 hint "填写标题"）
  var titleEd = className("android.widget.EditText").clickable(true).findOne(3000);
  if (titleEd) {
    titleEd.click();
    humanWait(400, 900);
    typeText(titleEd, note.title || "");
    log("  已填标题");
    humanWait(500, 1200);
  } else {
    log("  ⚠️ 没找到标题输入框");
  }

  // 4.2 加图：点"相册/图片"入口
  if (localImages.length) {
    var added = clickText(["相册", "图片", "从相册选择", "添加图片"], 3000);
    humanWait(1500, 2500);
    // 相册选择器：新下载的图在最前，按"最近"顺序点前 N 张缩略图
    // —— 这里最依赖版本，若没选上请按日志调整下面的坐标/选择器
    var cells = className("android.widget.ImageView").clickable(true).find();
    var picked = 0;
    for (var i = 0; i < cells.length && picked < localImages.length; i++) {
      var c = cells[i];
      try {
        c.click();
        picked++;
        log("  已选第 " + picked + " 张图");
        humanWait(400, 1000);
      } catch (e) {}
    }
    if (!picked) log("  ⚠️ 相册选图：可能没点对，请人工检查");
    log("  共选中 " + picked + " 张图");
    // 返回编辑器
    clickText(["完成", "下一步", "确定"], 3000);
    humanWait(1200, 2000);
  }

  // 4.3 正文（hint 常为"填写正文"或"这一刻的想法"）
  var bodyEd = className("android.widget.EditText").findOne(3000);
  if (bodyEd) {
    bodyEd.click();
    humanWait(400, 900);
    typeText(bodyEd, note.body || "");
    humanWait(500, 1200);
  } else {
    log("  ⚠️ 没找到正文输入框");
  }

  // 4.4 标签（追加到正文末尾，小红书用 #）
  if (note.tags) {
    var tags = note.tags.split(",").map(function(t){ return "#" + t.trim(); }).join(" ");
    var ed = className("android.widget.EditText").findOne(3000);
    if (ed) {
      ed.click();
      humanWait(300, 700);
      typeText(ed, " " + tags);
      log("  已填标签");
    }
  }
}

// ============================================================
//  5. 存草稿 / 发布
// ============================================================
function finish(note) {
  if (CONFIG.MODE === "publish") {
    clickText(["发布", "立即发布"], 3000);
    log("→ 已点发布（高风险模式）");
  } else {
    clickText(["存草稿", "保存草稿", "草稿"], 3000);
    log("→ 已点存草稿（推荐）");
    // 部分版本要点两次确认
    clickText(["确定", "保存"], 2000);
  }
  humanWait(1500, 3000);
}

// 标记该笔记为 drafted（草稿已填）
function markDrafted(noteId) {
  var url = CONFIG.BASE_URL + "/api/auto/notes/" + noteId + "/drafted?token=" + CONFIG.TOKEN;
  var res = http.post(url, "", { timeout: 10000 });
  log("标记草稿 status=" + (res.statusCode || "?"));
}

// ============================================================
//  主流程
// ============================================================
function main() {
  toast("XHS自动填充开始");
  var notes = fetchNotes();
  log("待发布笔记数: " + notes.length);
  if (!notes.length) { toast("无待发布笔记"); return; }

  var count = Math.min(notes.length, CONFIG.MAX_NOTES_PER_RUN);
  for (var i = 0; i < count; i++) {
    var note = notes[i];
    log("==== 处理 [" + (i + 1) + "/" + count + "] " + note.title + " ====");
    log("  正文 " + note.body.length + " 字, 图 " + note.images.length + " 张");

    // 下载图片（DRY_RUN 也下载，方便你确认图能拿到）
    var local = downloadImages(note);
    log("  本地图片 " + local.length + " 张");

    if (CONFIG.DRY_RUN) {
      log("  [DRY_RUN] 跳过小红书操作。请把 CONFIG.DRY_RUN 改为 false 再跑。");
      continue;
    }

    openEditor();
    fillNote(note, local);
    finish(note);
    markDrafted(note.id);

    // 反检测：不规律间隔
    if (i < count - 1) {
      var w = ri(CONFIG.MIN_NOTE_INTERVAL, CONFIG.MAX_NOTE_INTERVAL);
      log("  等下一条，随机等 " + w + " 秒");
      sleep(w * 1000);
    }
  }
  toast("本轮完成 ✔");
}

main();