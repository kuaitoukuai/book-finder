# -*- coding: utf-8 -*-
"""微信扫码登录：票据生命周期 + 微信服务端接口封装。

票据流程（5 分钟过期、一次性）：
  pending → confirmed（小程序确认）→ consumed（浏览器轮询领取）
          → cancelled（用户在小程序里点"不是我操作的"）

微信接口封装两个能力：
  - get_access_token / get_wxa_code_unlimited  —— 生成带 scene 的小程序码
  - code2session                                —— 用 js_code 换 openid

本地联调可用环境变量 BOOKFINDER_MOCK_WX=true 跳过微信接口：
qr 返回占位二维码（SVG data URL），confirm 接受任意 code（mock 前缀）。
"""
import base64
import logging
import os
import re
import secrets
import sqlite3
import threading
import time

import requests

from core import auth

logger = logging.getLogger("bookfinder.scan_login")

DB_PATH = auth.DB_PATH

TICKET_TTL = 5 * 60          # 票据有效期 5 分钟（与微信官方扫码登录同量级）
TICKET_RE = re.compile(r"^[a-f0-9]{32}$")

MOCK_ENABLED = (os.environ.get("BOOKFINDER_MOCK_WX") or "").strip().lower() \
    in ("1", "true", "yes")

# 扫码后进入的小程序页面（不带前导斜杠，与 app.json 中的路径一致）
WECHAT_LOGIN_PAGE = "pages/wechat-login/index"

_TOKEN_TTL_S = 7200          # 微信 access_token 有效期（秒，微信侧固定）
_TOKEN_SAFETY_S = 300        # 提前 5 分钟视为过期
# access_token 失效类错误码：清缓存重试一次即可恢复
_TOKEN_INVALID_CODES = (40001, 40014, 42001)

_token_lock = threading.Lock()
_token_cache = {"value": "", "expires_at": 0.0}


def init_db():
    """启动时自动建表（与 core/auth.py 的 init_db 做法一致）。"""
    DB_PATH.parent.mkdir(exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS login_tickets ("
            "ticket TEXT PRIMARY KEY,"
            "status TEXT NOT NULL DEFAULT 'pending',"
            "openid TEXT NOT NULL DEFAULT '',"
            "username TEXT NOT NULL DEFAULT '',"
            "created_at REAL NOT NULL,"
            "expires_at REAL NOT NULL)")


def _purge_expired() -> None:
    """每次生成新票时顺手清理过期票据，避免表无限增长。"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM login_tickets WHERE expires_at < ?",
                     (time.time() - 60,))


def create_ticket() -> str:
    """生成 16 字节随机票据（32 位小写 hex，恰好是小程序码 scene 上限）。"""
    ticket = secrets.token_hex(16)
    now = time.time()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO login_tickets"
            " (ticket, status, created_at, expires_at) VALUES (?, 'pending', ?, ?)",
            (ticket, now, now + TICKET_TTL))
    _purge_expired()
    return ticket


def get_ticket(ticket: str) -> dict | None:
    """查票据（不区分过期/不存在，由调用方判定）。"""
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT ticket, status, openid, username, created_at, expires_at"
            " FROM login_tickets WHERE ticket = ?",
            (ticket,)).fetchone()
    if not row:
        return None
    return {"ticket": row[0], "status": row[1], "openid": row[2],
            "username": row[3], "created_at": row[4], "expires_at": row[5]}


def confirm_ticket(ticket: str, openid: str, username: str) -> bool:
    """带状态条件的更新：pending/scanned → confirmed 并写入用户名。

    两台手机同时扫同一张码时，只有先到的那次能改成功（靠影响行数判定，
    而不是"先查后改"，后者并发下会双重放行）。
    """
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "UPDATE login_tickets SET status = 'confirmed',"
            " openid = ?, username = ?"
            " WHERE ticket = ? AND status IN ('pending', 'scanned')",
            (openid, username, ticket))
        return cur.rowcount > 0


def claim_confirmed_ticket(ticket: str) -> str | None:
    """抢占式消费：confirmed → consumed，成功时返回用户名，否则 None。

    两个标签页同时轮询同一张票时只有一个能拿到令牌。
    """
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "UPDATE login_tickets SET status = 'consumed'"
            " WHERE ticket = ? AND status = 'confirmed'",
            (ticket,))
        if cur.rowcount == 0:
            return None
        row = conn.execute(
            "SELECT username FROM login_tickets WHERE ticket = ?",
            (ticket,)).fetchone()
    return row[0] if row and row[0] else None


def cancel_ticket(ticket: str) -> bool:
    """作废票据：只有 pending/scanned 的票还能取消，已确认/已消费的不行。"""
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "UPDATE login_tickets SET status = 'cancelled'"
            " WHERE ticket = ? AND status IN ('pending', 'scanned')",
            (ticket,))
        return cur.rowcount > 0


# ---- 微信服务端接口 ----

def get_access_token(appid: str, secret: str) -> str:
    """取 access_token（进程内缓存 + 锁内去重，避免并发重复获取）。

    用 stable_token 而非老的 cgi-bin/token：后者每次调用都签发新 token 并
    使旧 token 立即失效；stable_token（force_refresh=false）在有效期内重复
    调用返回同一个值，这才是能安全缓存的前提。
    """
    with _token_lock:
        if _token_cache["value"] and \
                _token_cache["expires_at"] > time.time():
            return _token_cache["value"]
        resp = requests.post(
            "https://api.weixin.qq.com/cgi-bin/stable_token",
            json={"grant_type": "client_credential", "appid": appid,
                  "secret": secret, "force_refresh": False},
            timeout=10)
        try:
            data = resp.json()
        except ValueError:
            raise RuntimeError(f"微信 access_token 接口返回异常（HTTP {resp.status_code}）")
        token = data.get("access_token")
        if not token:
            raise RuntimeError(
                f"获取微信 access_token 失败: {data.get('errcode')} {data.get('errmsg')}")
        _token_cache["value"] = token
        _token_cache["expires_at"] = time.time() + _TOKEN_TTL_S - _TOKEN_SAFETY_S
        return token


def _invalidate_access_token() -> None:
    with _token_lock:
        _token_cache["value"] = ""
        _token_cache["expires_at"] = 0.0


def get_wxa_code_unlimited(appid: str, secret: str, scene: str,
                           page: str = WECHAT_LOGIN_PAGE) -> bytes:
    """生成不限量小程序码（getwxacodeunlimit），返回 PNG 二进制。

    WECHAT_ENV_VERSION=develop/trial 时生成的码指向开发版/体验版小程序，
    全流程可以在正式发布之前就跑通真机验证。
    """
    env_version = (os.environ.get("WECHAT_ENV_VERSION") or "").strip() \
        or "release"
    body = {"scene": scene, "page": page, "width": 280,
            "check_path": False,   # 开发期页面尚未上线时不校验 page
            "env_version": env_version}

    def attempt(token: str) -> bytes:
        resp = requests.post(
            "https://api.weixin.qq.com/wxa/getwxacodeunlimit",
            params={"access_token": token}, json=body, timeout=10)
        # 成功时返回图片二进制，失败时返回 JSON，只能靠 content-type 区分
        if "application/json" in (resp.headers.get("content-type") or ""):
            data = resp.json()
            raise _WxApiError(data.get("errcode", -1), data.get("errmsg", ""))
        return resp.content

    try:
        return attempt(get_access_token(appid, secret))
    except _WxApiError as e:
        if e.errcode not in _TOKEN_INVALID_CODES:
            raise
        # 典型诱因：本地开发与线上共用 AppID，互相顶掉 token
        _invalidate_access_token()
        return attempt(get_access_token(appid, secret))


class _WxApiError(RuntimeError):
    def __init__(self, errcode: int, errmsg: str):
        super().__init__(f"{errcode} {errmsg}")
        self.errcode = errcode


def code2session(appid: str, secret: str, code: str) -> str:
    """用 wx.login 拿到的 js_code 换 openid（不需要 access_token）。

    js_code 一次性有效（5 分钟），重复使用返回 40163，因此不能重试。
    MOCK 模式下跳过微信接口，code 直接派生 openid。
    """
    if MOCK_ENABLED:
        return "mock_openid_" + code[:24]
    try:
        resp = requests.get(
            "https://api.weixin.qq.com/sns/jscode2session",
            params={"appid": appid, "secret": secret,
                    "js_code": code, "grant_type": "authorization_code"},
            timeout=10)
    except requests.RequestException as e:
        logger.warning("微信 code2session 请求失败: %s", e)
        raise RuntimeError("微信登录接口不可达，请稍后重试")
    try:
        data = resp.json()
    except ValueError:
        logger.warning("微信 code2session 返回非 JSON")
        raise RuntimeError("微信登录接口返回异常，请稍后重试")
    if data.get("errcode"):
        raise RuntimeError(f"微信登录失败: {data.get('errmsg', '')}")
    openid = data.get("openid")
    if not openid:
        raise RuntimeError("微信登录失败: 未返回 openid")
    return openid


# ---- MOCK 模式：本地联调不需要真实微信凭据 ----

_MOCK_QR_SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='280' height='280'>"
    "<rect width='100%' height='100%' fill='#fff' stroke='#2f54eb'/>"
    "<rect x='24' y='24' width='64' height='64' fill='none' stroke='#333' stroke-width='6'/>"
    "<rect x='192' y='24' width='64' height='64' fill='none' stroke='#333' stroke-width='6'/>"
    "<rect x='24' y='192' width='64' height='64' fill='none' stroke='#333' stroke-width='6'/>"
    "<text x='140' y='140' font-size='20' fill='#333' text-anchor='middle'>MOCK</text>"
    "<text x='140' y='168' font-size='13' fill='#888' text-anchor='middle'>模拟二维码，仅供联调</text>"
    "</svg>")


def mock_qr_data_url() -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(
        _MOCK_QR_SVG.encode("utf-8")).decode("ascii")
