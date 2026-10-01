#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把「发布态」md 写入小红书笔记发布工具（xhs-note-publish）。

用法:
    python import_publish_ready.py <md文件> [...] [--dry-run]

做什么:
    1. 解析 frontmatter (title / kind / images / tags / digest / 其余键进 meta)
    2. 登录拿 session cookie
    3. 逐张上传配图 -> 拿 name
    4. POST /api/notes 建笔记（服务端强制 status=pending）
    5. 自动复核（GET /api/notes 找最新一条，核对 status / purpose / images 数）

★ 三个已踩过的坑，这里都绕开了:
    - 中文 JSON 绝不走命令行/curl -> 全程 Python，json.dumps(ensure_ascii=False).encode('utf-8')
    - 本机 127.0.0.1 被系统代理拦截报 502 -> ProxyHandler({}) 显式绕开代理
    - 导入不幂等 -> 本工具只负责「建」，改已有笔记要走 PUT /api/notes/<id>
"""
import io
import json
import os
import sys
import urllib.request
import urllib.parse
import http.cookiejar
import mimetypes
import uuid

BASE = os.environ.get("XHS_BASE", "http://127.0.0.1:8800")
PASSWORD = os.environ.get("XHS_PASSWORD", "888888")


def opener():
    cj = http.cookiejar.CookieJar()
    # ★ 显式清空代理，否则本机 127.0.0.1 会走系统代理返回 502
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPCookieProcessor(cj),
    )


def parse_md(path):
    raw = io.open(path, encoding="utf-8").read()
    if raw.startswith("\ufeff"):
        raw = raw[1:]
    fm, body = {}, raw
    if raw.startswith("---"):
        end = raw.find("\n---", 3)
        if end != -1:
            block = raw[3:end].strip("\n")
            body = raw[end + 4:].lstrip("\n")
            for line in block.split("\n"):
                if ":" not in line:
                    continue
                k, _, v = line.partition(":")
                fm[k.strip()] = v.strip()
    return fm, body


def login(op):
    data = urllib.parse.urlencode({"password": PASSWORD}).encode("utf-8")
    req = urllib.request.Request(BASE + "/login", data=data)
    with op.open(req, timeout=20) as r:
        r.read()
    return True


def upload(op, path):
    boundary = "----xhsimport" + uuid.uuid4().hex
    fname = os.path.basename(path)
    ctype = mimetypes.guess_type(fname)[0] or "application/octet-stream"
    raw = io.open(path, "rb").read()
    buf = io.BytesIO()
    buf.write(("--%s\r\n" % boundary).encode())
    buf.write(('Content-Disposition: form-data; name="file"; filename="%s"\r\n' % fname).encode("utf-8"))
    buf.write(("Content-Type: %s\r\n\r\n" % ctype).encode())
    buf.write(raw)
    buf.write(("\r\n--%s--\r\n" % boundary).encode())
    req = urllib.request.Request(BASE + "/api/upload", data=buf.getvalue())
    req.add_header("Content-Type", "multipart/form-data; boundary=%s" % boundary)
    with op.open(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def create_note(op, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(BASE + "/api/notes", data=data)
    req.add_header("Content-Type", "application/json")
    with op.open(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def list_notes(op):
    with op.open(BASE + "/api/notes", timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


RESERVED = {"title", "kind", "images", "tags", "digest"}


def run(md_path, dry):
    fm, body = parse_md(md_path)
    base = os.path.dirname(os.path.abspath(md_path))
    images = [x.strip() for x in fm.get("images", "").split(",") if x.strip()]
    kind = fm.get("kind", "gzh")

    meta = {"purpose": kind}
    for k, v in fm.items():
        if k not in RESERVED and v:
            meta[k] = v
    if fm.get("digest"):
        meta["digest"] = fm["digest"]

    print("文件      %s" % os.path.basename(md_path))
    print("标题      %s" % fm.get("title"))
    print("kind      %s -> meta.purpose" % kind)
    print("配图      %d 张" % len(images))
    print("正文      %d 字" % len(body.strip()))
    print("meta      %s" % json.dumps(meta, ensure_ascii=False))

    missing = [p for p in images if not os.path.isfile(os.path.join(base, p))]
    if missing:
        print("❌ 配图缺失，终止: %s" % missing)
        return 2

    if dry:
        print("--dry-run，不写入。")
        return 0

    op = opener()
    login(op)
    print("✅ 已登录")

    names = []
    for p in images:
        fp = os.path.join(base, p)
        res = upload(op, fp)
        names.append(res["name"])
        print("   上传 %-24s -> %s" % (p, res.get("name")))

    payload = {
        "title": fm.get("title", ""),
        "body": body,
        "tags": fm.get("tags", ""),
        "images": names,
        "cover": names[0] if names else "",
        "meta": meta,
    }
    created = create_note(op, payload)
    # ★ 实测返回体是 {"note": {...}} 嵌套结构（app.py create_note -> jsonify({"note": ...}), 201）
    note = created.get("note", created)
    nid = note.get("id")
    print("✅ 已写入笔记 id=%s status=%s" % (nid, note.get("status")))

    # ---- 复核 ----
    notes = list_notes(op)
    arr = notes if isinstance(notes, list) else notes.get("notes", [])
    hit = None
    for n in arr:
        if str(n.get("id")) == str(nid):
            hit = n
            break
    if not hit:
        print("⚠️ 复核失败，列表里找不到 id=%s" % nid)
        return 3
    m = hit.get("meta")
    if isinstance(m, str):
        try:
            m = json.loads(m)
        except Exception:
            pass
    imgs = hit.get("images")
    if isinstance(imgs, str):
        try:
            imgs = json.loads(imgs)
        except Exception:
            imgs = []
    print("---- 复核 ----")
    print("status   %s" % hit.get("status"))
    print("purpose  %s" % (m.get("purpose") if isinstance(m, dict) else m))
    print("images   %d 张" % len(imgs or []))
    print("cover    %s" % hit.get("cover"))
    ok = hit.get("status") == "pending" and isinstance(m, dict) and m.get("purpose") == kind
    print("结论     %s" % ("✅ 复核通过" if ok else "❌ 复核不符"))
    return 0 if ok else 4


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in argv
    if not args:
        print(__doc__)
        return 2
    rc = 0
    for md in args:
        rc |= run(md, dry)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
