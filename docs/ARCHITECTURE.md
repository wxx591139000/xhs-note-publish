# 小红书笔记发布工具 · 项目详细方案

> 版本：v1.1.2（2026-08-18 归档）

## 系统架构图（文字）

```
┌─ 电脑端 (Windows) ──────────────────────────────────────┐
│  Flask app.py (0.0.0.0:8800)                            │
│    ├─ SQLite data/notes.db                             │
│    ├─ 上传 data/uploads/                                │
│    ├─ templates/ (login/desktop/mobile)                │
│    └─ static/ (style/app.js/mobile.js)                 │
└──────────────┬──────────────────────────────────────────┘
               │ cloudflared 新隧道 xhs-tunnel (27da88b4)
               ▼
          https://xhs.zhuanlu.xyz
               │
      ┌────────┴─────────┬─────────────┐
      ▼                  ▼             ▼
   电脑浏览器          手机浏览器      AutoX.js(安卓)
   /app 管理          /m 发布         无障碍驱动小红书
```

## 模块划分与职责

- **app.py**：Flask 主应用。路由/API/数据库/二维码/认证/自动化凭据。
- **templates/**：三个页面模板（login 登录门、desktop 桌面管理、mobile 手机发布）。
- **static/app.js**：桌面端逻辑（编辑、传图、预览、队列、二维码、改密码、自动化）。
- **static/mobile.js**：手机端逻辑（过滤、一键复制、标记状态、定时刷新）。
- **static/style.css**：统一样式（桌面+手机响应式）。
- **import_note.py**：产线 md 稿子 → 工具 API 导入（解析标题/正文/标签/配图）。
- **xhs_auto.js**：AutoX.js 脚本，安卓无障碍驱动小红书填草稿。
- **run.bat / start.bat**：单机 / 服务+隧道一键启动。

## 数据流 / 调用链路

### 笔记主链路
```
桌面/手机 → /api/notes → SQLite notes 表
  每条笔记: title/body/tags/cover/images(JSON)/status/position/时间戳
```

### 状态机
```
pending(待发布) → [AutoX.js 自动填草稿] → drafted(草稿) → [人工发布+标记] → published(已发布)
published 移到队列末尾(position=MAX+1)
```
队列排序：`ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'drafted' THEN 1 ELSE 2 END, position, id`

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

## 部署架构

- 本机 Flask 监听 `0.0.0.0:8800`
- cloudflared 新隧道 `xhs-tunnel`(27da88b4) → `xhs.zhuanlu.xyz → localhost:8800`
- `start.bat` 同时拉起服务 + 隧道
- 数据备份：直接复制 `data/notes.db` + `data/uploads/`