# 小红书笔记发布工具 📔

> 版本：**v1.1.2**（2026-08-18 归档）· 项目状态：**可用**
>
> 把 AI 融入日常工作——电脑端管理素材，手机端一键复制发布。
> 参考：生财有术《把 AI 融入日常工作，随手做出一个小红书笔记发布工具》。
> 详见 `docs/` 文档套件。

## 它能做什么

- **电脑端**（`/app`）：用统一格式管理笔记素材——标题 / 正文 / 标签 / 封面图 / 多张配图，实时预览排版效果。
- **云端同步**：素材和图片都存在这台电脑上，通过网桥（cloudflare 隧道）让手机随时访问到同一批素材。
- **手机端**（`/m`）：固定网址，打开即预览完整笔记卡片，**一键复制**标题+正文+标签，粘贴到小红书 APP 手动发布。
- **队列管理**：标记「已发布」的笔记自动跳到队列末尾；可一键操作待发布 ↔ 已发布。
- **密码保护**：电脑端和手机端共用访问密码，可随时修改。
- **二维码**：电脑端一键生成手机访问二维码，扫码即达。

> ⚠️ 小红书有风控，**不**做 API 自动发布。工具负责「辅助发布」：把素材组织好、一键复制，图片手动选，正文粘贴后手动点发布。这是最稳妥的方式。

## 快速开始（本机）

```bash
cd E:/myClaudCodeWorkspace/xhs-note-publish
python -m pip install -r requirements.txt
python app.py
```

或双击 `run.bat`。

- 电脑端管理：`http://127.0.0.1:8800/app`
- 手机端发布：`http://127.0.0.1:8800/m`
- 首次密码：`888888`（登录后右上角「改密码」可修改）

## 让手机也能访问（cloudflare 隧道）

已配置好，手机直接打开：

- 手机端：**`https://xhs.zhuanlu.xyz/m`**（密码 `888888`）
- 电脑端：**`https://xhs.zhuanlu.xyz/app`**

**一键启动**（同时拉起服务 + 隧道）：双击 `start.bat`，
会弹出两个窗口（XHS-Server、XHS-Tunnel），关闭它们即停止。

> 电脑关机 / 隧道窗口关闭时手机无法访问，属正常现象（素材存在本机）。
> 隧道配置在 `~/.cloudflared/config.yml`，已为 `xhs.zhuanlu.xyz` 加到现有 transcribe-bot 隧道。

## 自动填充（AutoX.js，存草稿模式）

把「待发布」笔记自动填进小红书编辑器并**存草稿**，人工审核后再发布——规避 API 风控封号风险。

**需要**：一台**安卓手机** + AutoX.js（iOS 做不了）。

### 步骤
1. 手机装 AutoX.js（GitHub `kkevsekk1/AutoX` 或应用市场）。
2. 电脑端右上角「🤖 自动化」→ 复制 **Token** 和 **脚本地址**。
3. 手机浏览器打开脚本地址 → 保存为 `xhs_auto.js` → 导入 AutoX.js。
4. 用 AutoX.js 打开脚本，把 **Token 填进顶部 `CONFIG.TOKEN`**。
5. 保持 `CONFIG.DRY_RUN = true` 先跑一遍，看日志确认「拉取+下载图片」正常。
6. 确认正常后把 `DRY_RUN` 改 `false`，开启无障碍，运行。

> ⚠️ 小红书 UI 版本不同，选择器/文案可能失效。脚本里已做多候选兼容，失效控件按日志调整 `xhs_auto.js` 里的 `clickText/clickDesc` 文案或坐标。
> 🛡️ 默认一运行最多填 5 条、条间随机等 1~5 分钟、逐字模拟真人打字——这就是「不规律间隔」的反检测。

### 状态流转
`待发布(pending)` → 脚本自动填草稿 → `草稿(drafted)` → 你在小红书人工审核发布 → 点「已发布」→ `已发布(published)`（移到队尾）。

## 从产线导入稿子（一键）

产线（`hongshu` 项目）的 markdown 稿子在 Obsidian 里，可一键导入工具：

```bash
python import_note.py "E:/ObsidianHouse/ObsidW/02 Projects项目/hongshu/02-稿子/<稿子名>.md"
```

脚本自动解析：标题、正文、标签、`images/` 配图 → 上传 → 生成笔记。可批量用 for 循环导入多篇。

## 数据在哪

- 数据库：`data/notes.db`
- 上传图片：`data/uploads/`
- 备份：直接复制这两个文件即可。

## 技术栈

Flask + SQLite + 原生 JS，无外部 CDN 依赖，内网 / 隧道均可离线使用。

## 目录结构

```
xhs-note-publish/
├── app.py            # Flask 后端（路由/API/数据库/二维码）
├── requirements.txt
├── run.bat           # 一键启动脚本
├── data/
│   ├── notes.db      # SQLite 数据库（自动创建）
│   └── uploads/      # 上传的图片
├── templates/
│   ├── login.html    # 登录页
│   ├── desktop.html  # 电脑端管理
│   └── mobile.html   # 手机端发布
└── static/
    ├── style.css
    ├── app.js        # 桌面端逻辑
    ├── mobile.js     # 手机端逻辑
    └── placeholder.png
```