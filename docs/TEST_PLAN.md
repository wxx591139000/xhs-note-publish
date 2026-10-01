# 小红书笔记发布工具 · 项目测试计划

> 版本：v1.6.1（2026-10-01 二次归档）

## 测试范围与策略

本项目为 Flask 本地 Web 应用。测试分三层：

1. **自动化回归（Node，无服务/无网络）** —— `scripts/` 下的两个脚本，直接**从 `static/*.js` 抽取线上函数体**执行断言（不是重写副本），防止「测试与实现各写一份」漂移：
   - `node scripts/test_queue_sort.js` —— 队列排序，**25 项**（含 **48 组**双端一致性 = 3 排序 × 4 状态 × 4 平台）
   - `node scripts/test_img_slots.js` —— 图位标记，**24 项**（含 **14 组**双端一致性 + `【价格】`/`[01:10]` 负例）
2. **渲染可视化校验（Node + Playwright + 系统 Chrome，需服务在跑）** —— v1.6.1 新增，**用真实浏览器 + 像素取证**证明"用户真能看见"：
   - `node tools/verify_preview_render.mjs` —— 渲染 + 网络层判据：清点列表缩略图与预览面板每张图的 `naturalWidth`/`complete`/可见性；统计图片请求 **≥400 条数**，并按「是否含 `/uploads/` 前缀」分流（**这是本次缺陷的直接证据**）。退出码 0=PASS
   - `node tools/verify_pixel_proof.mjs` —— **像素级判据**：把每张图 `drawImage` 进 48×48 canvas，统计**颜色种类**与**像素指纹**；**对照 `placeholder.png`（颜色种类 = 1，纯色）** ⇒ 真图颜色种类 44~245、指纹去重 31/32 种 ⇒ 证明"每张显示的都是各自不同的真图"（**不依赖人眼看图**）
3. **手工冒烟 + 浏览器 E2E**（curl / Playwright + 系统 Chrome），覆盖认证、CRUD、上传、隧道、预览渲染等链路。


## 已覆盖的测试（2026-08-14 验证通过）

### 认证
- [x] 错误密码 → 登录页重新显示（HTTP 200）
- [x] 正确密码 → 302 跳转，session 建立
- [x] 未登录访问 `/api/notes` → 401
- [x] 改密码太短 → 拒绝（"密码至少 4 位"）
- [x] 新密码生效后可登录

### 笔记 CRUD
- [x] 创建笔记（含标题/正文/标签/图片）
- [x] 更新笔记
- [x] 删除笔记
- [x] 列表返回过滤字段（images 转数组、tags_list）

### 图片上传
- [x] 上传图片 → 返回 url/name
- [x] 上传文件可访问（HTTP 200）
- [x] 非法格式被拒

### 队列状态机
- [x] 发布 → 移到队列末尾（position=MAX+1）
- [x] 撤回 → 回到 pending
- [x] 自动化标记 drafted

### 自动化接口
- [x] 获取 token（需登录）
- [x] 无 token 访问 → 403
- [x] 带 token 拉取待发布笔记（含图片）
- [x] 标记 drafted
- [x] `/xhs_auto.js` 可下载

### 二维码 & 页面
- [x] QR 接口返回 PNG
- [x] /login /app /m /static 全部 200

### 公网隧道
- [x] `https://xhs.zhuanlu.xyz/` → 302（未登录），`/m` → 200
- [x] 公网 API 可登录、返回笔记
- [x] 双隧道协调：本地 xhs-tunnel 只服务 xhs，VPS 管转录三域名，互不干扰

### 闲鱼 vs 小红书（v1.2.0）
- meta 列迁移：旧库 `ALTER` 补列，note_to_dict 解析 meta + purpose（无则 common）✅
- 桌面「闲鱼宝贝信息」`键:值` 多行 ↔ dict 双向转录 ✅
- 手机「🐟复制宝贝文案」拼接：标题+正文+宝贝字段（node 验证输出正确）✅
- 用途标记：桌面选用途保存；手机平台筛选（小红书/闲鱼/通用）；按钮按用途收敛（闲鱼稿只显示宝贝按钮等）✅
- 历史笔记全标 purpose=xhs：手机「闲鱼」筛选为空、「小红书」筛选 15 篇 ✅

### 桌面队列按用途筛选 + 复制宝贝文案（v1.3.0）
- 桌面「笔记队列」新增「所有/📕小红书/🐟闲鱼/🔀通用」分类 chips ✅（已验证返回 HTML 含 data-pfilter 行）
- 点「所有」→ 列出全部类型笔记；点单一分类 → 只剩对应 purpose ✅
- 用途筛选与状态筛选（全部/待发布/草稿/已发布）**叠加**可用 ✅
- 状态/用途两组筛选用 `[data-filter]`/`[data-pfilter]` 独立选择器，互不误绑 ✅
- 手机「🐟复制宝贝文案」粘贴后**不再含** `purpose:xxx` 结尾行（修复验证）✅

### 手机端图片（v1.1.0）
- 逐张保存流程：每张用户亲手触发（真机部分验证）
- 点图放大层（openImg/closeLightbox）
- 静态资源版本号防缓存生效（真机观察到需刷新才更新 → 已加版本号解决）

### 产线导入
- [x] 单篇导入（标题/正文/标签/3图）
- [x] 批量导入 15 篇（14 成功 + 1 已导入跳过）
- [x] 无 `![[images]]` 引用时按标题前缀匹配 images 目录
- [x] 孤儿图片清理

### 队列排序（v1.4.0，桌面 + 手机）
- `node scripts/test_queue_sort.js` → **25 passed / 0 failed**；其中 **48 组双端一致性**断言（3 排序 × 4 状态 × 4 平台）确保 `app.js` 与 `mobile.js` 输出完全相同 ✅
- 真实 49 条数据跑线上排序函数：默认「最新在前」首位 = 当天新建那条 ✅
- 浏览器 E2E（Playwright + 系统 Chrome）：桌面 **8/8**、手机视口 **12/12**；登录态、三档切换、刷新后 localStorage 记忆均验 ✅
- 反证「排序不影响后端」：`/api/notes` 与 `/api/auto/notes` 顺序与改动前一致 ✅

### 预览完整显示 + 图文混排（v1.5.0）
- `node scripts/test_img_slots.js` → **24 passed / 0 failed**；含 14 组双端一致性 + 负例（`【价格】`/`[01:10]` 不被误当图位）✅
- 桌面 E2E **16/16**：含「预览容器内容高度 == 实际高度」证明**没截断**；封面实测 3:4；配图插在正文指定位置 ✅
- 手机端 E2E **6/6**：复制文案 / 卡片显示 / 字数统计**都已剥离** `[[图N]]` ✅
- 全库核验：49 条笔记 `body` 里 `![[`、`![]()`、`[图N]` **均 0 命中** —— 证实「老笔记无图位数据」，预览走末尾兜底分支（**这是预期，不是 bug**）

### 发货话术页 / 跨域 / 只读 API（v1.6.0）
- `/send`：带登录 cookie → **200**，页面含「网盘/提取码」话术字段 ✅
- CORS：`Origin: https://zongheng.zhuanlu.xyz` → 回 `Access-Control-Allow-Origin/Credentials/Methods/Headers`；`Origin: https://evil.example.com` → **无** CORS 头（非白名单不放行）✅
- 只读 API：`GET /api/view/notes` 无 token → **403**；带正确 token → **200**；`GET /api/view/notes/<真实id>?token=` → **200** 且返回 note JSON；`<不存在id>` → **404** ✅
- 只读语义：调用前后 `/api/notes` 均为 **49 条**（view 接口不写库）✅
- `run.bat` / `start.bat` 解释器挑选逻辑：**静态核对**（先 `py -3.11`，再 `Python311\python.exe`，都无则打印指引 + `exit /b 1`）✅ —— ⚠️ 未在「无 Flask 环境」实机复现
- 语法：`node --check` app.js/mobile.js/send.js + `py_compile` app.py/import_note.py 全过 ✅

### 桌面列表缩略图渲染（v1.6.1，★ 本次修复的回归）
- **缺陷**：`static/app.js` 列表缩略图 `src` 漏拼 `/uploads/` 前缀 ⇒ **51/51 张全是灰占位图**（手机端与预览面板均正常，故长期未被发现）
- **修复前实测**：缩略图 `src` 取值种类 = **1**；浏览器图片请求 **≥400 共 32 个，32/32 均为「缺前缀」**；`/uploads/` 下 404 = **0**
- **修复后实测**：`src` 种类 **1→33**；真图加载 **0→32**；异常 **0**；图片 404 **32→0**；`verify_preview_render.mjs` → **VERDICT: PASS** ✅
- **像素判据**：`verify_pixel_proof.mjs` → 对照 `placeholder.png` 颜色种类 = **1**；32 张缩略图颜色种类 **44~245** 且指纹去重 **31/32 种**；两篇目标笔记预览各 5 张配图全部彩色 ⇒ **PIXEL VERDICT: PASS** ✅
- ⚠️ **判据必须先排除"加载等待不足"**：`loading=lazy`→`eager` + 滚动全程 + `waitForFunction(所有 img.complete)`，仍全占位才可断定是 code bug
- ⚠️ **`onerror` 兜底会让缺陷伪装成正常**：该 `<img>` 带 `onerror` 换占位图 ⇒ 页面"看着有图"、元素计数也正常 ⇒ 判据必须下沉到**网络状态码 / 像素**

### 仅登录后可见的接口（v1.6.1 复核）
- `GET /api/notes` 带 session cookie → **200**，返回 **51 条**（含 `password` 字段）✅
- `GET /api/view/notes/75|76` 带正确 token → **200**；**无 token → 403**（鉴权生效）✅
- `GET /login` 表单 POST 正确密码 → **302 → /app**，session cookie 建立 ✅
- ⚠️ **`/login` 是表单页而非 JSON API**（无 `/api/login`）—— 探测时误用 `/api/login` 会得到 **404**，别据此判断"服务异常"

## 已知测试缺口

- **AutoX.js 真机**：无法在开发环境跑（需安卓+小红书实机），选择器未实机验证，需用户 DRY_RUN + 真机微调
- **并发**：多用户同时操作未测（单用户工具）
- **大文件**：超过 10MB 上传限制的边界未测
- **iOS 手机端**：复制/下载在 iOS 浏览器表现未实测
- **移动端缩略图**：`mobile.js` 的 `/uploads/` 前缀经**代码核对**全对（4/4 处），但**未做像素级实测**（只对桌面端做了）
- **静态拼图前缀无机器闸门**：该类缺陷目前靠"人工 grep 逐处核对"，尚未做成静态检查（见 PROGRESS 待办）

## 建议回归

**每次改动 `static/*.js`（桌面/手机）** → 必跑（秒级，无需服务）：
```bash
node scripts/test_queue_sort.js     # 排序 + 双端一致
node scripts/test_img_slots.js      # 图位标记 + 双端一致
```

**每次改动"图片渲染 / 预览 / 队列列表"** → 追加跑（**需服务在跑**，约 20s）：
```bash
node tools/verify_preview_render.mjs    # 渲染 + 网络层：图片 404 必须为 0
node tools/verify_pixel_proof.mjs       # 像素层：缩略图必须为"各自不同的彩色真图"
```

**每次改动 `app.py`** → 至少跑一遍手工链路：登录 → 建笔记带图 → 发布 → 自动化拉取 → 公网访问。

**每次改动 `templates/*.html`** → 记得**重启服务**再验（Flask 模板内存缓存），否则会误判「没生效」；
**改 `static/*` 则不必重启**（静态文件实时读盘 + `Cache-Control: no-cache` + ETag，实测刷新即生效）。
