# 小红书笔记发布工具 · 项目详细方案

> 版本：v1.6.0（2026-10-01 归档）

## 系统架构图（文字）

```
┌─ 电脑端 (Windows) ──────────────────────────────────────┐
│  Flask app.py (0.0.0.0:8800)                            │
│    ├─ SQLite data/notes.db                             │
│    ├─ 上传 data/uploads/                                │
│    ├─ templates/ (login/desktop/mobile/send)           │
│    ├─ static/ (style/app.js/mobile.js/send.js)         │
│    └─ CORS 白名单（纵横工作台 / xhs 域名 / file://）      │
└──────────────┬──────────────────────────────────────────┘
               │ cloudflared 新隧道 xhs-tunnel (27da88b4)
               ▼
          https://xhs.zhuanlu.xyz
               │
      ┌────────┴─────────┬─────────────┬──────────────┐
      ▼                  ▼             ▼              ▼
   电脑浏览器          手机浏览器      AutoX.js(安卓)  纵横工作台
   /app 管理          /m 发布         无障碍驱动小红书  （跨域只读 API）
```

## 模块划分与职责

- **app.py**：Flask 主应用。路由/API/数据库/二维码/认证/自动化凭据/CORS/只读接口。
- **templates/**：四个页面模板（login 登录门、desktop 桌面管理、mobile 手机发布、send 发货话术）。
- **static/app.js**：桌面端逻辑（编辑、传图、预览、队列、排序、图位、二维码、改密码、自动化）。
- **static/mobile.js**：手机端逻辑（过滤、排序、一键复制、标记状态、定时刷新、图位剥离）。
- **static/send.js**：发货话术页逻辑（拼话术 + 一键复制）。
- **static/style.css**：统一样式（桌面+手机响应式，含排序行/图位/预览配图）。
- **import_note.py**：产线 md 稿子 → 工具 API 导入（解析标题/正文/标签/配图）。
- **xhs_auto.js**：AutoX.js 脚本，安卓无障碍驱动小红书填草稿。
- **scripts/**：回归测试与运维脚本（`test_queue_sort.js` / `test_img_slots.js` / `attach_images_20260912.py`）。
- **run.bat / start.bat**：单机 / 服务+隧道一键启动（均自动挑选装了 Flask 的解释器）。

## 数据流 / 调用链路

### 笔记主链路
```
桌面/手机 → /api/notes → SQLite notes 表
  每条笔记: title/body/tags/cover/images(JSON)
         /meta(JSON: 宝贝字段 dict + purpose 用途标记)/status/position/时间戳
```

### 状态机
```
pending(待发布) → [AutoX.js 自动填草稿] → drafted(草稿) → [人工发布+标记] → published(已发布)
published 移到队列末尾(position=MAX+1)
```
后端队列顺序（API 与自动化都依赖它，**不要动**）：
`ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'drafted' THEN 1 ELSE 2 END, position, id`

### 前端排序（v1.4.0，不改后端）
```
filteredNotes() = 状态筛选 ∩ 用途筛选    （顺序与后端一致）
→ sortNotes()  ← 仅前端，三档:
     newest(默认) 状态分组内 created_at 降序（同秒用 id 兜底）
     oldest       状态分组内 created_at 升序
     queue        保持后端原序（= 旧行为）
状态分组(待发布→草稿→已发布) 始终保留 → 不破坏「已发布沉底」
偏好写 localStorage（桌面/手机共用同一 key）
```
★ 桌面 `static/app.js` 与手机 `static/mobile.js` **各有一份 `sortNotes`** → 必须双端一致，
由 `scripts/test_queue_sort.js` 的 48 组矩阵断言守住。

### 图文混排图位（v1.5.0）
```
body 内 `[[图N]]`（兼容 `[[图 1]]` / `[[图片1]]` / `[[图1|图注]]`）
→ splitByImgSlots(body)  →  [{text}, {img:N, caption}, …]
→ 预览按序渲染: 文本段 → 该位置插第 N 张图（等比缩放）
未指定位置的图 → 正文末尾兜底 + 明确提示；图号越界 → 明确报错（不静默吞）
第 1 张 = 封面（卡片顶部），正文再写 [[图1]] 提示「已作封面」
→ 复制/显示/字数统计 前一律 stripImgSlots() 剥离（否则漏到发布文案）
★ 两端各一份 stripImgSlots → 由 scripts/test_img_slots.js 守双端一致
```

### 只读预览 API（v1.6.0，供纵横工作台）
```
纵横工作台前端 ── CORS 白名单放行 ──→ GET /api/view/notes?token=<auto_token>
                                      GET /api/view/notes/<id>?token=
token == settings.auto_token 才放行，否则 403；只读，不写库。
```

### 自动化链路
```
AutoX.js --token--> GET /api/auto/notes → 列表
AutoX.js 下载 /uploads/<img> → 手机本地
AutoX.js 驱动小红书填草稿 → POST /api/auto/notes/<id>/drafted
```

### 手机端图片保存链路（逐张确认）
```
用户点「📥 下载图(N)」→ 弹层显示第1张 + 「保存此图」
  → 用户点「保存此图」(新鲜手势) → 浏览器弹下载界面 → 存进相册
  → 按钮变「保存完成·下一张 →」→ 用户再点 → 第2张 … 至全部
每张都由用户亲手触发，绝不自跳，绕开浏览器批量下载拦截/弹窗闪烁。
```

### 静态资源防缓存
- 模板里引用 `style.css?v=<日期>` / `mobile.js?v=<日期>`，版本号一变 → 浏览器当新资源重拉。

### 认证
- 页面/API：Flask session cookie
- 自动化：`?token=` 免登录（settings 表 auto_token）

## 关键设计决策

1. **统一格式存储素材**：一条笔记 = 标题/正文/标签/封面/多图，JSON 存图片数组。
2. **不自动发布**：小红书风控，只做「辅助发布」+「填草稿」，最稳。
3. **无外部 CDN**：所有前端资源本地化，内网/隧道离线可用。
4. **双隧道拆分**：VPS 管转录三域名，本地单独 xhs-tunnel 管小红书，互不抢。
5. **存草稿优先**：自动填充默认 draft 模式，人工审核再发布。
6. **桌面/手机筛选用途一致**（v1.3.0）：用途(平台)既能选入 editor、也能在列表/队列筛选——桌面用 `currentPurposeFilter` + `[data-pfilter]` chips 与状态筛选(`[data-filter]`)叠加；复用筛选容器时用**独立属性选择器**区分，避免双绑。
7. **排序放前端，不动后端 SQL**（v1.4.0）：`/api/notes` 与 `/api/auto/notes`（AutoX.js 按 `position` 自动发布）顺序必须保持原样，改动后端排序会**静默改变自动发布顺序** → 零回归代价换用户体验。
8. **图位标记是「可剥离的内部语法」**（v1.5.0）：不新增 DB 字段（老数据无需迁移），而是在 `body` 里写 `[[图N]]`；所有出站路径（复制/显示/字数）统一先剥离，保证不污染发布文案。
9. **预览用「增量改造」而非重建**（v1.5.0）：只去掉 `max-height` 截断、把封面比例 1:1 改 133.33%、配图 `width:100%;height:auto` —— 最小改动达成「完整显示 + 缩放适配」。
10. **写接口最小外露**（v1.6.0）：给纵横工作台只开**只读** API + 白名单 CORS，写入仍走原有需登录的 `/api/notes`，避免跨域写风险。

## 部署架构

- 本机 Flask 监听 `0.0.0.0:8800`
- cloudflared 新隧道 `xhs-tunnel`(27da88b4) → `xhs.zhuanlu.xyz → localhost:8800`
- `start.bat` 同时拉起服务 + 隧道；`run.bat` 只起服务
- **解释器必须是装了 Flask 的那个**（`py -3.11` / `Python311\python.exe`）；PATH 里的裸 `python` 是 3.13.x 无 Flask，两个 bat 已自动挑选（v1.6.0）
- 数据备份：直接复制 `data/notes.db` + `data/uploads/`（`data/` 已进 `.gitignore`，不进库）
- ⚠️ 隧道必须用 `xhs-tunnel`(27da88b4)，**严禁用旧 transcribe-bot 隧道**重启本地 cloudflared（抢 VPS 隧道致 `upload.zhuanlu.xyz` 502）