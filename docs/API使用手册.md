# 小红书笔记发布工具 · API 使用手册（写推广文案 → 自动存草稿）

> 版本：v1.3.0（2026-08-21 归档一致）· 适用对象：**另一个 Claude 项目 / 外部程序**调用本工具写入推广文案并落为「待发布(待发布)」草稿。
>
> 本手册已用**真实接口端到端验证**（登录→建笔记→status=pending→清理），每条 curl 均实测通过。

---

## 0. 给谁用 / 一句话

你的目标是：**用这套工具把 AI 生成的推广文案存成一个"待发布草稿"**，之后人到手机端 `xhs.zhuanlu.xyz/m` 一键复制发布。

- 登录密码：`888888`（默认；可在桌面端 `/app` 右上角改）
- 建笔记接口：`POST /api/notes`（**必须带头 cookie 登录**）
- 建出来的笔记**默认 status=`pending`（待发布）**，就是你要的"草稿"，无需 token
- 一个独立项目 = 你自己的批次，无需 token、无需写进工具代码，**纯 HTTP 调用即可**
- **两种平台都支持**：同一套接口，靠 `meta.purpose` 区分——📕小红书(`xhs`) / 🐟闲鱼(`idlefish`) / 🔀通用(`common`)。闲鱼稿多填宝贝字段（价格/成色/发货地等），手机端会显示对应的复制按钮。

---

## 1. 前置条件

| 项 | 值 |
|---|---|
| 服务地址 | 本机 `http://127.0.0.1:8800`；公网 `https://xhs.zhuanlu.xyz` |
| 登录密码 | 默认 `888888`（若被改过，用改后的） |
| 服务是否在跑 | 电脑上 `start.bat` / `run.bat` 已启动（监听 :8800） |

> 只要服务在跑，任何能发 HTTP 的东西（curl / Python `requests` / 另一个 Claude 项目）都能写进去。**内容存在这台电脑的 `data/notes.db` 里**，电脑开着手机就能看到。

---

## 2. 三步速通（已验证）

### 第 1 步：登录，拿保存 session 的 cookie 文件

```bash
curl -s -c cookies.txt -d "password=888888" http://127.0.0.1:8800/login
# 成功：HTTP 302 重定向到 /app；cookies.txt 里存了对话 cookie
```

> **`-c cookies.txt` 必须带**，登录态靠它维持。之后所有 `/api/notes` 请求都加 `-b cookies.txt`。
> 公网访问时把 `127.0.0.1:8800` 换成 `https://xhs.zhuanlu.xyz` 即可。

### 第 2 步：POST 建笔记（推广文案 → 待发布草稿）

把文案写进一个 JSON 文件（**强烈建议用文件，别在命令行里写中文 JSON**，见"常见坑"）：

```bash
cat > body.json <<'EOF'
{
  "title": "你的推广标题（建议 20 字内）",
  "body": "这里是整段推广文案正文，可多行，含\n换行和话题标签",
  "tags": "AI工具,效率,种草",            /* 逗号分隔，系统会自动加 # */
  "meta": { "purpose": "xhs" }           /* xhs 小红书 / idlefish 闲鱼 / common 通用 */
}
EOF

curl -s -b cookies.txt --data-binary @body.json \
     -H "Content-Type: application/json" \
     http://127.0.0.1:8800/api/notes
```

成功返回 `201`，返回体里 `"status":"pending"` → 这条推广文案就成了**待发布草稿**。

### 第 3 步：确认落位（可选，自我校验）

```bash
curl -s -b cookies.txt http://127.0.0.1:8800/api/notes
# 返回 notes 列表，找到你那条，status=pending、meta.purpose=xhs
```

---

## 3. 各字段说明（POST /api/notes 的 JSON）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 建议 | 标题（≤60，建议≤20 字抓眼球） |
| `body` | string | 二选一 | 推广文案正文，可 `\n` 换行 |
| `tags` | string | 选 | 逗号分隔如 `"A,B,C"`，展示时自动变 `#A #B #C` |
| `images` | array | 选 | 图片文件名数组（`name`，见第 4 节上传） |
| `cover` | string | 选 | 封面文件名（一般为 `images[0]`） |
| `meta` | object | 选 | `{"purpose":"xhs"}`；闲鱼再加宝贝字段 `价格/成色/发货地` 等 `键:值` |
| `status` | string | ❌ 忽略 | **服务端强制 `pending`**，传了也不生效 |

校验规则：`title`/`body`/`images` 至少填一项，否则 `400`。

---

## 4. 进阶能力

### 4.1 传图（先传图拿 `name`，再放进 `images`）
```bash
curl -s -b cookies.txt -F "file=@/path/你的图.png" http://127.0.0.1:8800/api/upload
# 返回 {"url":"/uploads/xxx.png","name":"xxx.png"}，把 name 填进建笔记的 images 数组
```

### 4.2 标记"已发布" / "撤回"
```bash
# 已发布（移到队尾）
curl -s -b cookies.txt -X POST http://127.0.0.1:8800/api/notes/<id>/publish
# 撤回（回到待发布）
curl -s -b cookies.txt -X POST http://127.0.0.1:8800/api/notes/<id>/revert
```

### 4.3 改用途 / 闲鱼宝贝字段
建笔记或 `PUT /api/notes/<id>` 时给 `meta` 传：
```json
{ "purpose": "idlefish", "价格": "128", "成色": "9成新", "发货地": "广州" }
```
用途决定手机端归到哪类、显示哪个复制按钮（小红书 vs 闲鱼）。

### 4.4 标成 `drafted`（草稿态）——仅当确需严格"草稿状态"
默认待发布(pending)已足够当草稿。若下游流程要求 `drafted` 状态，需用 **auto-token**：
```bash
# 1) 拿 token（需登录）
TOKEN=$(curl -s -b cookies.txt http://127.0.0.1:8800/api/auto/token | sed 's/.*"token":"\([^"]*\)".*/\1/')
# 2) 把已有笔记 id 标成 drafted（token 免登录）
curl -s "http://127.0.0.1:8800/api/auto/notes/<id>/drafted?token=$TOKEN"
```

### 4.5 删除测试/误建笔记
```bash
curl -s -b cookies.txt -X DELETE http://127.0.0.1:8800/api/notes/<id>
```

---

## 5. 常见坑（务必看）

- **不要在命令行直接写中文 JSON**：Windows Git Bash 会把中文编码弄坏返回 `400`。**把 JSON 写进 UTF-8 文件，用 `--data-binary @file.json`**。（已验证必踩）
- **必须带 `-c cookies.txt` / `-b cookies.txt`**：`/api/notes` 全走登录态，没 cookie 返回 `401`。
- **`status` 字段传了也没用**：建出来永远是 `pending`，别试图直接建 `drafted`。
- **服务没起** → 连不上/502：先确认电脑上 XHS-Server 窗口在（`curl http://127.0.0.1:8800/app` 能通）。
- **改过密码**：用实际密码，别默认 `888888`。

---

## 6. 给"另一个 Claude 项目"的一句话用法（可直接粘贴给它）

> 你要往**小红书笔记发布工具**写推广文案并自动存为草稿。它是一台在本机跑着的 Flask 服务（`http://127.0.0.1:8800`，公网 `https://xhs.zhuanlu.xyz`），通用登录密码 `888888`。流程：
> 1) 登录拿 session：`curl -s -c ck.txt -d "password=888888" http://127.0.0.1:8800/login`（302 即成功）；
> 2) 把文案写成 UTF-8 JSON 文件（至少 `title`/`body`；`tags` 逗号分隔自动加 `#`），`curl -s -b ck.txt --data-binary @body.json -H "Content-Type: application/json" http://127.0.0.1:8800/api/notes`；
> 3) 返回 `201` 即成功，笔记落在**待发布**，`curl -s -b ck.txt http://127.0.0.1:8800/api/notes` 可复核。
> 
> **按目标平台选 `meta.purpose`**：发**小红书** → `"purpose":"xhs"`；发**闲鱼** → `"purpose":"idlefish"` 并在 `meta` 再填宝贝字段（如 `价格`/`成色`/`发货地`）；两平台都发同一稿 → `"purpose":"common"`（两个复制按钮都显示）。手机端会自动按这些分类、并按用途显示对应复制按钮。详情见本手册《API使用手册.md》。