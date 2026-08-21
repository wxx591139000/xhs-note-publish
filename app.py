# -*- coding: utf-8 -*-
"""
小红书笔记发布工具 (XHS Note Publisher)
======================================
电脑端管理素材（标题/正文/标签/封面/多图）→ 云端同步 → 手机端固定网站预览、一键复制、手动发布。

技术栈：Flask + SQLite + 原生前端（无外部 CDN 依赖，内网/隧道均可离线使用）。
"""
import io
import json
import os
import sqlite3
import time
import uuid
from functools import wraps

import qrcode
from flask import (
    Flask, render_template, request, redirect, url_for, session,
    send_from_directory, jsonify, Response, send_file,
)

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "notes.db")
os.makedirs(UPLOAD_DIR, exist_ok=True)

DEFAULT_PORT = 8800
DEFAULT_PASSWORD = "888888"          # 首次运行默认密码，登录后可在桌面端修改
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic"}
MAX_UPLOAD_MB = 10

app = Flask(__name__)
app.secret_key = os.environ.get("XHS_SECRET", "xhs-note-publish-" + uuid.uuid4().hex)
# 限制上传体积
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024


# ---------------------------------------------------------------------------
# 数据库
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT NOT NULL DEFAULT '',
            body       TEXT NOT NULL DEFAULT '',
            tags       TEXT NOT NULL DEFAULT '',      -- 逗号分隔，如 "AI工具,效率,干货"
            cover      TEXT NOT NULL DEFAULT '',       -- images 数组中作为封面的文件名
            images     TEXT NOT NULL DEFAULT '[]',     -- JSON 数组，文件名列表
            meta       TEXT NOT NULL DEFAULT '{}',     -- JSON dict，闲鱼宝贝字段(价格/成色/发货地等)
            status     TEXT NOT NULL DEFAULT 'pending',-- pending / published
            position   INTEGER NOT NULL DEFAULT 0,      -- 排序序号
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        """
    )
    # 迁移：旧库 notes 表补 meta 列（闲鱼宝贝字段），新库已在 CREATE 里带上
    cols = [r[1] for r in conn.execute("PRAGMA table_info(notes)").fetchall()]
    if "meta" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'")
    # 默认密码
    conn.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES('password', ?)",
        (DEFAULT_PASSWORD,),
    )
    conn.commit()
    conn.close()


def get_setting(key, default=None):
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key, value):
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)", (key, value)
    )
    conn.commit()
    conn.close()


def next_position():
    conn = get_db()
    row = conn.execute("SELECT COALESCE(MAX(position),0)+1 AS p FROM notes").fetchone()
    conn.close()
    return row["p"]


def ensure_auto_token():
    """自动化脚本用的免登录凭据（token），首次调用时生成。"""
    t = get_setting("auto_token")
    if not t:
        t = uuid.uuid4().hex
        set_setting("auto_token", t)
    return t


def note_to_dict(row):
    d = dict(row)
    d["images"] = json.loads(d["images"] or "[]")
    try:
        d["meta"] = json.loads(d.get("meta") or "{}")
    except Exception:
        d["meta"] = {}
    # 用途标记：xhs(小红书) / idlefish(闲鱼) / common(通用，含历史未标记笔记)
    d["meta"].setdefault("purpose", "common")
    d["tags_list"] = [t.strip() for t in (d["tags"] or "").split(",") if t.strip()]
    return d


# ---------------------------------------------------------------------------
# 认证
# ---------------------------------------------------------------------------
def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("ok"):
            # API 请求返回 401，页面请求跳登录
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("login", next=request.full_path))
        return fn(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# 页面
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return redirect(url_for("login") if not session.get("ok") else url_for("desktop"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        pw = request.form.get("password", "")
        if pw == get_setting("password", DEFAULT_PASSWORD):
            session["ok"] = True
            nxt = request.args.get("next") or url_for("desktop")
            return redirect(nxt)
        return render_template("login.html", error="密码错误，请重试", next=request.args.get("next"))
    return render_template("login.html", error=None, next=request.args.get("next"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/app")
@require_auth
def desktop():
    return render_template("desktop.html")


@app.route("/m")
def mobile_login():
    """手机端：未登录则显示密码门，已登录显示发布页。"""
    if not session.get("ok"):
        return render_template("login.html", error=None, next="/m")
    return render_template("mobile.html")


# ---------------------------------------------------------------------------
# 笔记 API
# ---------------------------------------------------------------------------
@app.route("/api/notes", methods=["GET"])
@require_auth
def list_notes():
    conn = get_db()
    rows = conn.execute(
        """SELECT * FROM notes
           ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'drafted' THEN 1 ELSE 2 END,
                    position, id"""
    ).fetchall()
    conn.close()
    return jsonify({"notes": [note_to_dict(r) for r in rows], "password": get_setting("password")})


@app.route("/api/notes", methods=["POST"])
@require_auth
def create_note():
    data = request.get_json(force=True) or {}
    now = int(time.time())
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO notes(title, body, tags, cover, images, meta, status, position, created_at, updated_at)
           VALUES(?,?,?,?,?,?, 'pending', ?, ?, ?)""",
        (
            (data.get("title") or "").strip(),
            data.get("body") or "",
            (data.get("tags") or "").strip(),
            data.get("cover") or "",
            json.dumps(data.get("images") or [], ensure_ascii=False),
            json.dumps(data.get("meta") or {}, ensure_ascii=False),
            next_position(),
            now, now,
        ),
    )
    conn.commit()
    rid = cur.lastrowid
    row = conn.execute("SELECT * FROM notes WHERE id=?", (rid,)).fetchone()
    conn.close()
    return jsonify({"note": note_to_dict(row)}), 201


@app.route("/api/notes/<int:nid>", methods=["PUT"])
@require_auth
def update_note(nid):
    data = request.get_json(force=True) or {}
    now = int(time.time())
    conn = get_db()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    conn.execute(
        """UPDATE notes SET title=?, body=?, tags=?, cover=?, images=?, meta=?, updated_at=?
           WHERE id=?""",
        (
            (data.get("title") or "").strip(),
            data.get("body") or "",
            (data.get("tags") or "").strip(),
            data.get("cover") or "",
            json.dumps(data.get("images") or [], ensure_ascii=False),
            json.dumps(data.get("meta") or {}, ensure_ascii=False),
            now, nid,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    conn.close()
    return jsonify({"note": note_to_dict(row)})


@app.route("/api/notes/<int:nid>", methods=["DELETE"])
@require_auth
def delete_note(nid):
    conn = get_db()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    conn.execute("DELETE FROM notes WHERE id=?", (nid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/notes/<int:nid>/publish", methods=["POST"])
@require_auth
def publish_note(nid):
    """标记已发布 → 移到队列末尾（原工具：已发布笔记自动跳转到队列末尾）。"""
    conn = get_db()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    now = int(time.time())
    last = conn.execute("SELECT COALESCE(MAX(position),0) AS p FROM notes").fetchone()["p"]
    conn.execute(
        "UPDATE notes SET status='published', position=?, updated_at=? WHERE id=?",
        (last + 1, now, nid),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/notes/<int:nid>/revert", methods=["POST"])
@require_auth
def revert_note(nid):
    """取消已发布 → 回到待发布状态。"""
    conn = get_db()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    now = int(time.time())
    conn.execute(
        "UPDATE notes SET status='pending', position=?, updated_at=? WHERE id=?",
        (next_position(), now, nid),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# 图片上传 / 访问
# ---------------------------------------------------------------------------
@app.route("/api/upload", methods=["POST"])
@require_auth
def upload():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "no file"}), 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({"error": f"不支持的格式：{ext or '未知'}"}), 400
    name = uuid.uuid4().hex + ext
    file.save(os.path.join(UPLOAD_DIR, name))
    return jsonify({"url": f"/uploads/{name}", "name": name})


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/settings", methods=["PUT"])
@require_auth
def update_settings():
    data = request.get_json(force=True) or {}
    if "password" in data:
        new_pw = str(data["password"])
        if len(new_pw) < 4:
            return jsonify({"error": "密码至少 4 位"}), 400
        set_setting("password", new_pw)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# 自动化（AutoX.js 脚本调用，用 token 免登录）
# ---------------------------------------------------------------------------
def _check_token():
    token = request.args.get("token", "")
    return token and token == get_setting("auto_token", "")


@app.route("/api/auto/token", methods=["GET", "POST"])
@require_auth
def auto_token():
    if request.method == "POST":
        data = request.get_json(force=True) or {}
        if data.get("regenerate"):
            set_setting("auto_token", uuid.uuid4().hex)
    return jsonify({"token": ensure_auto_token(), "base_url": request.host_url.rstrip("/")})


@app.route("/api/auto/notes")
def auto_notes():
    """自动化脚本拉取待发布(pending)笔记。token 校验，无需登录。"""
    if not _check_token():
        return jsonify({"error": "forbidden"}), 403
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM notes WHERE status='pending' ORDER BY position, id"
    ).fetchall()
    conn.close()
    return jsonify({"notes": [note_to_dict(r) for r in rows]})


@app.route("/api/auto/notes/<int:nid>/drafted", methods=["POST"])
def auto_drafted(nid):
    """自动化脚本填好草稿后，把笔记标记为 drafted（草稿已填，待人工发布）。"""
    if not _check_token():
        return jsonify({"error": "forbidden"}), 403
    conn = get_db()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    conn.execute(
        "UPDATE notes SET status='drafted', updated_at=? WHERE id=?",
        (int(time.time()), nid),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# 二维码
# ---------------------------------------------------------------------------
@app.route("/api/qr")
@require_auth
def qr():
    """生成手机访问地址的二维码。根据请求 HOST 自动推断外网地址。"""
    host = request.host
    # 若通过隧道访问，host 已是公网域名；否则用本机局域网 IP
    if "localhost" in host or "127.0.0.1" in host or ":" in host and (host.startswith("192.168") or host.startswith("10.")):
        host = os.environ.get("XHS_PUBLIC_URL") or host
    url = f"{request.scheme}://{host}/m"
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


@app.route("/favicon.ico")
def favicon():
    return Response(status=204)


@app.route("/xhs_auto.js")
def serve_auto_script():
    """把 AutoX.js 脚本以纯文本返回，方便手机直接下载到本地。"""
    return send_from_directory(BASE_DIR, "xhs_auto.js", mimetype="text/plain")


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("XHS_PORT", DEFAULT_PORT))
    print("=" * 56)
    print("  小红书笔记发布工具 已启动")
    print(f"  电脑端管理:  http://127.0.0.1:{port}/app")
    print(f"  手机端发布:  http://127.0.0.1:{port}/m")
    print(f"  默认密码:    {get_setting('password')}")
    print("=" * 56)
    app.run(host="0.0.0.0", port=port, debug=False)