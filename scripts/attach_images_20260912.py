# -*- coding: utf-8 -*-
"""
把 v2.0 配图挂进 xhs-note-publish 发布工具（第 6 篇文案的配图）。

做法严格复刻 app.py 的上传约定：
  - 物理目录 data/uploads/，文件名为 uuid4().hex + 扩展名（与 /api/upload 一致）
  - notes.images = JSON 数组（文件名），notes.cover = images[0]（与 create_note 一致）
  - 单文件上限 10MB（MAX_UPLOAD_MB），线上校验一遍，超了直接中止

挂载策略：每篇笔记 2 张 = 对应封面 + 通用价格页。
  价格页是信息型内图（客户关心价格），6 篇共用；封面各不相同，整体不重复。
  若不想让某篇带价格页，在桌面端把第 2 张删掉即可。

安全：写库前先用 sqlite3 的 backup API 备份；任何断言失败即中止，不写库。
"""
import sqlite3, json, os, shutil, uuid, datetime

SRC = r"E:\myClaudCodeWorkspace\transcribe-bot\docs"
PUB = r"E:\myClaudCodeWorkspace\xhs-note-publish"
UP = os.path.join(PUB, "data", "uploads")
DB = os.path.join(PUB, "data", "notes.db")
MAX_MB = 10

# 笔记 id -> (封面文件, 说明)
COVERS = {
    62: ("小红书配图1-痛点-阿白-v2.0.png", "笔记1 痛点共鸣"),
    63: ("小红书配图2-交付-阿白-v2.0.png", "笔记2 效果展示"),
    64: ("小红书配图3-三办法-阿白-v2.0.png", "笔记3 干货教程"),
    65: ("小红书配图4-网课-阿白-v2.0.png",   "笔记4 考研人群"),
    66: ("小红书配图5-避坑-阿白-v2.0.png",   "笔记5 避坑反套路"),
    67: ("小红书配图6-口播-阿白-v2.0.png",   "笔记6 口播工作流"),
}
PRICE = "小红书配图7-价格-阿白-v2.0.png"
PRICE_PER_NOTE = True   # 是否每篇都附通用价格页

# ---------- 1) 前置校验 ----------
all_src = [v[0] for v in COVERS.values()] + ([PRICE] if PRICE_PER_NOTE else [])
missing = [f for f in all_src if not os.path.isfile(os.path.join(SRC, f))]
assert not missing, f"源图缺失，中止：{missing}"
for f in all_src:
    mb = os.path.getsize(os.path.join(SRC, f)) / 1024 / 1024
    assert mb <= MAX_MB, f"{f} 超过 {MAX_MB}MB 上限（{mb:.2f}MB），工具会拒收"
print(f"[1/4] 源图校验通过：{len(all_src)} 个文件，最大 "
      f"{max(os.path.getsize(os.path.join(SRC,f)) for f in all_src)/1024:.0f} KB")

# ---------- 2) 备份数据库 ----------
os.makedirs(UP, exist_ok=True)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
bak = os.path.join(PUB, "data", "backups", f"notes.db.bak-{stamp}")
os.makedirs(os.path.dirname(bak), exist_ok=True)
src_con = sqlite3.connect(DB)
dst_con = sqlite3.connect(bak)
with dst_con:
    src_con.backup(dst_con)
dst_con.close()
print(f"[2/4] 已备份 -> {os.path.relpath(bak, PUB)} "
      f"({os.path.getsize(bak)} bytes)")

# ---------- 3) 复制图片，按工具约定命名 ----------
def place(fname):
    ext = os.path.splitext(fname)[1].lower()
    newname = uuid.uuid4().hex + ext
    shutil.copy2(os.path.join(SRC, fname), os.path.join(UP, newname))
    got = os.path.getsize(os.path.join(UP, newname))
    assert got > 0, f"{newname} 复制后为空"
    return newname

placed = {}
for nid, (fname, _) in COVERS.items():
    placed[nid] = [place(fname)]
    if PRICE_PER_NOTE:
        placed[nid].append(place(PRICE))
for nid, names in placed.items():
    for n in names:
        assert os.path.getsize(os.path.join(UP, n)) > 0
print(f"[3/4] 已复制 {sum(len(v) for v in placed.values())} 个文件到 data/uploads/")

# ---------- 4) 更新 notes ----------
cur = src_con.cursor()
before = {}
for nid in COVERS:
    r = cur.execute("SELECT images FROM notes WHERE id=?", (nid,)).fetchone()
    assert r is not None, f"id={nid} 不存在，中止"
    before[nid] = r[0]
    if r[0] and r[0] != "[]":
        print(f"      ⚠️ id={nid} 原本已有图片 {r[0]}，将被覆盖")

with src_con:
    for nid, names in placed.items():
        cur.execute("UPDATE notes SET images=?, cover=?, updated_at=datetime('now','localtime') "
                    "WHERE id=?", (json.dumps(names, ensure_ascii=False), names[0], nid))

# ---------- 校验 ----------
print("[4/4] 回读校验：")
ok = 0
for nid in sorted(COVERS):
    r = cur.execute("SELECT title, cover, images FROM notes WHERE id=?", (nid,)).fetchone()
    imgs = json.loads(r[2])
    for n in imgs:
        assert os.path.isfile(os.path.join(UP, n)), f"{n} 落盘缺失"
    assert r[1] == imgs[0], "cover 与 images[0] 不一致"
    ok += 1
    print(f"      id={nid} [{len(imgs)}图] cover={imgs[0][:12]}… | {r[0][:30]}")
src_con.close()
print(f"\n✅ 完成：{ok} 篇笔记已挂图，共 {sum(len(v) for v in placed.values())} 张")
print(f"   备份：{os.path.relpath(bak, PUB)}")
