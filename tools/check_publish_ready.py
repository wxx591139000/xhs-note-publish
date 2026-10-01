#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
发布态文案机器校验（L1 硬规则 + 平台红线 + 图位标记）

用法:
    python check_publish_ready.py <md文件> [<md文件> ...]

退出码: 0 = 全部通过, 1 = 有违规

规则来源: skill `publish-ready-to-platform` 的 L1 清单。
★ 只扫「发布内容块」(title / digest / tags / body)，不扫 frontmatter 其余键，
  也不扫 README 等交付说明 —— 否则说明区里写的「不可以放微信号」本身就会触发误报。
"""
import io
import os
import re
import sys

# ---------- L1 禁用词（AI 味 / 套路腔） ----------
BANNED_WORDS = [
    "说白了", "意味着", "本质上", "换句话说", "不可否认",
    "综上所述", "值得注意的是", "不难发现", "首先", "其次",
]

# ---------- 禁用标点 ----------
# 中文冒号 / 破折号 / 弯引号 / 英文双引号
# ⚠️ 中文直角引号「」U+300C/U+300D **合规**，故意不列
BANNED_PUNCT = {
    "\uff1a": "中文冒号（应改用逗号或拆句）",
    "\u2014\u2014": "破折号（应改用逗号或拆句）",
    "\u201c": "左弯双引号（应改用「」）",
    "\u201d": "右弯双引号（应改用「」）",
    "\u2018": "左弯单引号（应改用「」）",
    "\u2019": "右弯单引号（应改用「」）",
    '"': "英文双引号（应改用「」）",
}

# ---------- 平台红线 ----------
PLATFORM_REDLINES = [
    "微信号", "加微信", "扫码", "二维码", "加我好友",
    "淘宝", "拼多多", "抖音小店", "私信我", "点击链接",
    "http://", "https://", "www.",
]


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


def check_one(path):
    errs, warns = [], []
    fm, body = parse_md(path)
    name = os.path.basename(path)

    if not fm.get("title"):
        errs.append("缺少 title")
    if not body.strip():
        errs.append("正文为空")

    kind = fm.get("kind", "")
    if kind not in ("xhs", "idlefish", "gzh", "common"):
        errs.append("kind 非法或缺失: %r（应为 xhs/idlefish/gzh/common）" % kind)
    if kind == "gzh" and not fm.get("digest"):
        warns.append("gzh 稿建议填 digest（摘要），手机端才有「复制摘要」按钮")

    raw_images = fm.get("images", "")
    images = [x.strip() for x in raw_images.split(",") if x.strip()] if raw_images else []

    # ---- 扫描范围：title / digest / tags / body ----
    scan = {
        "title": fm.get("title", ""),
        "digest": fm.get("digest", ""),
        "tags": fm.get("tags", ""),
        "body": body,
    }

    # 1) 禁用词
    for where, text in scan.items():
        for w in BANNED_WORDS:
            if w in text:
                errs.append("[禁用词] %s 出现 %r" % (where, w))

    # 2) 禁用标点
    for where, text in scan.items():
        for ch, why in BANNED_PUNCT.items():
            if ch in text:
                idx = text.find(ch)
                ctx = text[max(0, idx - 18):idx + 18].replace("\n", " ")
                errs.append("[禁用标点] %s 出现 %r（%s）…%s…" % (where, ch, why, ctx))

    # 3) 平台红线（tags 是平台自定义标签，允许平台名出现，故不扫）
    for where in ("title", "digest", "body"):
        for w in PLATFORM_REDLINES:
            if w.lower() in scan[where].lower():
                errs.append("[平台红线] %s 出现 %r" % (where, w))

    # 4) 正文禁小标题（Markdown # / 加粗小标题 / 列表符号）
    for i, line in enumerate(body.split("\n"), 1):
        s = line.strip()
        if re.match(r"^#{1,6}\s", s):
            errs.append("[正文小标题] 第 %d 行以 # 开头: %s" % (i, s[:36]))
        if re.match(r"^\*\*[^*]+\*\*\s*$", s):
            warn_line = s[:36]
            warns.append("[疑似小标题] 第 %d 行整行加粗: %s" % (i, warn_line))

    # 5) 图位标记
    slots = re.findall(r"\[\[(?:图|图片)\s*(\d+)(?:\|[^\]]*)?\]\]", body)
    slots = [int(x) for x in slots]
    if slots:
        if not images:
            errs.append("[图位] 正文有 %d 个图位标记，但 frontmatter 没写 images" % len(slots))
        else:
            n_img = len(images)
            for n in sorted(set(slots)):
                if n < 1 or n > n_img:
                    errs.append("[图位] [[图%d]] 越界，images 只有 %d 张" % (n, n_img))
            if 1 in slots:
                warns.append("[图位] [[图1]] 即封面，正文里写了会提示「已作为封面显示在上方」，可删")
            used = set(slots) - {1}
            missing = [n for n in range(2, n_img + 1) if n not in used]
            if missing:
                warns.append("[图位] 第 %s 张未被正文引用，预览会走末尾兜底"
                             % "、".join(str(m) for m in missing))
    elif images:
        warns.append("[图位] 有 %d 张配图但正文没有任何图位标记，全部走末尾兜底" % len(images))

    # 6) 配图存在性
    base = os.path.dirname(os.path.abspath(path))
    for p in images:
        fp = os.path.join(base, p)
        if not os.path.isfile(fp):
            errs.append("[配图缺失] %s" % p)

    # 7) 标题长度
    if len(fm.get("title", "")) > 30:
        warns.append("标题 %d 字，公众号建议 30 字内更抓眼" % len(fm.get("title", "")))

    return name, len(body.strip()), len(images), errs, warns


def main(argv):
    files = argv[1:]
    if not files:
        print(__doc__)
        return 2

    total_err = 0
    for f in files:
        name, blen, nimg, errs, warns = check_one(f)
        print("=" * 68)
        print(" %s" % name)
        print(" 正文 %d 字 | 配图 %d 张" % (blen, nimg))
        print("=" * 68)
        if errs:
            print(" ❌ 违规 %d 项" % len(errs))
            for e in errs:
                print("    - " + e)
        else:
            print(" ✅ L1 硬规则 + 平台红线 全部通过")
        if warns:
            print(" ⚠️  提示 %d 项（不阻断）" % len(warns))
            for w in warns:
                print("    - " + w)
        print()
        total_err += len(errs)

    print("总计违规 = %d" % total_err)
    return 1 if total_err else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
