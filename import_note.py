# -*- coding: utf-8 -*-
"""
从「小红书自动产线」markdown 稿子导入到笔记发布工具。
用法：
    python import_note.py <稿子.md路径> [--base http://127.0.0.1:8800] [--password 888888]

解析规则（与产线稿子格式对应）：
- 标题：frontmatter 的 title 字段
- 正文：frontmatter 之后、分隔线"---"之前的内容（去掉首行 # 标题）
- 标签：正文末尾"#xx #yy"那行
- 配图：![[images/xxx.png]] 指向的图片文件（相对稿子所在目录）
"""
import argparse
import os
import re
import sys
import urllib.request
import urllib.parse
import json


def parse_md(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()

    # frontmatter
    fm = {}
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            mm = re.match(r"^(\w+):\s*(.*)", line)
            if mm:
                fm[mm.group(1)] = mm.group(2).strip()
        text = text[m.end():]

    # 标题
    title = fm.get("title", "").strip()
    m = re.search(r"^#\s+(.+)$", text, re.M)
    if m and not title:
        title = m.group(1).strip()

    # 正文：从第一个非空行到"## 配图"或"---"分隔
    body_lines = []
    for line in text.splitlines():
        if line.strip().startswith("## 🖼️") or line.strip() == "---":
            if body_lines:
                break
            continue
        body_lines.append(line)
    # 去掉开头的空行和 H1 标题行（# xxx）
    while body_lines and (not body_lines[0].strip() or re.match(r"^#\s", body_lines[0])):
        body_lines.pop(0)
    body = "\n".join(body_lines).strip()

    # 标签：#打工人 #AI工具 ...（在全文中找一行全是 #x #y 的标签行，避免误匹配 # 标题）
    tags = ""
    m = re.search(r"^([#＃]\S+(?:\s+[#＃]\S+)+)$", text, re.M)
    if m:
        tags = m.group(1).replace("#", ",").replace("＃", ",").replace(" ", "")
        tags = ",".join(t for t in tags.split(",") if t)

    # 配图：1) 正文里 ![[images/xxx.png|500]] 引用的（去掉 |500 后缀）
    #        2) 无引用时，按"标题前缀"匹配 images/ 下同名图（产线图生成了但稿子没嵌入的情况）
    images = []
    seen = set()
    for m in re.finditer(r"!\[\[(images/[^\]]+)\]\]", text):
        rel = m.group(1).split("|")[0]
        fp = os.path.join(os.path.dirname(path), rel)
        if os.path.exists(fp):
            images.append(fp)
            seen.add(os.path.abspath(fp))
    img_dir = os.path.join(os.path.dirname(path), "images")
    if os.path.isdir(img_dir):
        prefix = title
        for fn in sorted(os.listdir(img_dir)):
            if fn.startswith(prefix) and fn.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                fp = os.path.join(img_dir, fn)
                if os.path.abspath(fp) not in seen:
                    images.append(fp)
                    seen.add(os.path.abspath(fp))
    return title, body, tags, images


def api(base, session, method, path, data=None, files=None, json_body=None):
    url = base + path
    req = urllib.request.Request(url, method=method)
    if session:
        req.add_header("Cookie", "session=" + session)
    if files:
        boundary = "----xhs" + os.urandom(8).hex()
        req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
        parts = []
        for k, fp in files.items():
            with open(fp, "rb") as f:
                parts.append(
                    f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; '
                    f'filename="x.png"\r\n\r\n'.encode() + f.read() + b"\r\n"
                )
        parts.append(f"--{boundary}--\r\n".encode())
        req.data = b"".join(parts)
    elif json_body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
    elif data:
        req.data = urllib.parse.urlencode(data).encode()
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("md", help="产线稿子 .md 路径")
    ap.add_argument("--base", default="http://127.0.0.1:8800")
    ap.add_argument("--password", default="888888")
    args = ap.parse_args()

    title, body, tags, images = parse_md(args.md)
    print(f"标题 : {title}")
    print(f"标签 : {tags}")
    print(f"配图 : {len(images)} 张")
    print(f"正文 : {len(body)} 字")

    # 登录（用 cookie jar 拿 session）
    import http.cookiejar
    req = urllib.request.Request(args.base + "/login", method="POST",
                                 data=urllib.parse.urlencode({"password": args.password}).encode())
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    with opener.open(req) as r:
        r.read()
    session_value = None
    for c in cj:
        if c.name in ("session", "session_id", "flask"):
            session_value = c.value
    if not session_value:
        print("❌ 登录失败，请检查密码"); sys.exit(1)

    # 上传图片
    filenames = []
    for i, fp in enumerate(images):
        up = api(args.base, session_value, "POST", "/api/upload", files={"file": fp})
        filenames.append(up["name"])
        print(f"  上传 {i+1}/{len(images)}: {up['name']}")

    # 创建笔记
    note = api(args.base, session_value, "POST", "/api/notes", json_body={
        "title": title, "body": body, "tags": tags,
        "images": filenames, "cover": filenames[0] if filenames else "",
    })
    print(f"✅ 已导入笔记 id={note['note']['id']}：{note['note']['title']}")
    print("手机端查看: https://xhs.zhuanlu.xyz/m")


if __name__ == "__main__":
    main()