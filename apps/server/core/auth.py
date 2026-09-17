# -*- coding: utf-8 -*-
"""用户认证：sqlite3 存用户，PBKDF2 哈希密码，HMAC 签名令牌（仅用标准库）。"""
import base64
import hashlib
import hmac
import os
import re
import sqlite3
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "app.db"

TOKEN_TTL = 30 * 24 * 3600  # 令牌有效期：30 天
PBKDF2_ROUNDS = 100_000

USERNAME_RE = re.compile(r"^[\w一-鿿]{2,32}$")


def init_db():
    """启动时自动建表；老库通过 PRAGMA table_info 轻量迁移补 openid 列。"""
    DB_PATH.parent.mkdir(exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "username TEXT UNIQUE NOT NULL,"
            "password_hash TEXT NOT NULL,"
            "salt TEXT NOT NULL,"
            "created_at TEXT NOT NULL)")
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)")]
        if "openid" not in cols:
            # SQLite 的 ALTER TABLE 不能直接加 UNIQUE 列，改用唯一索引；
            # 唯一索引允许多个 NULL，正好满足"可空唯一"。
            conn.execute("ALTER TABLE users ADD COLUMN openid TEXT")
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid"
                " ON users(openid)")


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"),
        bytes.fromhex(salt), PBKDF2_ROUNDS).hex()


def create_user(username: str, password: str) -> bool:
    """注册新用户，用户名已存在返回 False。"""
    salt = os.urandom(16).hex()
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO users (username, password_hash, salt, created_at)"
                " VALUES (?, ?, ?, ?)",
                (username, _hash_password(password, salt), salt,
                 time.strftime("%Y-%m-%dT%H:%M:%S")))
        return True
    except sqlite3.IntegrityError:
        return False


def check_user(username: str, password: str) -> bool:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT password_hash, salt FROM users WHERE username = ?",
            (username,)).fetchone()
    if not row or not row[0]:
        # 无密码用户（微信登录创建，password_hash 为空串）拒绝密码登录
        return False
    return hmac.compare_digest(row[0], _hash_password(password, row[1]))


def find_user_by_openid(openid: str) -> str | None:
    """按微信 openid 查用户，存在返回 username，否则 None。"""
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT username FROM users WHERE openid = ?",
            (openid,)).fetchone()
    return row[0] if row else None


def create_wechat_user(openid: str) -> str:
    """为微信 openid 创建无密码用户，返回用户名。

    用户名取 wx_ + openid 前 8 位，冲突时追加序号；
    并发下若 openid 已被抢先插入，直接返回已存在的用户名。
    """
    base = "wx_" + openid[:8]
    username = base
    n = 1
    while True:
        try:
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    "INSERT INTO users"
                    " (username, password_hash, salt, created_at, openid)"
                    " VALUES (?, '', '', ?, ?)",
                    (username, time.strftime("%Y-%m-%dT%H:%M:%S"), openid))
            return username
        except sqlite3.IntegrityError:
            existing = find_user_by_openid(openid)
            if existing:
                return existing
            n += 1
            username = f"{base}{n}"


def make_token(username: str, secret: str) -> str:
    """token = base64(username|expiry) + HMAC-SHA256 签名。"""
    payload = base64.urlsafe_b64encode(
        f"{username}|{int(time.time()) + TOKEN_TTL}".encode("utf-8")
    ).decode("ascii")
    sig = hmac.new(secret.encode("utf-8"), payload.encode("ascii"),
                   hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_token(token: str, secret: str) -> str | None:
    """校验签名与过期时间，通过返回 username，否则 None。"""
    try:
        payload, sig = token.split(".", 1)
    except ValueError:
        return None
    try:
        expect = hmac.new(secret.encode("utf-8"), payload.encode("ascii"),
                          hashlib.sha256).hexdigest()
    except UnicodeEncodeError:
        # payload 含非 ASCII 字符，必为伪造 token
        return None
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        username, expiry = base64.urlsafe_b64decode(
            payload.encode("ascii")).decode("utf-8").rsplit("|", 1)
        if int(expiry) < time.time():
            return None
        return username
    except Exception:
        return None
